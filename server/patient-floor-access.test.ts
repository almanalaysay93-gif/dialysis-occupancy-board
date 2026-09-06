import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { createStaffSessionToken, verifyStaffSession, type StaffSession } from "./staffAuth";

const { resolve, assignment, listMachines, listFloors, listWaiting, countVacant } = vi.hoisted(() => ({
  resolve: vi.fn(), assignment: vi.fn(), listMachines: vi.fn(), listFloors: vi.fn(), listWaiting: vi.fn(), countVacant: vi.fn(),
}));
vi.mock("./patient-assignment", () => ({ findPatientAssignment: assignment }));
vi.mock("./staffAuth", async original => ({ ...await original<typeof import("./staffAuth")>(), resolveStaffSession: resolve }));
vi.mock("./machines", async original => ({
  ...await original<typeof import("./machines")>(), listMachines, listFloors, listWaiting, countVacantMachines: countVacant,
}));

const patient: StaffSession = { accountId: 0, username: "TK-5138", displayName: "Patient", role: "patient", assignedFloorId: 4, fromCookie: true };
function context(): TrpcContext {
  return { user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { cookie: vi.fn() } as unknown as TrpcContext["res"] };
}

describe("patient floor access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolve.mockResolvedValue(patient);
    assignment.mockResolvedValue({ ticket: "TK-5138", assignedFloorId: 4, activeBay: "ICU-04", activeStatus: "in_treatment" });
    listMachines.mockResolvedValue([{ machine: { id: 1, floorId: 1 } }, { machine: { id: 2, floorId: 4 } }, { machine: { id: 3, floorId: null } }]);
    listFloors.mockResolvedValue([{ id: 1, name: "Main" }, { id: 4, name: "ICU" }]);
    listWaiting.mockResolvedValue([{ ticket: "TK-5138" }]);
    countVacant.mockResolvedValue(1);
  });

  it.each(["PT-123", "TK-5138"])("login by %s returns and signs the assigned floor", async ticketOrId => {
    const ctx = context();
    const result = await appRouter.createCaller(ctx).staff.patientLogin({ ticketOrId });
    expect(assignment).toHaveBeenCalledWith(ticketOrId);
    expect(result.assignedFloorId).toBe(4);
    expect(result.ticket).toBe("TK-5138");
    const token = vi.mocked(ctx.res.cookie).mock.calls[0][1];
    expect((await verifyStaffSession(token))?.assignedFloorId).toBe(4);
  });

  it("returns only assigned machines and floor metadata through both floor endpoints", async () => {
    const caller = appRouter.createCaller(context());
    expect(await caller.machines.list()).toEqual([{ machine: { id: 2, floorId: 4 } }]);
    expect(listMachines).toHaveBeenCalledWith({ canSeePhi: false });
    expect(await caller.machines.listFloors()).toEqual([{ id: 4, name: "ICU" }]);
    expect(await caller.rooms.list()).toEqual([{ id: 4, name: "ICU" }]);
  });

  it("allows assigned queue but denies a forged floor parameter before reading data", async () => {
    const caller = appRouter.createCaller(context());
    expect(await caller.waiting.list({ floorId: 4 })).toEqual([{ ticket: "TK-5138" }]);
    await expect(caller.waiting.list({ floorId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(listWaiting).toHaveBeenCalledTimes(1);
    await expect(caller.waiting.vacantCount({ floorId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(countVacant).not.toHaveBeenCalled();
  });

  it("returns no boards when placement is absent, including machines without a floor", async () => {
    resolve.mockResolvedValue({ ...patient, assignedFloorId: null });
    const caller = appRouter.createCaller(context());
    expect(await caller.machines.list()).toEqual([]);
    expect(await caller.machines.listFloors()).toEqual([]);
    expect(await caller.rooms.list()).toEqual([]);
    await expect(caller.waiting.list({ floorId: 4 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refreshes placement for old cookies and transfers, then removes access after discharge", async () => {
    const token = await createStaffSessionToken({ ...patient, assignedFloorId: null });
    expect((await verifyStaffSession(token))?.assignedFloorId).toBe(4);
    assignment.mockResolvedValue({ assignedFloorId: 2 });
    expect((await verifyStaffSession(token))?.assignedFloorId).toBe(2);
    assignment.mockResolvedValue(null);
    expect(await verifyStaffSession(token)).toMatchObject({ role: "patient", assignedFloorId: null });
  });

  it("fails closed during a placement lookup error", async () => {
    const token = await createStaffSessionToken(patient);
    assignment.mockRejectedValue(new Error("Database unavailable"));
    expect(await verifyStaffSession(token)).toMatchObject({ role: "patient", assignedFloorId: null });
  });

  it("denies other board and clinical endpoints even with an OAuth user", async () => {
    const ctx = context();
    ctx.user = { id: 1, role: "admin" } as TrpcContext["user"];
    const caller = appRouter.createCaller(ctx);
    expect(await caller.machines.list()).toEqual([{ machine: { id: 2, floorId: 4 } }]);
    await expect(caller.waiting.urgentRegister()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.shiftEndorsements.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each(["supervisor", "nurse", "guest", "patient.guest"])("preserves %s board access", async role => {
    resolve.mockResolvedValue({ ...patient, role: role === "patient.guest" ? "patient" : role, username: role });
    const caller = appRouter.createCaller(context());
    expect(await caller.machines.list()).toHaveLength(3);
    expect(await caller.machines.listFloors()).toHaveLength(2);
  });
});
