import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router, staffOrAdminProcedure, clinicalReadProcedure,
  staffReadProcedure, supervisorProcedure } from "./_core/trpc";
import * as machineDb from "./machines";
import {
  getMachineMetricsReport,
  generateMachineMetricsExcel,
  logMachineRepair,
  listMachineRepairs,
} from "./machine-metrics";
import {
  hashWithSalt,
  resolveStaffSession,
  setStaffSessionCookie,
  setStaffSessionCookieSync,
  verifyPassword,
  staffAccessedFloors,
  staffCanWrite,
  bumpTokenVersion,
  STAFF_COOKIE_NAME,
  type StaffSession,
} from "./staffAuth";
import { staffAccounts, sessions, machines, waitingList } from "../drizzle/schema";
import { patientTicket } from "./patient-ticket";
import { getDb } from "./db";
import { mapBackendError } from "./errors";
import { eq } from "drizzle-orm";

/**
 * Floor scoping for nurses: rejects access to floors outside the staff
 * member's assignment; supervisors and OAuth users pass freely.
 * Call at the top of each floor-scoped procedure body.
 */
function requireFloorAccess(
  staff: StaffSession,
  floorId: number,
  oauthUser?: { role: string } | null
) {
  // OAuth admin/users (the owner's Google login) keep full access to every floor.
  if (oauthUser) return;
  // Write endpoints reject guests upstream (staffOrAdminProcedure), so when a
  // guest reaches this guard it is a read-only endpoint — guests may view any
  // board's public content, the same way machines.list does.
  if (staff.role === "guest") return;
  const allowed = staffAccessedFloors(staff);
  if (allowed !== null && !allowed.includes(floorId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this board" });
  }
}

/** Widest metrics window a single request may ask for; the report and the
 *  Excel workbook are both built whole in memory. */
const METRICS_MAX_RANGE_DAYS = 92;

const machineMetricsRangeSchema = z
  .object({
    machineId: z.number().int().positive().optional(),
    floorId: z.number().int().positive().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD"),
  })
  .refine(v => v.startDate <= v.endDate, {
    message: "Start date must be on or before the end date",
    path: ["startDate"],
  })
  .refine(
    v =>
      (Date.parse(`${v.endDate}T00:00:00Z`) - Date.parse(`${v.startDate}T00:00:00Z`)) / 86_400_000 <
      METRICS_MAX_RANGE_DAYS,
    { message: `Date range cannot exceed ${METRICS_MAX_RANGE_DAYS} days`, path: ["endDate"] },
  );

/** Floor scoping for a machine-addressed procedure: resolves the machine's floor first. */
async function requireMachineFloorAccess(
  ctx: { staff: StaffSession; user?: { role: string } | null },
  machineId: number,
): Promise<void> {
  const machine = await machineDb.getMachineById(machineId);
  if (machine?.floorId) requireFloorAccess(ctx.staff, machine.floorId, ctx.user);
}

/**
 * Floor scoping for the metrics endpoints. A nurse may read their own board
 * only, so an unscoped request (no machineId, no floorId) is narrowed to the
 * floors they hold rather than silently returning the whole clinic.
 */
async function requireMetricsScope(
  ctx: { staff: StaffSession; user?: { role: string } | null },
  input: { machineId?: number; floorId?: number },
): Promise<void> {
  if (input.machineId !== undefined) {
    await requireMachineFloorAccess(ctx, input.machineId);
    return;
  }
  if (input.floorId !== undefined) {
    requireFloorAccess(ctx.staff, input.floorId, ctx.user);
    return;
  }
  // clinicalReadProcedure already rejected guests and anonymous callers.
  if (ctx.user) return;
  const allowed = staffAccessedFloors(ctx.staff);
  if (allowed !== null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Select one of your assigned boards to export metrics",
    });
  }
}

/** Preset durations (minutes) for quick selection; "custom" passes user-supplied minutes. */
const durationMinutesSchema = z
  .union([z.enum(["180", "240", "360", "480", "custom"]), z.number().int().min(15).max(1440)])
  .transform(v => (typeof v === "string" ? (v === "custom" ? null : Number(v)) : v));
