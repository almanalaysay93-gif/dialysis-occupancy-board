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
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const role = staff?.role ?? null;
  const isBoardStaff = role === "nurse" || role === "supervisor";
  const isGuestMode = role === "guest" && staff?.fromCookie === true;
  // Auth state has resolved — until the staff.me query settles, identity is
  // unknown and clinical panels must stay hidden to avoid a flash of exposure
  // for guest viewers (especially on slow/mobile connections).
  const resolved = staff !== undefined;

  return {
    canWrite: isBoardStaff || (isAuthenticated && !isGuestMode),
    isGuest: isGuestMode,
    /** Panels like Waiting/Nurse Assignments/Narrative must require BOTH:
     *  the auth query has resolved AND the viewer is not a guest. */
    isClinicalHidden: !resolved || isGuestMode,
    role,
    staff,
  };
}
