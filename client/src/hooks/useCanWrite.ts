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
    refetchInterval: 30_000,
  });

  const role = staff?.role ?? null;
  const isBoardStaff = role === "nurse" || role === "supervisor";
  const isGuestMode = role === "guest" && staff?.fromCookie === true;

  return {
    canWrite: isBoardStaff || (isAuthenticated && !isGuestMode),
    isGuest: isGuestMode,
    role,
    staff,
  };
}
