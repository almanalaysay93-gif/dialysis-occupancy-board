import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { resolveStaffSession, type StaffSession } from "../staffAuth";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/**
 * Staff-or-admin: accepts either a logged-in OAuth user (role admin/user) or
 * a board staff session cookie (nurse/supervisor). Guests (no credentials) are
 * rejected with UNAUTHORIZED. Exposes `staff` on the context for scoping.
 */
export const staffOrAdminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const staff: StaffSession = await resolveStaffSession(ctx.req);
    const oauthUser = ctx.user;

    // OAuth admin/user users (e.g. the owner's Google login) keep full access.
    if (oauthUser) {
      return next({
        ctx: { ...ctx, user: oauthUser, staff, isStaff: true as const },
      });
    }
    // Board staff (nurse/supervisor) may perform write actions.
    if (staff.role === "nurse" || staff.role === "supervisor") {
      return next({
        ctx: { ...ctx, user: null, staff, isStaff: true as const },
      });
    }
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }),
);