const isolationTagSchema = z.enum(["clean", "dirty"]);
const waitingPrioritySchema = z.enum(["normal", "urgent", "veryUrgent"]);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

    machines: router({
    /** All machines with their active session (if any). Auto-polling on the
     *  client provides cross-device real-time sync.
     *
     *  Open to anonymous viewers (kiosk, guest board) but PHI is masked
     *  server-side: only a staff session receives the real patientId and
     *  staff names. Everyone else gets the public ticket code. */
    list: staffReadProcedure.query(({ ctx }) =>
      machineDb.listMachines({ canSeePhi: ctx.isStaff })
    ),

    /** Rename a machine (staff only). */
    updateLabel: staffOrAdminProcedure
      .input(
        z.object({
          machineId: z.number().int().positive(),
          label: z.string().trim().min(1, "Machine label is required").max(32),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          // Floor-scope: nurses may only rename machines on their own board.
          const machine = await machineDb.getMachineById(input.machineId);
          if (machine?.floorId) requireFloorAccess(ctx.staff, machine.floorId, ctx.user);
          await machineDb.updateMachineLabel({ machineId: input.machineId, label: input.label });
          return { success: true } as const;
        } catch (error) {
          if ((error as Error)?.message === "MACHINE_LABEL_EXISTS") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A machine with this label already exists on the board.",
            });
          }
          if ((error as Error)?.message === "LABEL_REQUIRED") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Machine label cannot be empty." });
          }
          mapBackendError(error);
        }
      }),


    /** Floors machines are grouped into on the board. */
    listFloors: publicProcedure.query(() => machineDb.listFloors()),

    /** Add a new machine to the inventory (staff only). */
    add: staffOrAdminProcedure
      .input(
        z.object({
          label: z.string().trim().min(1, "Machine label is required").max(32),
          floorId: z.number().int().positive().nullable().default(null),
          location: z.string().trim().max(64).default("—"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (input.floorId !== null) requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        try {
          const result = await machineDb.addMachine(input);
          return { success: true, machineId: result.id } as const;
        } catch (error) {
          if ((error as Error)?.message === "MACHINE_LABEL_EXISTS") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A machine with this label already exists on the board.",
            });
          }
          mapBackendError(error);
        }
      }),

    /** Remove a machine from the inventory (staff only). Vacant machines only. */
    remove: staffOrAdminProcedure
      .input(z.object({ machineId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        try {
          // Floor-scope: nurses may only remove machines on their assigned floor;
          // OAuth admin users (owner) keep full access.
          const machine = await machineDb.getMachineById(input.machineId);
          if (machine?.floorId) requireFloorAccess(ctx.staff, machine.floorId, ctx.user);
          await machineDb.removeMachine({ machineId: input.machineId });
          return { success: true } as const;
        } catch (error) {
          if ((error as Error)?.message === "MACHINE_IN_TREATMENT") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Cannot remove a machine that is currently in treatment. End the session first.",
            });
          }
          if ((error as Error)?.message === "MACHINE_OFFBOARD") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This machine is in Backup or Repair storage. Return it to a board first, then remove it.",
            });
          }
          if ((error as Error)?.message === "MACHINE_NOT_FOUND") {
            throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found." });
          }
          mapBackendError(error);
        }
      }),

    /**
     * Send a floor machine to Backup or Repair (off the floor), or return a
     * backup/repair machine to a floor. Nurses may move machines of their own
     * board only; supervisors and OAuth users may move anything.
     */
    setStatus: staffOrAdminProcedure
      .input(
        z.object({
          machineId: z.number().int().positive(),
          status: z.enum(["active", "backup", "repair"]),
          /** Required when status === "active": floor to return the machine to. */
          floorId: z.number().int().positive().nullable().default(null),
          statusNote: z.string().trim().max(120).nullable().default(null),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const machine = await machineDb.getMachineById(input.machineId);
        if (!machine) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found." });
        }
        // Leaving the floor: scope check on the machine's current floor.
        if (input.status !== "active" && machine.floorId) {
          requireFloorAccess(ctx.staff, machine.floorId, ctx.user);
        }
        // Returning to the floor: scope check on the target floor.
        if (input.status === "active" && input.floorId) {
          requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        }
        try {
          await machineDb.setMachineStatus({
            machineId: input.machineId,
            status: input.status,
            floorId: input.status === "active" ? input.floorId : undefined,
            statusNote: input.statusNote,
          });
          return { success: true } as const;
        } catch (error) {
          const msg = (error as Error)?.message;
          if (msg === "MACHINE_IN_TREATMENT") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Cannot move a machine that is currently in treatment. End the session first.",
            });
          }
          if (msg === "FLOOR_NOT_FOUND") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "The selected board no longer exists." });
          }
          if (msg === "MACHINE_NOT_FOUND") {
            throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found." });
          }
          if (msg === "FLOOR_REQUIRED") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the board this machine returns to." });
          }
          mapBackendError(error);
        }
      }),

    /**
     * Drag-and-drop swap: exchange two machines between different boards.
     * Both machines must be vacant. Nurses may swap only within their own
     * board (effectively a no-op), so cross-board swaps are supervisor-only.
     */
    swap: staffOrAdminProcedure
      .input(
        z.object({
          machineAId: z.number().int().positive(),
          machineBId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const a = await machineDb.getMachineById(input.machineAId);
        const b = await machineDb.getMachineById(input.machineBId);
        if (a?.floorId) requireFloorAccess(ctx.staff, a.floorId, ctx.user);
        if (b?.floorId) requireFloorAccess(ctx.staff, b.floorId, ctx.user);
        try {
          await machineDb.swapMachines(input);
          return { success: true } as const;
        } catch (error) {
          const msg = (error as Error)?.message;
          if (msg === "MACHINE_IN_TREATMENT") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "One of the machines is in treatment. End the session first.",
            });
          }
          if (msg === "SAME_FLOOR") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Both machines are on the same board." });
          }
          if (msg === "SAME_MACHINE") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "A machine cannot be swapped with itself." });
          }
          if (msg === "MACHINE_OFFBOARD") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Only machines on the floor boards can be swapped." });
          }
          mapBackendError(error);
        }
      }),

    /** Backup & Repair inventory: machines off the floors, with their status. */
    offboarded: router({
      list: publicProcedure.query(() => machineDb.listOffboardedMachines()),
    }),

    /** Aggregated metrics for a machine or floor over a date range. */
    metrics: clinicalReadProcedure
      .input(machineMetricsRangeSchema)
      .query(async ({ ctx, input }) => {
        await requireMetricsScope(ctx, input);
        return getMachineMetricsReport(input, { canSeePhi: ctx.isStaff });
      }),

    /** Download an Excel (.xlsx) file containing machine overview, sessions, and repairs. */
    exportExcel: clinicalReadProcedure
      .input(machineMetricsRangeSchema)
      .mutation(async ({ ctx, input }) => {
        await requireMetricsScope(ctx, input);
        const report = await getMachineMetricsReport(input, { canSeePhi: ctx.isStaff });
        const buffer = await generateMachineMetricsExcel(report);
        const prefix = input.machineId ? `machine-${input.machineId}` : (input.floorId ? `floor-${input.floorId}` : "all-machines");
        const filename = `${prefix}-metrics-${input.startDate}-to-${input.endDate}.xlsx`;
        return {
          filename,
          base64: buffer.toString("base64"),
        };
      }),

    /** Machine maintenance & repair log. */
    repairs: router({
      list: clinicalReadProcedure
        .input(z.object({ machineId: z.number().int().positive() }))
        .query(async ({ ctx, input }) => {
          await requireMachineFloorAccess(ctx, input.machineId);
          return listMachineRepairs(input.machineId, { canSeePhi: ctx.isStaff });
        }),

      log: staffOrAdminProcedure
        .input(
          z.object({
            machineId: z.number().int().positive(),
            issue: z.string().trim().min(1, "Issue description is required").max(1000),
            technician: z.string().trim().max(64).optional(),
            actionTaken: z.string().trim().max(1000).optional(),
            partsReplaced: z.string().trim().max(500).optional(),
            status: z.enum(["pending", "in_progress", "resolved"]).default("pending"),
          })
        )
        .mutation(async ({ ctx, input }) => {
          await requireMachineFloorAccess(ctx, input.machineId);
          const reporter = ctx.user?.name || ctx.staff?.displayName || ctx.staff?.username || "Staff";
          return logMachineRepair({
            ...input,
            reportedBy: reporter,
          });
        }),
    }),
  }),

  rooms: router({
    /** All rooms (floors) visible on the board. Public so every staff device sees them. */
    list: publicProcedure.query(() => machineDb.listFloors()),

    /** Add a new room (supervisor/admin only — global resource, not floor-scoped). */
    add: staffOrAdminProcedure
      .input(z.object({ name: z.string().trim().min(1, "Room name is required").max(64) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user && ctx.staff.role !== "supervisor") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only the supervisor may manage rooms." });
        }
        try {
          const result = await machineDb.addRoom(input);
          return { success: true, roomId: result.id } as const;
        } catch (error) {
          if ((error as Error)?.message === "ROOM_EXISTS") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A room with this name already exists.",
            });
          }
          mapBackendError(error);
        }
      }),

    /** Rename a room (supervisor/admin only — global resource, not floor-scoped). */
    rename: staffOrAdminProcedure
      .input(z.object({ roomId: z.number().int().positive(), name: z.string().trim().min(1, "Room name is required").max(64) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user && ctx.staff.role !== "supervisor") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only the supervisor may manage rooms." });
        }
        try {
          await machineDb.renameRoom({ roomId: input.roomId, name: input.name });
          return { success: true } as const;
        } catch (error) {
          const msg = (error as Error)?.message;
          if (msg === "ROOM_EXISTS") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A room with this name already exists.",
            });
          }
          if (msg === "ROOM_NAME_REQUIRED") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Room name cannot be empty." });
          }
          if (msg === "ROOM_NAME_TOO_LONG") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Room name is too long (max 64 characters)." });
          }
          mapBackendError(error);
        }
      }),

    /** Remove a room (supervisor/admin only — global resource, not floor-scoped). */
    remove: staffOrAdminProcedure
      .input(z.object({ roomId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user && ctx.staff.role !== "supervisor") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only the supervisor may manage rooms." });
        }
        try {
          await machineDb.removeRoom({ roomId: input.roomId });
          return { success: true } as const;
        } catch (error) {
          const msg = (error as Error)?.message;
          if (msg === "ROOM_HAS_ACTIVE_SESSIONS") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Cannot remove a room with machines currently in treatment. End those sessions first.",
            });
          }
          if (msg === "ROOM_HAS_MACHINES") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Cannot remove a room that still has machines. Remove its machines first.",
            });
          }
          mapBackendError(error);
        }
      }),
  }),

  sessions: router({
    assign: staffOrAdminProcedure
      .input(
        z.object({
          machineId: z.number().int().positive(),
          patientId: z.string().trim().min(1, "Patient identifier is required").max(64),
          durationMinutes: durationMinutesSchema,
          customMinutes: z
            .number()
            .int()
            .min(15, "Minimum duration is 15 minutes")
            .max(1440, "Maximum duration is 24 hours")
            .nullable()
            .default(null),
          isolationTag: isolationTagSchema,
          urgent: z.boolean().default(false),
          /** Optional staff-set alias shown on the machine tile instead of the patient id. */
          displayLabel: z.string().trim().max(64).nullable().default(null),
          /** Nurse responsible for this patient during the session, shown in the floor nurse roster. */
          assignedNurse: z.string().trim().max(64).nullable().default(null),
          /** When true, ending this session automatically parks the machine in repair storage. */
          needsRepairAfterSession: z.boolean().default(false),
        })
        .superRefine((data, ctxx) => {
          if (data.durationMinutes === null && (data.customMinutes === null || data.customMinutes < 15)) {
            ctxx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Please enter a custom duration (15 minutes to 24 hours)",
              path: ["customMinutes"],
            });
          }
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          if (ctx.staff && ctx.staff.role === "nurse") {
            const machine = await machineDb.getMachineById(input.machineId);
            if (machine?.floorId) requireFloorAccess(ctx.staff, machine.floorId, ctx.user);
          }
          const { customMinutes, ...rest } = input;
          const durationMinutes = rest.durationMinutes ?? (customMinutes as number);
          const result = await machineDb.assignSession({
            ...rest,
            durationMinutes,
            startedBy: ctx.user?.name ?? ctx.user?.email ?? ctx.staff?.displayName ?? "staff",
          });
          return { success: true, sessionId: result.id };
        } catch (error) {
          mapBackendError(error);
        }
      }),

    end: staffOrAdminProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.staff && ctx.staff.role === "nurse") {
          const floorId = await machineDb.getSessionFloorId(input.sessionId);
          if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
        }
        try {
          await machineDb.endSession({
            sessionId: input.sessionId,
            endedBy: ctx.user?.name ?? ctx.user?.email ?? ctx.staff?.displayName ?? "staff",
          });
        } catch (error) {
          mapBackendError(error);
        }
        return { success: true } as const;
      }),

    toggleUrgent: staffOrAdminProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.staff && ctx.staff.role === "nurse") {
          const floorId = await machineDb.getSessionFloorId(input.sessionId);
          if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
        }
        try {
          await machineDb.toggleUrgent({ sessionId: input.sessionId });
        } catch (error) {
          mapBackendError(error);
        }
        return { success: true } as const;
      }),

    /** Flag an active session for repair: ending it parks the machine in repair storage. */
    setRepairFlag: staffOrAdminProcedure
      .input(
        z.object({ sessionId: z.number().int().positive(), flag: z.boolean() })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.staff && ctx.staff.role === "nurse") {
          const floorId = await machineDb.getSessionFloorId(input.sessionId);
          if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
        }
        try {
          await machineDb.setRepairFlag({ sessionId: input.sessionId, flag: input.flag });
        } catch (error) {
          mapBackendError(error);
        }
        return { success: true } as const;
      }),

    /** Pause or resume an active session's countdown (treatment break window). */
    togglePause: staffOrAdminProcedure
      .input(
        z.object({ sessionId: z.number().int().positive(), paused: z.boolean() })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.staff && ctx.staff.role === "nurse") {
          const floorId = await machineDb.getSessionFloorId(input.sessionId);
          if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
        }
        try {
          await machineDb.togglePause({ sessionId: input.sessionId, paused: input.paused });
          return { success: true } as const;
        } catch (error) {
          const msg = (error as Error)?.message;
          if (msg === "NO_ACTIVE_SESSION") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This machine has no active session.",
            });
          }
          mapBackendError(error);
        }
      }),

    updateTag: staffOrAdminProcedure
      .input(
        z.object({
          sessionId: z.number().int().positive(),
          isolationTag: isolationTagSchema,
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.staff && ctx.staff.role === "nurse") {
          const floorId = await machineDb.getSessionFloorId(input.sessionId);
          if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
        }
        try {
          await machineDb.updateIsolationTag({
            sessionId: input.sessionId,
            isolationTag: input.isolationTag,
          });
        } catch (error) {
          mapBackendError(error);
        }
        return { success: true } as const;
      }),

    updateLabel: staffOrAdminProcedure
      .input(
        z.object({
          sessionId: z.number().int().positive(),
          displayLabel: z.string().trim().max(64).nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          if (ctx.staff && ctx.staff.role === "nurse") {
            const floorId = await machineDb.getSessionFloorId(input.sessionId);
            if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
          }
          await machineDb.updateDisplayLabel({
            sessionId: input.sessionId,
            displayLabel: input.displayLabel,
          });
          return { success: true } as const;
        } catch (error) {
          if ((error as Error)?.message === "LABEL_TOO_LONG") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "The display label is too long (max 64 characters)." });
          }
          mapBackendError(error);
        }
      }),
  }),

  waiting: router({
    /** Waiting patients per floor. Public so every staff device sees the same queue,
     *  but guest viewers never receive clinical queue data. */
    list: staffReadProcedure
      .input(z.object({ floorId: z.number().int().positive() }))
      .query(({ ctx, input }) =>
        // The kiosk shows this queue in a public waiting room, so the rows
        // stay readable but carry only the ticket code unless the caller
        // holds a staff session.
        machineDb.listWaiting({ floorId: input.floorId }, { canSeePhi: ctx.isStaff })
      ),
    /**
     * Cross-board urgent register: urgent-flagged active sessions from every
     * floor plus very-urgent patients still waiting anywhere. Public so all
     * staff devices see the same consolidated register.
     */
    urgentRegister: staffReadProcedure.query(async ({ ctx }) => {
      // The urgent register is a clinical view: it names patients waiting and
      // in treatment. Guests and anonymous viewers get nothing.
      if (!ctx.isStaff) {
        return { urgentSessions: [], veryUrgentWaiting: [] };
      }
      const [sessions, waiting, floors] = await Promise.all([
        machineDb.listMachines({ canSeePhi: true }),
        machineDb.listWaitingAll({ canSeePhi: true }),
        machineDb.listFloors(),
      ]);

      const floorNames = new Map<number, string>(
        floors.map(f => [f.id, f.name]),
      );

      const urgentSessions = sessions
        .filter(r => r.session?.urgent)
        .map(r => {
          const s = r.session!;
          return {
            kind: "session" as const,
            machineId: r.machine.id,
            sessionId: s.id,
            machineLabel: r.machine.label,
            location: r.machine.location,
            floorId: r.machine.floorId,
            floorName: r.machine.floorId ? (floorNames.get(r.machine.floorId) ?? null) : null,
            patientId: s.patientId ?? s.ticket,
            durationMinutes: s.durationMinutes,
            endsAt: s.endsAt,
            isolationTag: s.isolationTag,
          };
        })
        .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());

      const veryUrgentWaiting = waiting
        .filter((e: { priority: string }) => e.priority === "veryUrgent")
        .map(e => ({
          kind: "waiting" as const,
          waitingId: e.id,
          patientId: e.patientId ?? e.ticket,
          floorId: e.floorId,
          floorName: floorNames.get(e.floorId) ?? null,
          priority: e.priority,
          joinedAt: e.joinedAt,
        }))
        .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime());

      return { urgentSessions, veryUrgentWaiting };
    }),

    /** Add a patient to the waiting list (staff only). */
    add: staffOrAdminProcedure
      .input(
        z.object({
          floorId: z.number().int().positive(),
          patientId: z.string().trim().min(1, "Patient identifier is required").max(64),
          priority: waitingPrioritySchema.default("normal"),
          /** Planned treatment length, carried onto the session at admit time. */
          durationMinutes: z
            .number()
            .int()
            .min(15, "Minimum duration is 15 minutes")
            .max(1440, "Maximum duration is 24 hours")
            .default(240),
          isolationTag: isolationTagSchema.default("clean"),
          assignedNurse: z.string().trim().max(64).nullable().default(null),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        try {
          const result = await machineDb.addWaiting({
            floorId: input.floorId,
            patientId: input.patientId,
            priority: input.priority,
            durationMinutes: input.durationMinutes,
            isolationTag: input.isolationTag,
            assignedNurse: input.assignedNurse,
            addedBy: ctx.user?.name ?? ctx.user?.email ?? ctx.staff?.displayName ?? "staff",
          });
          return { success: true, entryId: result.id } as const;
        } catch (error) {
          const msg = (error as Error)?.message;
          if (msg === "PATIENT_ID_REQUIRED") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Patient identifier cannot be empty." });
          }
          if (msg === "PATIENT_ID_TOO_LONG") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Patient identifier is too long (max 64 characters)." });
          }
          mapBackendError(error);
        }
      }),

    /** Remove a patient from the waiting list (staff only). */
    remove: staffOrAdminProcedure
      .input(
        z.object({
          entryId: z.number().int().positive(),
          floorId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        try {
          await machineDb.removeWaiting({ entryId: input.entryId, floorId: input.floorId });
        } catch (error) {
          mapBackendError(error);
        }
        return { success: true } as const;
      }),

    /** Change a waiting patient's priority (staff only), e.g. escalate to very urgent. */
    setPriority: staffOrAdminProcedure
      .input(
        z.object({
          entryId: z.number().int().positive(),
          floorId: z.number().int().positive(),
          priority: waitingPrioritySchema,
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        try {
          await machineDb.markWaitingUrgent({
            entryId: input.entryId,
            floorId: input.floorId,
            priority: input.priority,
          });
        } catch (error) {
          mapBackendError(error);
        }
        return { success: true } as const;
      }),

    /**
     * Call a waiting patient to the treatment area (staff only). The stored
     * call state is what the lounge kiosk reads, so the announcement survives
     * a kiosk reload and reaches every screen, not only the nurse's device.
     */
    callIn: staffOrAdminProcedure
      .input(
        z.object({
          entryId: z.number().int().positive(),
          floorId: z.number().int().positive(),
          /** false cancels a call made by mistake. */
          called: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        try {
          await machineDb.setWaitingCall({
            entryId: input.entryId,
            floorId: input.floorId,
            called: input.called,
            calledBy: ctx.user?.name ?? ctx.user?.email ?? ctx.staff?.displayName ?? "staff",
          });
        } catch (error) {
          if ((error as Error)?.message === "WAITING_CALL_UNAVAILABLE") {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Calling patients in is not enabled on this database yet.",
            });
          }
          mapBackendError(error);
        }
        return { success: true } as const;
      }),

    /** Number of vacant machines on a floor (for enabling the admit control). */
    vacantCount: publicProcedure
      .input(z.object({ floorId: z.number().int().positive() }))
      .query(({ input }) => machineDb.countVacantMachines({ floorId: input.floorId })),

    /**
     * Admit a waiting patient onto the first vacant machine of the floor.
     * Starts the treatment session and marks the waiting entry as admitted.
     */
    admit: staffOrAdminProcedure
      .input(
        z.object({
          entryId: z.number().int().positive(),
          floorId: z.number().int().positive(),
          /** Omitted → the details captured when the patient joined the queue. */
          durationMinutes: z.number().int().min(15).max(1440).optional(),
          isolationTag: isolationTagSchema.optional(),
          urgent: z.boolean().default(false),
          displayLabel: z.string().trim().max(64).nullable().default(null),
          assignedNurse: z.string().trim().max(64).nullable().default(null),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        const entry = await machineDb.listWaiting({ floorId: input.floorId });
        const patient = entry.find(e => e.id === input.entryId);
        try {
          const admitRes = await machineDb.admitWaiting({
            entryId: input.entryId,
            floorId: input.floorId,
            durationMinutes: input.durationMinutes,
            isolationTag: input.isolationTag,
            urgent: input.urgent,
            startedBy: ctx.user?.name ?? ctx.user?.email ?? ctx.staff?.displayName ?? "staff",
            displayLabel: input.displayLabel,
            assignedNurse: input.assignedNurse,
          });
          const ticket =
            admitRes?.ticket ||
            (patient?.patientId ? patientTicket(patient.patientId) : "");
          return {
            success: true,
            patientId: patient?.patientId ?? "",
            ticket,
            machineLabel: admitRes?.machineLabel ?? "",
          } as const;
        } catch (error) {
          const msg = (error as Error)?.message;
          if (msg === "NO_WAITING_PATIENT") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This patient is no longer waiting — they may already have been admitted." });
          }
          if (msg === "NO_VACANT_MACHINE") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "No vacant machine on this floor — end or release a session first." });
          }
          mapBackendError(error);
        }
      }),

    /** Active sessions on a floor grouped for the "Nurse Patient Assignments" list. */
    nurseAssignments: staffReadProcedure
      .input(z.object({ floorId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        // Nurse-patient assignments name both the nurse and the patient.
        // They never leave the server for a guest or anonymous viewer.
        if (!ctx.isStaff) return [];
        return machineDb.listNurseAssignments({ floorId: input.floorId });
      }),
  }),

  /**
   * End of Day report: machines utilized, patients catered, priority and
   * isolation breakdowns for completed sessions on the chosen day, plus the
   * waiting-list adds of that day grouped by priority.
   */
  endOfDay: router({
    summary: staffReadProcedure
      .input(
        z.object({
          floorId: z.number().int().positive().optional(),
          /** Report date in ISO format (YYYY-MM-DD); defaults to today in Asia/Manila time. */
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        const staff = ctx.staff;
        // Guests may view (read-only); writes stay blocked upstream.
        // Nurses see only their board; supervisors/OAuth users see all.
        let floorId: number | undefined = input?.floorId;
        if (floorId === undefined && staff.role === "nurse") {
          floorId = staff.assignedFloorId ?? undefined;
        }
        if (floorId !== undefined) {
          requireFloorAccess(staff, floorId, ctx.user);
        }
        return machineDb.endOfDayReport({ floorId, date: input?.date });
      }),

    /**
     * All-boards End of Day report in a SINGLE call: summaries, per-machine
     * pause/idle metrics and day narratives for every floor. Used by the
     * supervisor's /report page to avoid one DB round trip (~1.3s) per
     * per-floor procedure — supervisors see all boards, everyone else is
     * rejected so a nurse/guest never pays for boards they can't read.
     */
    bulkSummary: supervisorProcedure
      .input(
        z.object({
          /** Report date in ISO format (YYYY-MM-DD); defaults to today in Asia/Manila time. */
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }).optional()
      )
      .query(async ({ input }) => machineDb.endOfDayReportBulk({ date: input?.date })),

    /**
     * Entire supervisor /report page in ONE call: staff session info, floor
     * list, per-floor summaries, narratives and the end-of-month aggregate.
     * The production path pays a fixed ~3s overhead per HTTP request
     * (serverless cold path + network), so collapsing the page's 4-5
     * requests into a single request roughly halves the perceived load time.
     */
    reportPage: supervisorProcedure
      .input(
        z.object({
          /** Report date in ISO format (YYYY-MM-DD); defaults to today in Asia/Manila time. */
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          /** Report month in ISO format (YYYY-MM); defaults to the current month in Asia/Manila time. */
          month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
          /** Shift filter for narrative tables; "all" or a REPORT_SHIFTS key (empty string = all). */
          shiftKey: z.string().optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        const [daily, monthly] = await Promise.all([
          machineDb.endOfDayReportBulk({ date: input?.date }),
          machineDb.monthReport({ floorId: undefined, month: input?.month }),
        ]);
        // Shift filter applies to narrative tables only (sessions/sessions are
        // whole-day aggregates already). Overlap is computed server-side so
        // the same cached payload serves all shift views; narratives are
        // filtered per period's reporting window vs the shift window.
        const shiftKey = input?.shiftKey ?? "";
        const narratives = shiftKey && shiftKey !== "all"
          ? Object.fromEntries(
              Object.entries(daily.narratives).map(([floorId, entries]) => [
                floorId,
                entries.filter(e => machineDb.periodOverlapsShift(e.periodKey, shiftKey)),
              ]),
            )
          : daily.narratives;
        return {
          // Staff session carried inline so the /report page needs no
          // separate staff.me round trip (each request costs ~3s overhead).
          staff: ctx.staff,
          daily: { ...daily, narratives },
          monthly,
        };
      }),

    /**
     * End of Month report: aggregates the end-of-day data across every day of
     * the given month (Asia/Manila) per floor — sessions ended, machines
     * utilized, distinct patients catered, urgency/isolation breakdowns,
     * treatment hours, waiting-list additions and pause time.
     */
    monthly: supervisorProcedure
      .input(
        z.object({
          floorId: z.number().int().positive().optional(),
          /** Report month in ISO format (YYYY-MM); defaults to the current month in Asia/Manila time. */
          month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        const staff = ctx.staff;
        // Same floor scoping as the daily summary: nurses see only their own board.
        let floorId: number | undefined = input?.floorId;
        if (floorId === undefined && staff.role === "nurse") {
          floorId = staff.assignedFloorId ?? undefined;
        }
        if (floorId !== undefined) {
          requireFloorAccess(staff, floorId, ctx.user);
        }
        return machineDb.monthReport({ floorId, month: input?.month });
      }),
  }),

  /**
   * Charge-nurse narrative reports. One board's day is split into four
   * treatment sessions plus three hooking/terminating transitions; the nurse
   * on duty writes a narrative per period they cover, optionally tagging the
   * shift window they worked. Floor-scoped: nurses write only for their own
   * board; supervisors see everything.
   */
  narratives: router({
    /** All narratives for a board on a given day (staff only). */
    list: staffReadProcedure
      .input(
        z.object({
          floorId: z.number().int().positive(),
          /** Report date in ISO format (YYYY-MM-DD). */
          reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
      )
      .query(async ({ ctx, input }) => {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        // Guests are read-only viewers of the boards — clinical narratives
        // never leave the server for a guest session.
        if (ctx.staff.role === "guest" && ctx.staff.fromCookie) return [];
        return machineDb.listNarratives({ floorId: input.floorId, reportDate: input.reportDate });
      }),

    /** Rewrite an existing narrative in place (staff only, floor-scoped). */
    update: staffOrAdminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          floorId: z.number().int().positive(),
          body: z.string().trim().min(1, "The narrative cannot be empty").max(4000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        const staffSession = ctx.staff;
        const row = await machineDb.getNarrativeById(input.id, input.floorId);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Narrative not found." });
        try {
          await machineDb.updateNarrativeBody(input.id, input.body);
          await machineDb.logNarrativeUpdate({
            narrativeId: row.id,
            floorId: row.floorId,
            reportDate: row.reportDate,
            periodKey: row.periodKey,
            actor: staffSession?.displayName ?? "(unknown)",
            actorRole: staffSession?.role === "supervisor" ? "supervisor" : staffSession?.role === "auditor" ? "auditor" : "nurse",
            body: input.body,
          });
        } catch (error) {
          mapBackendError(error);
        }
        return { success: true } as const;
      }),

    /** Write or update a period narrative (staff only, floor-scoped). */
    create: staffOrAdminProcedure
      .input(
        z.object({
          floorId: z.number().int().positive(),
          reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          periodKey: z.string().max(16),
          shiftKey: z.string().max(16).nullable().default(null),
          author: z.string().trim().min(1, "Author name is required").max(64),
          body: z.string().trim().min(1, "The narrative cannot be empty").max(4000),
          authorRole: z.enum(["supervisor", "nurse"]).default("nurse"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        // Report the writer's real role from the staff session — the role is
        // server-authoritative for the board/supervisor narrative split.
        const writerRole =
          ctx.staff?.role === "supervisor"
            ? ("supervisor" as const)
            : ("nurse" as const);
        try {
          const result = await machineDb.createNarrative({ ...input, authorRole: writerRole });
          return { success: true, id: result.id } as const;
        } catch (error) {
          const msg = (error as Error)?.message;
          if (msg === "INVALID_PERIOD") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown reporting period." });
          }
          if (msg === "EMPTY_BODY") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "The narrative cannot be empty." });
          }
          if (msg === "FORBIDDEN_PERIOD") {
            throw new TRPCError({ code: "FORBIDDEN", message: "This period is not part of your reporting scope." });
          }
          mapBackendError(error);
        }
      }),

    /** Remove a narrative (staff only, floor-scoped). */
    remove: staffOrAdminProcedure
      .input(z.object({ id: z.number().int().positive(), floorId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        try {
          await machineDb.deleteNarrative({
            id: input.id,
            floorId: input.floorId,
            actor: ctx.staff?.displayName ?? "(unknown)",
            actorRole: ctx.staff?.role === "supervisor" ? "supervisor" : ctx.staff?.role === "auditor" ? "auditor" : "nurse",
          });
        } catch (error) {
          mapBackendError(error);
        }
        return { success: true } as const;
      }),

    /** Edit-history audit trail for narratives (auditor only). */
    history: staffOrAdminProcedure
      .input(
        z
          .object({
            reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            floorId: z.number().int().positive().optional(),
          })
          .default({})
      )
      .query(async ({ ctx, input }) => {
        // Only the dedicated auditor account (Audit Viewer) may read the trail.
        const staffSession = ctx.staff;
        if (staffSession?.role !== "auditor") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only the auditor account may read the narrative edit history." });
        }
        return machineDb.listNarrativeHistory({ reportDate: input.reportDate, floorId: input.floorId });
      }),
  }),

  /**
   * Local board staff authentication (RDU nurses + SKTI supervisor).
   * Independent of the Manus OAuth login used by the owner/admin.
   */
  staff: router({
    me: publicProcedure.query(async ({ ctx }) => {
      return resolveStaffSession(ctx.req);
    }),
    /**
     * Enter explicit guest mode. Issues a signed JWT (role "guest") so the
     * cookie survives the same proxy handling as nurse/supervisor sessions —
     * resolveStaffSession then reports a guest session with fromCookie=true,
     * which locks writes server-side even for an OAuth-signed-in owner.
     */
    guest: publicProcedure.mutation(async ({ ctx }) => {
      // Await the JWT + cookie write before responding — the cookie must be
      // on the response headers before the tRPC response is flushed.
      await setStaffSessionCookieSync(
        ctx.req,
        ctx.res,
        {
          accountId: 0,
          username: "guest",
          displayName: "Guest",
          role: "guest",
          assignedFloorId: null,
        },
        1
      );
      return { success: true } as const;
    }),
    /**
     * Patient login by ticket number or patient ID.
     * Issues a role="patient" session restricted exclusively to the kiosk display.
     */
    patientLogin: publicProcedure
      .input(
        z.object({
          ticketOrId: z.string().trim().min(1).max(64),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const raw = input.ticketOrId.trim();
        let ticket = raw.toUpperCase();
        let patientId = raw;
        let activeBay: string | null = null;
        let activeStatus: "in_treatment" | "waiting" | "unregistered" = "unregistered";

        const db = await getDb();
        if (db) {
          const activeSessions = await db
            .select({
              machineId: sessions.machineId,
              patientId: sessions.patientId,
            })
            .from(sessions)
            .where(eq(sessions.status, "active"));

          const match = activeSessions.find(
            s =>
              s.patientId.toLowerCase() === raw.toLowerCase() ||
              patientTicket(s.patientId).toLowerCase() === raw.toLowerCase()
          );

          if (match) {
            activeStatus = "in_treatment";
            ticket = patientTicket(match.patientId);
            patientId = match.patientId;
            const m = await db
              .select({ label: machines.label })
              .from(machines)
              .where(eq(machines.id, match.machineId))
              .limit(1);
            if (m[0]) activeBay = m[0].label;
          } else {
            const waiting = await db
              .select({ id: waitingList.id, patientId: waitingList.patientId })
              .from(waitingList)
              .where(eq(waitingList.status, "waiting"));

            const waitMatch = waiting.find(
              w =>
                w.patientId.toLowerCase() === raw.toLowerCase() ||
                patientTicket(w.patientId).toLowerCase() === raw.toLowerCase()
            );

            if (waitMatch) {
              activeStatus = "waiting";
              ticket = patientTicket(waitMatch.patientId);
              patientId = waitMatch.patientId;
            } else {
              if (/^tk-\d+$/i.test(raw)) {
                ticket = raw.toUpperCase();
              } else {
                ticket = patientTicket(raw);
              }
            }
          }
        } else {
          if (/^tk-\d+$/i.test(raw)) {
            ticket = raw.toUpperCase();
          } else {
            ticket = patientTicket(raw);
          }
        }

        const displayName = `Patient ${ticket}`;
        await setStaffSessionCookieSync(
          ctx.req,
          ctx.res,
          {
            accountId: 0,
            username: ticket,
            displayName,
            role: "patient",
            assignedFloorId: null,
          },
          1
        );

        return {
          success: true,
          displayName,
          role: "patient" as const,
          ticket,
          activeBay,
          activeStatus,
        };
      }),
    /**
     * Patient guest mode: allows entering the kiosk without entering a specific ticket slip.
     */
    patientGuest: publicProcedure.mutation(async ({ ctx }) => {
      await setStaffSessionCookieSync(
        ctx.req,
        ctx.res,
        {
          accountId: 0,
          username: "patient.guest",
          displayName: "Lounge Patient",
          role: "patient",
          assignedFloorId: null,
        },
        1
      );
      return { success: true, role: "patient" as const };
    }),
    login: publicProcedure
      .input(
        z.object({
          username: z.string().trim().min(1).max(64),
          password: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
        const rows = await db
          .select()
          .from(staffAccounts)
          .where(eq(staffAccounts.username, input.username))
          .limit(1);
        const account = rows[0];
        if (!account || !account.active || !verifyPassword(input.password, account.passwordSalt, account.passwordHash)) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid username or password." });
        }
        await db.update(staffAccounts).set({ lastSignedIn: new Date() }).where(eq(staffAccounts.id, account.id));
        // Bump the token version so any previously issued token (another
        // device, a leaked cookie) is revoked — one active session at a time.
        await bumpTokenVersion(account.id);
        const accountNow = await db
          .select({ tokenVersion: staffAccounts.tokenVersion })
          .from(staffAccounts)
          .where(eq(staffAccounts.id, account.id))
          .limit(1);
        // Await the JWT + cookie write before responding — the cookie must be
        // on the response headers before the tRPC response is flushed.
        await setStaffSessionCookieSync(
          ctx.req,
          ctx.res,
          {
            accountId: account.id,
            username: account.username,
            displayName: account.displayName,
            role: account.role,
            assignedFloorId: account.assignedFloorId,
          },
          accountNow[0]?.tokenVersion
        );
        return {
          success: true,
          displayName: account.displayName,
          role: account.role,
          assignedFloorId: account.assignedFloorId,
        } as const;
      }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      // Resolve who is logging out before clearing the cookie so the stored
      // tokenVersion can be bumped — revoking the current token.
      const current = await resolveStaffSession(ctx.req);
      if (current.role === "nurse" || current.role === "supervisor") {
        await bumpTokenVersion(current.accountId);
      }
      // Guest sessions carry no revocation row: signing out simply clears
      // the cookie (handled inside setStaffSessionCookieSync via null staff).
      await setStaffSessionCookieSync(ctx.req, ctx.res, null);
      return { success: true } as const;
    }),
  }),

  /**
   * Shift Handover Endorsements between dialysis charge nurses.
   */
  shiftEndorsements: router({
    list: clinicalReadProcedure
      .input(
        z.object({
          floorId: z.number().int().positive(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        return machineDb.listShiftEndorsements(input);
      }),

    byId: clinicalReadProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const item = await machineDb.getShiftEndorsementById(input.id);
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Shift endorsement not found." });
        if (item.floorId) requireFloorAccess(ctx.staff, item.floorId, ctx.user);
        return item;
      }),

    create: staffOrAdminProcedure
      .input(
        z.object({
          shift: z.string().trim().min(1, "Shift identifier is required").max(32),
          floorId: z.number().int().positive(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
          incomingNurse: z.string().trim().min(1, "Incoming nurse is required").max(64),
          outgoingNurse: z.string().trim().min(1, "Outgoing nurse is required").max(64),
          patientNotes: z.string().trim().max(4000).nullable().default(null),
          accessIssues: z.string().trim().max(4000).nullable().default(null),
          equipmentNotes: z.string().trim().max(4000).nullable().default(null),
          floorName: z.string().trim().max(64).nullable().default(null),
          situation: z.string().trim().max(4000).nullable().default(null),
          background: z.string().trim().max(4000).nullable().default(null),
          assessment: z.string().trim().max(4000).nullable().default(null),
          recommendations: z.string().trim().max(4000).nullable().default(null),
          censusJson: z.string().max(4000).nullable().default(null),
          checklistJson: z.string().max(4000).nullable().default(null),
          specialWatchJson: z.string().max(8000).nullable().default(null),
          status: z.enum(["DRAFT", "ENDORSED_AND_LOCKED"]).default("DRAFT"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        try {
          const result = await machineDb.createShiftEndorsement(input);
          return { success: true, id: result.id } as const;
        } catch (error) {
          mapBackendError(error);
        }
      }),

    update: staffOrAdminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          shift: z.string().trim().min(1).max(32).optional(),
          incomingNurse: z.string().trim().min(1).max(64).optional(),
          outgoingNurse: z.string().trim().min(1).max(64).optional(),
          patientNotes: z.string().trim().max(4000).nullable().optional(),
          accessIssues: z.string().trim().max(4000).nullable().optional(),
          equipmentNotes: z.string().trim().max(4000).nullable().optional(),
          floorName: z.string().trim().max(64).nullable().optional(),
          situation: z.string().trim().max(4000).nullable().optional(),
          background: z.string().trim().max(4000).nullable().optional(),
          assessment: z.string().trim().max(4000).nullable().optional(),
          recommendations: z.string().trim().max(4000).nullable().optional(),
          censusJson: z.string().max(4000).nullable().optional(),
          checklistJson: z.string().max(4000).nullable().optional(),
          specialWatchJson: z.string().max(8000).nullable().optional(),
          status: z.enum(["DRAFT", "ENDORSED_AND_LOCKED"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const item = await machineDb.getShiftEndorsementById(input.id);
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Shift endorsement not found." });
        if (item.floorId) requireFloorAccess(ctx.staff, item.floorId, ctx.user);
        try {
          const { id, ...updates } = input;
          await machineDb.updateShiftEndorsement(id, updates);
          return { success: true } as const;
        } catch (error) {
          mapBackendError(error);
        }
      }),

    remove: staffOrAdminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const item = await machineDb.getShiftEndorsementById(input.id);
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Shift endorsement not found." });
        if (item.floorId) requireFloorAccess(ctx.staff, item.floorId, ctx.user);
        try {
          await machineDb.deleteShiftEndorsement(input.id);
          return { success: true } as const;
        } catch (error) {
          mapBackendError(error);
        }
      }),
  }),

  /**
   * Intra-dialytic session complications and adverse clinical events.
   */
  sessionComplications: router({
    list: staffReadProcedure
      .input(
        z
          .object({
            sessionId: z.number().int().positive().optional(),
            floorId: z.number().int().positive().optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        if (input?.floorId) requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        return machineDb.listSessionComplications(input);
      }),

    create: staffOrAdminProcedure
      .input(
        z.object({
          sessionId: z.number().int().positive(),
          complicationType: z.string().trim().min(1, "Complication type is required").max(64),
          onsetMinutes: z.number().int().min(0).max(1440).nullable().default(null),
          intervention: z.string().trim().max(2000).nullable().default(null),
          resolved: z.boolean().default(false),
          machineId: z.number().int().positive().nullable().default(null),
          machineLabel: z.string().trim().max(32).nullable().default(null),
          floorId: z.number().int().positive().nullable().default(null),
          patientId: z.string().trim().max(64).nullable().default(null),
          patientDisplayAlias: z.string().trim().max(64).nullable().default(null),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
          timeOfDay: z.string().trim().max(8).nullable().default(null),
          nurseName: z.string().trim().max(96).nullable().default(null),
          severity: z.string().trim().max(32).nullable().default(null),
          preEventBp: z.string().trim().max(16).nullable().default(null),
          eventBp: z.string().trim().max(16).nullable().default(null),
          heartRate: z.number().int().min(0).max(300).nullable().default(null),
          spo2: z.number().int().min(0).max(100).nullable().default(null),
          bfr: z.number().int().min(0).max(1000).nullable().default(null),
          ufr: z.number().int().min(0).max(10000).nullable().default(null),
          interventions: z.array(z.string().trim().max(200)).max(20).nullable().default(null),
          salineBolusVolumeMl: z.number().int().min(0).max(5000).nullable().default(null),
          physicianNotified: z.string().trim().max(96).nullable().default(null),
          outcome: z.string().trim().max(64).nullable().default(null),
          notes: z.string().trim().max(4000).nullable().default(null),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const floorId = await machineDb.getSessionFloorId(input.sessionId);
        if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
        try {
          const result = await machineDb.createSessionComplication(input);
          return { success: true, id: result.id } as const;
        } catch (error) {
          mapBackendError(error);
        }
      }),

    update: staffOrAdminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          complicationType: z.string().trim().min(1).max(64).optional(),
          onsetMinutes: z.number().int().min(0).max(1440).nullable().optional(),
          intervention: z.string().trim().max(2000).nullable().optional(),
          resolved: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        try {
          const { id, ...updates } = input;
          await machineDb.updateSessionComplication(id, updates);
          return { success: true } as const;
        } catch (error) {
          mapBackendError(error);
        }
      }),

    remove: staffOrAdminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        try {
          await machineDb.deleteSessionComplication(input.id);
          return { success: true } as const;
        } catch (error) {
          mapBackendError(error);
        }
      }),
  }),

  /**
   * Water Treatment & RO quality surveillance logs.
   */
  waterQualityLogs: router({
    list: clinicalReadProcedure
      .input(
        z
          .object({
            floorId: z.number().int().positive().optional(),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        if (input?.floorId) {
          requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        }
        return machineDb.listWaterQualityLogs(input);
      }),

    byId: clinicalReadProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const item = await machineDb.getWaterQualityLogById(input.id);
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Water quality log not found." });
        if (item.floorId) requireFloorAccess(ctx.staff, item.floorId, ctx.user);
        return item;
      }),

    create: staffOrAdminProcedure
      .input(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
          floorId: z.number().int().positive(),
          tdsIn: z.number().int().nullable().default(null),
          tdsOut: z.number().int().nullable().default(null),
          chlorineLevel: z.string().trim().max(32).nullable().default(null),
          hardness: z.string().trim().max(32).nullable().default(null),
          waterTemp: z.string().trim().max(32).nullable().default(null),
          technician: z.string().trim().min(1, "Technician name is required").max(64),
          status: z.string().trim().max(32).default("pass"),
          timeOfDay: z.string().trim().max(8).nullable().default(null),
          shift: z.string().trim().max(48).nullable().default(null),
          inspectorRole: z.string().trim().max(32).nullable().default(null),
          feedTds: z.number().min(0).max(100000).nullable().default(null),
          productTds: z.number().min(0).max(100000).nullable().default(null),
          productConductivity: z.number().min(0).max(100000).nullable().default(null),
          waterHardnessPpm: z.number().min(0).max(10000).nullable().default(null),
          loopFeedPressure: z.number().min(0).max(500).nullable().default(null),
          loopReturnPressure: z.number().min(0).max(500).nullable().default(null),
          waterTemperatureC: z.number().min(0).max(120).nullable().default(null),
          totalChlorine: z.number().min(0).max(100).nullable().default(null),
          chloramineBreakthrough: z.boolean().default(false),
          heatDisinfectionCompleted: z.boolean().default(false),
          heatPeakTemp: z.number().min(0).max(150).nullable().default(null),
          heatHoldMinutes: z.number().int().min(0).max(600).nullable().default(null),
          chemicalAgentUsed: z.string().trim().max(48).nullable().default(null),
          residualChemicalTestNegative: z.boolean().default(false),
          endotoxinLevel: z.number().min(0).max(1000).nullable().default(null),
          colonyCount: z.number().int().min(0).max(1000000).nullable().default(null),
          correctiveAction: z.string().trim().max(4000).nullable().default(null),
          notes: z.string().trim().max(4000).nullable().default(null),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        try {
          const result = await machineDb.createWaterQualityLog(input);
          return { success: true, id: result.id } as const;
        } catch (error) {
          mapBackendError(error);
        }
      }),

    update: staffOrAdminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          tdsIn: z.number().int().nullable().optional(),
          tdsOut: z.number().int().nullable().optional(),
          chlorineLevel: z.string().trim().max(32).nullable().optional(),
          hardness: z.string().trim().max(32).nullable().optional(),
          waterTemp: z.string().trim().max(32).nullable().optional(),
          technician: z.string().trim().min(1).max(64).optional(),
          status: z.string().trim().max(32).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const item = await machineDb.getWaterQualityLogById(input.id);
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Water quality log not found." });
        if (item.floorId) requireFloorAccess(ctx.staff, item.floorId, ctx.user);
        try {
          const { id, ...updates } = input;
          await machineDb.updateWaterQualityLog(id, updates);
          return { success: true } as const;
        } catch (error) {
          mapBackendError(error);
        }
      }),

    remove: staffOrAdminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const item = await machineDb.getWaterQualityLogById(input.id);
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Water quality log not found." });
        if (item.floorId) requireFloorAccess(ctx.staff, item.floorId, ctx.user);
        try {
          await machineDb.deleteWaterQualityLog(input.id);
          return { success: true } as const;
        } catch (error) {
          mapBackendError(error);
        }
      }),
  }),

  /**
   * Infection surveillance and bloodborne viral hepatitis/HIV/MDR screening.
   */
  infectionSurveillance: router({
    list: staffReadProcedure
      .input(z.object({ patientId: z.string().trim().optional() }).optional())
      .query(async ({ input }) => machineDb.listInfectionSurveillance(input)),

    byPatientId: staffReadProcedure
      .input(z.object({ patientId: z.string().trim().min(1) }))
      .query(async ({ input }) => {
        const row = await machineDb.getInfectionSurveillanceByPatientId(input.patientId);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Infection surveillance record not found." });
        return row;
      }),

    upsert: staffOrAdminProcedure
      .input(
        z.object({
          patientId: z.string().trim().min(1, "Patient ID is required").max(64),
          hbsagStatus: z.string().trim().max(32).default("negative"),
          hcvStatus: z.string().trim().max(32).default("negative"),
          hivStatus: z.string().trim().max(32).default("negative"),
          mdrStatus: z.string().trim().max(32).default("negative"),
          lastTestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format").nullable().optional(),
          assignedIsolationRoom: z.string().trim().max(64).nullable().optional(),
        })
      )
      .mutation(async ({ input }) => {
        try {
          const result = await machineDb.upsertInfectionSurveillance(input);
          return { success: true, id: result.id } as const;
        } catch (error) {
          mapBackendError(error);
        }
      }),

    remove: staffOrAdminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        try {
          await machineDb.deleteInfectionSurveillance(input.id);
          return { success: true } as const;
        } catch (error) {
          mapBackendError(error);
        }
      }),
  }),

  /**
   * Hemodialysis medical supplies and consumable inventory.
   */
  inventorySupplies: router({
    list: staffReadProcedure
      .input(
        z
          .object({
            category: z.string().trim().optional(),
            lowStockOnly: z.boolean().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => machineDb.listInventorySupplies(input)),

    byItemCode: staffReadProcedure
      .input(z.object({ itemCode: z.string().trim().min(1) }))
      .query(async ({ input }) => {
        const item = await machineDb.getInventorySupplyByItemCode(input.itemCode);
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found in inventory." });
        return item;
      }),

    add: staffOrAdminProcedure
      .input(
        z.object({
          itemCode: z.string().trim().min(1, "Item code is required").max(64),
          itemName: z.string().trim().min(1, "Item name is required").max(128),
          unit: z.string().trim().min(1, "Unit is required").max(32),
          currentStock: z.number().int().min(0).default(0),
          reorderLevel: z.number().int().min(0).default(10),
          category: z.string().trim().max(64).default("general"),
        })
      )
      .mutation(async ({ input }) => {
        try {
          const result = await machineDb.addInventorySupply(input);
          return { success: true, id: result.id } as const;
        } catch (error) {
          if ((error as Error)?.message === "ITEM_CODE_EXISTS") {
            throw new TRPCError({ code: "CONFLICT", message: "An item with this item code already exists." });
          }
          mapBackendError(error);
        }
      }),

    update: staffOrAdminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          itemName: z.string().trim().min(1).max(128).optional(),
          unit: z.string().trim().min(1).max(32).optional(),
          currentStock: z.number().int().min(0).optional(),
          reorderLevel: z.number().int().min(0).optional(),
          category: z.string().trim().max(64).optional(),
        })
      )
      .mutation(async ({ input }) => {
        try {
          const { id, ...updates } = input;
          await machineDb.updateInventorySupply(id, updates);
          return { success: true } as const;
        } catch (error) {
          mapBackendError(error);
        }
      }),

    adjustStock: staffOrAdminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          delta: z.number().int(),
        })
      )
      .mutation(async ({ input }) => {
        try {
          await machineDb.adjustInventoryStock(input.id, input.delta);
          return { success: true } as const;
        } catch (error) {
          mapBackendError(error);
        }
      }),

    remove: staffOrAdminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        try {
          await machineDb.deleteInventorySupply(input.id);
          return { success: true } as const;
        } catch (error) {
          mapBackendError(error);
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
