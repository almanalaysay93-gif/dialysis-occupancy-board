import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { resolveStaffSession, type StaffSession } from "../staffAuth";
import { invalidateBoardCache } from "../machines";

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
 * Staff read access: accepts any board staff session (nurse / supervisor /
 * guest cookie) or a logged-in OAuth user. Used for read-only endpoints —
 * guests may view but never edit (write endpoints stay on staffOrAdminProcedure).
 */
export const staffReadProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const staff: StaffSession = await resolveStaffSession(ctx.req);
    const oauthUser = ctx.user;
    // Anonymous visitors (no staff cookie, no OAuth) count as read-only
    // viewers — the same visibility as board content (machines.list is
    // fully public). Write endpoints stay on staffOrAdminProcedure.
    if (!staff.fromCookie && !oauthUser) {
      return next({
        ctx: { ...ctx, user: null, staff, isStaff: false as const },
      });
    }
    if (staff.role === "guest" && staff.fromCookie) {
      return next({
        ctx: { ...ctx, user: null, staff, isStaff: false as const },
      });
    }
    if (oauthUser) {
      return next({
        ctx: { ...ctx, user: oauthUser, staff, isStaff: true as const },
      });
    }
    // Auditors are read-only staff: they never write but may view the
    // read-only report endpoints alongside nurses and supervisors.
    if (staff.role === "nurse" || staff.role === "supervisor" || staff.role === "auditor") {
      return next({
        ctx: { ...ctx, user: null, staff, isStaff: true as const },
      });
    }
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }),
);

/**
 * Staff-or-admin: accepts either a logged-in OAuth user (role admin/user) or
 * a board staff session cookie (nurse/supervisor). Guests (no credentials) are
 * rejected with UNAUTHORIZED. Exposes `staff` on the context for scoping.
 */
/**
 * Supervisor-only access: accepts the SKTI Supervisor staff session or a
 * logged-in OAuth admin user. Nurses, auditors, and guests are rejected with
 * FORBIDDEN. Used for endpoints that only the supervisor may run, such as the
 * End of Month report export.
 */
export const supervisorProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const staff: StaffSession = await resolveStaffSession(ctx.req);
    const oauthUser = ctx.user;
    // OAuth admin users (the owner's Google login) keep full access.
    if (oauthUser && oauthUser.role === "admin") {
      return next({
        ctx: { ...ctx, user: oauthUser, staff, isStaff: true as const },
      });
    }
    if (staff.role === "supervisor") {
      return next({
        ctx: { ...ctx, user: oauthUser ?? null, staff, isStaff: true as const },
      });
    }
    throw new TRPCError({ code: "FORBIDDEN", message: "This action is reserved for the supervisor." });
  }),
);

/**
 * Drops the short-lived board cache after any write so the client refetch
 * that follows a mutation never reads a pre-write snapshot.
 */
const invalidateBoardAfterWrite = t.middleware(async opts => {
  const result = await opts.next();
  if (opts.type === "mutation") invalidateBoardCache();
  return result;
});

export const staffOrAdminProcedure = t.procedure.use(invalidateBoardAfterWrite).use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
        const staff: StaffSession = await resolveStaffSession(ctx.req);
    const oauthUser = ctx.user;
    // A guest staff session (opted in via the staff guest mode, i.e. a guest
    // cookie) locks out all writing even when an OAuth user is also signed in
    // — the UI enforces the same rule. A request with no staff cookie at all
    // is not "guest mode" and OAuth users keep access.
    if (staff.role === "guest" && staff.fromCookie) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    // OAuth admin/user users (e.g. the owner's Google login) keep full access.
    if (oauthUser) {
      return next({
        ctx: { ...ctx, user: oauthUser, staff, isStaff: true as const },
      });
    }
    // Board staff (nurse/supervisor) may perform write actions.
    // Auditors are authenticated as staff but self-gate to read-only views.
    if (staff.role === "nurse" || staff.role === "supervisor" || staff.role === "auditor") {
      return next({
        ctx: { ...ctx, user: null, staff, isStaff: true as const },
      });
    }
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }),
);
