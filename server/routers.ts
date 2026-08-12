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
