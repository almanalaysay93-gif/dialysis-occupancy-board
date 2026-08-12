import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as machineDb from "./machines";

const durationMinutesSchema = z.enum(["180", "360", "480"]).transform(v => Number(v) as 180 | 360 | 480);
const isolationTagSchema = z.enum(["clean", "dirty"]);

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
          isolationTag: isolationTagSchema,
          urgent: z.boolean().default(false),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await machineDb.assignSession({
            ...input,
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
});

export type AppRouter = typeof appRouter;
