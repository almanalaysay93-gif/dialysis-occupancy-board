import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router, staffOrAdminProcedure, staffReadProcedure } from "./_core/trpc";
import * as machineDb from "./machines";
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
import { staffAccounts } from "../drizzle/schema";
import { getDb } from "./db";
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
     *  client provides cross-device real-time sync. */
    list: publicProcedure.query(() => machineDb.listMachines()),

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
          throw error;
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
          throw error;
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
              message: "Cannot remove a machine that is currently in treatment.",
            });
          }
          throw error;
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
          throw error;
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
          throw error;
        }
      }),

    /** Backup & Repair inventory: machines off the floors, with their status. */
    offboarded: router({
      list: publicProcedure.query(() => machineDb.listOffboardedMachines()),
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
          throw error;
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
          throw error;
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
          throw error;
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
          if ((error as Error)?.message === "MACHINE_OCCUPIED") {
            throw new TRPCError({ code: "CONFLICT", message: "This machine already has an active session." });
          }
          throw error;
        }
      }),

    end: staffOrAdminProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.staff && ctx.staff.role === "nurse") {
          const floorId = await machineDb.getSessionFloorId(input.sessionId);
          if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
        }
        await machineDb.endSession({
          sessionId: input.sessionId,
          endedBy: ctx.user?.name ?? ctx.user?.email ?? ctx.staff?.displayName ?? "staff",
        });
        return { success: true } as const;
      }),

    toggleUrgent: staffOrAdminProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.staff && ctx.staff.role === "nurse") {
          const floorId = await machineDb.getSessionFloorId(input.sessionId);
          if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
        }
        await machineDb.toggleUrgent({ sessionId: input.sessionId });
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
        await machineDb.setRepairFlag({ sessionId: input.sessionId, flag: input.flag });
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
          throw error;
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
        await machineDb.updateIsolationTag({
          sessionId: input.sessionId,
          isolationTag: input.isolationTag,
        });
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
          throw error;
        }
      }),
  }),

  waiting: router({
    /** Waiting patients per floor. Public so every staff device sees the same queue. */
    list: publicProcedure
      .input(z.object({ floorId: z.number().int().positive() }))
      .query(({ input }) => machineDb.listWaiting({ floorId: input.floorId })),
    /**
     * Cross-board urgent register: urgent-flagged active sessions from every
     * floor plus very-urgent patients still waiting anywhere. Public so all
     * staff devices see the same consolidated register.
     */
    urgentRegister: publicProcedure.query(async () => {
      const [sessions, waiting, floors] = await Promise.all([
        machineDb.listMachines(),
        machineDb.listWaitingAll(),
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
            patientId: s.patientId,
            durationMinutes: s.durationMinutes,
            endsAt: s.endsAt,
            isolationTag: s.isolationTag,
          };
        })
        .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());

      const veryUrgentWaiting = waiting
        .filter((e: { priority: string }) => e.priority === "veryUrgent")
        .map((e: { id: number; patientId: string; floorId: number; priority: string; joinedAt: Date }) => ({
          kind: "waiting" as const,
          waitingId: e.id,
          patientId: e.patientId,
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
          throw error;
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
        await machineDb.removeWaiting({ entryId: input.entryId, floorId: input.floorId });
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
        await machineDb.markWaitingUrgent({
          entryId: input.entryId,
          floorId: input.floorId,
          priority: input.priority,
        });
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
          await machineDb.admitWaiting({
            entryId: input.entryId,
            floorId: input.floorId,
            durationMinutes: input.durationMinutes,
            isolationTag: input.isolationTag,
            urgent: input.urgent,
            startedBy: ctx.user?.name ?? ctx.user?.email ?? ctx.staff?.displayName ?? "staff",
            displayLabel: input.displayLabel,
            assignedNurse: input.assignedNurse,
          });
          return { success: true, patientId: patient?.patientId ?? "" } as const;
        } catch (error) {
          const msg = (error as Error)?.message;
          if (msg === "NO_WAITING_PATIENT") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This patient is no longer waiting — they may already have been admitted." });
          }
          if (msg === "NO_VACANT_MACHINE") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "No vacant machine on this floor — end or release a session first." });
          }
          throw error;
        }
      }),

    /** Active sessions on a floor grouped for the "Nurse Patient Assignments" list. */
    nurseAssignments: publicProcedure
      .input(z.object({ floorId: z.number().int().positive() }))
      .query(async ({ input }) => {
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
        return machineDb.listNarratives({ floorId: input.floorId, reportDate: input.reportDate });
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
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        try {
          const result = await machineDb.createNarrative(input);
          return { success: true, id: result.id } as const;
        } catch (error) {
          const msg = (error as Error)?.message;
          if (msg === "INVALID_PERIOD") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown reporting period." });
          }
          if (msg === "EMPTY_BODY") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "The narrative cannot be empty." });
          }
          throw error;
        }
      }),

    /** Remove a narrative (staff only, floor-scoped). */
    remove: staffOrAdminProcedure
      .input(z.object({ id: z.number().int().positive(), floorId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
        await machineDb.deleteNarrative({ id: input.id, floorId: input.floorId });
        return { success: true } as const;
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
});

export type AppRouter = typeof appRouter;
