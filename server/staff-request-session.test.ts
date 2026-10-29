import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
vi.mock("./patient-assignment", () => ({ findPatientAssignment: vi.fn() }));
import { findPatientAssignment } from "./patient-assignment";
import { createStaffSessionToken, resolveStaffSession } from "./staffAuth";

describe("request-scoped session reads", () => {
  it("shares concurrent placement reads but rechecks placement on the next request", async () => {
    process.env.JWT_SECRET = "test-session-request-secret";
    const token = await createStaffSessionToken({ accountId: 0, username: "TK-1111", displayName: "Patient", role: "patient", assignedFloorId: 1 });
    const req = () => ({ headers: { cookie: `staff_session_id=${token}` } }) as Request;
    vi.mocked(findPatientAssignment).mockResolvedValue({ ticket: "TK-1111", assignedFloorId: 1, activeBay: null, activeStatus: "waiting" });
    const first = req();
    const results = await Promise.all([resolveStaffSession(first), resolveStaffSession(first), resolveStaffSession(first)]);
    expect(results.every(s => s.assignedFloorId === 1)).toBe(true);
    expect(findPatientAssignment).toHaveBeenCalledTimes(1);
    vi.mocked(findPatientAssignment).mockResolvedValue({ ticket: "TK-1111", assignedFloorId: 2, activeBay: null, activeStatus: "waiting" });
    expect((await resolveStaffSession(req())).assignedFloorId).toBe(2);
    expect(findPatientAssignment).toHaveBeenCalledTimes(2);
  });
});
