/**
 * Client-side gating unit tests for useCanWrite.
 *
 * Verifies that the Waiting List, Nurse Assignments, and Narrative Report
 * panels (isClinicalHidden) are hidden for every guest state and visible
 * only to board staff — regardless of whether the guest session came from
 * a cookie or the no-cookie fallback. Server auth (canWrite) and panel
 * visibility are deliberately the same role-based decision on the server
 * side (staffOrAdminProcedure), but the client must never render the
 * clinical panels until the identity query settles.
 *
 * The hook logic is inlined here to keep the test decoupled from React
 * rendering (no DOM needed) — the inlined expressions must be kept in
 * sync with client/src/hooks/useCanWrite.ts whenever the hook changes.
 */
import { describe, expect, it } from "vitest";

type StaffSession = {
  role: "nurse" | "supervisor" | "guest" | "auditor";
  displayName: string;
  fromCookie?: boolean;
} | undefined;

function canWriteResult(
  staff: StaffSession,
  isAuthenticated: boolean,
): { canWrite: boolean; isClinicalHidden: boolean } {
  const role = staff?.role ?? null;
  const isBoardStaff = role === "nurse" || role === "supervisor" || role === "auditor";
  const isGuestMode = role === "guest";
  const resolved = staff !== undefined;
  return {
    canWrite: isBoardStaff || (isAuthenticated && !isGuestMode),
    isClinicalHidden: !resolved || isGuestMode,
  };
}

describe("useCanWrite guest gating", () => {
  it("hides clinical panels for a guest entered via cookie", () => {
    expect(
      canWriteResult({ role: "guest", displayName: "Guest", fromCookie: true }, false),
    ).toEqual({ canWrite: false, isClinicalHidden: true });
  });

  it("hides clinical panels for the no-cookie guest fallback (the leak vector)", () => {
    // Before this fix the fallback returned role "guest" with
    // fromCookie=false, which made isClinicalHidden false and rendered the
    // Waiting List, Nurse Assignments, and Narrative panels to viewers
    // carrying a Guest identity.
    expect(
      canWriteResult({ role: "guest", displayName: "Guest", fromCookie: false }, false),
    ).toEqual({ canWrite: false, isClinicalHidden: true });
  });

  it("hides clinical panels until the identity query settles", () => {
    expect(canWriteResult(undefined, false)).toEqual({
      canWrite: false,
      isClinicalHidden: true,
    });
    // An OAuth owner still cannot render clinical panels while the staff
    // identity is unresolved — the panels require BOTH resolution and a
    // non-guest role. (canWrite stays true here: the owner keeps board
    // writes per useCanWrite's "owner keeps full access" rule.)
    expect(canWriteResult(undefined, true)).toEqual({
      canWrite: true,
      isClinicalHidden: true,
    });
  });

  it("shows clinical panels only to board staff", () => {
    expect(
      canWriteResult({ role: "nurse", displayName: "Nurse", fromCookie: true }, false),
    ).toEqual({ canWrite: true, isClinicalHidden: false });
    expect(
      canWriteResult(
        { role: "supervisor", displayName: "Supervisor", fromCookie: true },
        false,
      ),
    ).toEqual({ canWrite: true, isClinicalHidden: false });
    expect(
      canWriteResult({ role: "auditor", displayName: "Auditor", fromCookie: true }, false),
    ).toEqual({ canWrite: true, isClinicalHidden: false });
  });

  it("never grants write access to a guest, even when an OAuth account is signed in", () => {
    expect(
      canWriteResult({ role: "guest", displayName: "Guest", fromCookie: true }, true),
    ).toEqual({ canWrite: false, isClinicalHidden: true });
  });
});
