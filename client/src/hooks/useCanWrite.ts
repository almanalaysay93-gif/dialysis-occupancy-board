import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

/**
 * Single source of truth for "may this viewer change the board?".
 *
 * `staff.me` always answers — it falls back to a guest session when no staff
 * cookie is present — so the role alone cannot be trusted: only a guest
 * session that came from an actual guest cookie means "explicitly browsing as
 * a guest", and that locks writes even for a signed-in owner. Without any
 * staff cookie, an OAuth user keeps full access, matching the server's
 * staffOrAdminProcedure rules.
 */
export function useCanWrite() {
  const { isAuthenticated } = useAuth();
  const { data: staff } = trpc.staff.me.useQuery(undefined, {
    retry: false,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const role = staff?.role ?? null;
  const isBoardStaff = role === "nurse" || role === "supervisor" || role === "auditor";
  const isPatientMode = role === "patient";
  const isGuestMode = role === "guest" || isPatientMode;
  // Auth state has resolved — until the staff.me query settles, identity is
  // unknown and clinical panels must stay hidden to avoid a flash of exposure
  // for guest viewers (especially on slow/mobile connections).
  const resolved = staff !== undefined;

  return {
    canWrite: isBoardStaff || (isAuthenticated && !isGuestMode),
    isGuest: isGuestMode,
    isPatient: isPatientMode,
    /** Clinical panels (Waiting List, Nurse Assignments, Narrative Report)
     *  are staff-only. They must stay hidden in every one of these states:
     *  - the identity query has not settled yet (flash protection), or
     *  - the viewer is a guest — explicitly entered via the guest entry, or
     *    an unauthenticated visitor served the guest fallback session. An
     *    explicit guest role is ALWAYS a viewer, regardless of how the
     *    session cookie got there (this closes the gap where a missing or
     *    expired staff cookie made the fallback appear as "resolved, not
     *    guest" and leaked the clinical panels to viewers with a Guest
     *    identity). */
    isClinicalHidden: !resolved || isGuestMode,
    role,
    staff,
  };
}
