import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as machineDb from "./machines";

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
    updateLabel: protectedProcedure
      .input(
        z.object({
          machineId: z.number().int().positive(),
          label: z.string().trim().min(1, "Machine label is required").max(32),
        })
      )
      .mutation(async ({ input }) => {
        try {
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
    add: protectedProcedure
      .input(
        z.object({
          label: z.string().trim().min(1, "Machine label is required").max(32),
          floorId: z.number().int().positive().nullable().default(null),
          location: z.string().trim().max(64).default("—"),
        })
      )
      .mutation(async ({ input }) => {
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
    remove: protectedProcedure
      .input(z.object({ machineId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        try {
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
  }),

  rooms: router({
    /** All rooms (floors) visible on the board. Public so every staff device sees them. */
    list: publicProcedure.query(() => machineDb.listFloors()),

    /** Add a new room (staff only). */
    add: protectedProcedure
      .input(z.object({ name: z.string().trim().min(1, "Room name is required").max(64) }))
      .mutation(async ({ input }) => {
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

    /** Rename a room (staff only). */
    rename: protectedProcedure
      .input(z.object({ roomId: z.number().int().positive(), name: z.string().trim().min(1, "Room name is required").max(64) }))
      .mutation(async ({ input }) => {
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

    /** Remove a room (staff only). Blocks if the room has machines or active sessions. */
    remove: protectedProcedure
      .input(z.object({ roomId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
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
    assign: protectedProcedure
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
          const { customMinutes, ...rest } = input;
          const durationMinutes = rest.durationMinutes ?? (customMinutes as number);
          const result = await machineDb.assignSession({
            ...rest,
            durationMinutes,
            startedBy: ctx.user.name ?? ctx.user.email ?? "staff",
          });
          return { success: true, sessionId: result.id };
        } catch (error) {
          if ((error as Error)?.message === "MACHINE_OCCUPIED") {
            throw new TRPCError({ code: "CONFLICT", message: "This machine already has an active session." });
          }
          throw error;
        }
      }),

    end: protectedProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await machineDb.endSession({
          sessionId: input.sessionId,
          endedBy: ctx.user.name ?? ctx.user.email ?? "staff",
        });
        return { success: true } as const;
      }),

    toggleUrgent: protectedProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await machineDb.toggleUrgent({ sessionId: input.sessionId });
        return { success: true } as const;
      }),

    updateTag: protectedProcedure
      .input(
        z.object({
          sessionId: z.number().int().positive(),
          isolationTag: isolationTagSchema,
        })
      )
      .mutation(async ({ input }) => {
        await machineDb.updateIsolationTag({
          sessionId: input.sessionId,
          isolationTag: input.isolationTag,
        });
        return { success: true } as const;
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
    add: protectedProcedure
      .input(
        z.object({
          floorId: z.number().int().positive(),
          patientId: z.string().trim().min(1, "Patient identifier is required").max(64),
          priority: waitingPrioritySchema.default("normal"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await machineDb.addWaiting({
            floorId: input.floorId,
            patientId: input.patientId,
            priority: input.priority,
            addedBy: ctx.user.name ?? ctx.user.email ?? "staff",
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
    remove: protectedProcedure
      .input(
        z.object({
          entryId: z.number().int().positive(),
          floorId: z.number().int().positive(),
        })
      )
      .mutation(async ({ input }) => {
        await machineDb.removeWaiting({ entryId: input.entryId, floorId: input.floorId });
        return { success: true } as const;
      }),

    /** Change a waiting patient's priority (staff only), e.g. escalate to very urgent. */
    setPriority: protectedProcedure
      .input(
        z.object({
          entryId: z.number().int().positive(),
          floorId: z.number().int().positive(),
          priority: waitingPrioritySchema,
        })
      )
      .mutation(async ({ input }) => {
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
    admit: protectedProcedure
      .input(
        z.object({
          entryId: z.number().int().positive(),
          floorId: z.number().int().positive(),
          durationMinutes: z.number().int().min(15).max(1440),
          isolationTag: isolationTagSchema,
          urgent: z.boolean().default(false),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const entry = await machineDb.listWaiting({ floorId: input.floorId });
        const patient = entry.find(e => e.id === input.entryId);
        try {
          await machineDb.admitWaiting({
            entryId: input.entryId,
            floorId: input.floorId,
            durationMinutes: input.durationMinutes,
            isolationTag: input.isolationTag,
            urgent: input.urgent,
            startedBy: ctx.user.name ?? ctx.user.email ?? "staff",
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
  }),
});

export type AppRouter = typeof appRouter;
