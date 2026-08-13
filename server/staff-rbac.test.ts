import { beforeEach, describe, expect, it, vi } from "vitest";

// Vitest doesn't load the app's .env, so provide a signing secret for the
// staff JWT used by createStaffSessionToken inside the login path.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ---------------- mocks ----------------

vi.mock("./machines", () => ({
  listFloors: vi.fn(async () => [
    { id: 1, code: "F1", name: "SKTI Main", sortOrder: 1 },
    { id: 2, code: "F2", name: "RDU Annex", sortOrder: 2 },
  ]),
  listMachines: vi.fn(async () => []),
  addRoom: vi.fn(async () => ({ id: 42 })),
  removeRoom: vi.fn(async () => undefined),
  renameRoom: vi.fn(async () => undefined),
  addMachine: vi.fn(async () => ({ id: 7 })),
  removeMachine: vi.fn(async () => undefined),
  assignSession: vi.fn(async () => ({ id: 11 })),
  getMachineById: vi.fn(async (id: number) =>
    id === 3 ? { id: 3, label: "HD-003", floorId: 1 } : null
  ),
  endSession: vi.fn(async () => undefined),
  toggleUrgent: vi.fn(async () => undefined),
  updateIsolationTag: vi.fn(async () => undefined),
  updateSessionLabel: vi.fn(async () => undefined),
  listWaiting: vi.fn(async () => []),
  listWaitingAll: vi.fn(async () => []),
  addWaiting: vi.fn(async () => ({ id: 42 })),
  removeWaiting: vi.fn(async () => undefined),
  markWaitingUrgent: vi.fn(async () => undefined),
  countVacantMachines: vi.fn(async () => 3),
  admitWaiting: vi.fn(async () => undefined),
  listNurseAssignments: vi.fn(async () => []),
  endOfDayReport: vi.fn(async (opts?: { floorId?: number; date?: string }) => ({
    reportDate: opts?.date ?? "2026-08-13",
    floorName: opts?.floorId === 2 ? "RDU Annex" : "SKTI Main",
    totalMachinesOnFloor: 100,
    sessionsEnded: 5,
    machinesUtilized: { used: 4, total: 100 },
    patientsCatered: 5,
    urgency: { normal: 3, urgent: 2, veryUrgent: 0 },
    isolation: { clean: 4, dirty: 1 },
    totalTreatmentHours: 20,
    waitingAdds: { normal: 1, urgent: 1, veryUrgent: 0, total: 2 },
    sessions: [],
  })),
}));
import * as machineDb from "./machines";

const { mockDb } = vi.hoisted(() => ({ mockDb: vi.fn() }));
vi.mock("./db", async importOriginal => {
  const mod = await importOriginal<typeof import("./db")>();
  return {
    ...mod,
    getDb: mockDb,
  };
});
import type { Db } from "./db";
import { hashWithSalt } from "./staffAuth";

const { mockResolve } = vi.hoisted(() => ({ mockResolve: vi.fn() }));
vi.mock("./staffAuth", async importOriginal => {
  const mod = await importOriginal<typeof import("./staffAuth")>();
  return {
    ...mod,
    resolveStaffSession: mockResolve,
    staffAccessedFloors: vi.fn((staff: { role: string; assignedFloorId: number | null }) => {
      if (staff.role === "supervisor") return null;
      if (staff.assignedFloorId) return [staff.assignedFloorId];
      return [];
    }),
  };
});

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: "staff-user",
    email: "staff@clinic.example",
    name: "Staff Member",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const caller = appRouter.createCaller;

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockResolvedValue({
    accountId: 0,
    username: "",
    displayName: "",
    role: "supervisor" as const,
    assignedFloorId: null,
  });
});

describe("staff authentication", () => {
  it("guest without cookie resolves to guest session", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "guest",
      displayName: "Guest",
      role: "guest" as const,
      assignedFloorId: null,
    });
    const ctx = makeCtx();
    const result = await caller(ctx).staff.me();
    expect(result.role).toBe("guest");
  });

  it("login with invalid credentials throws UNAUTHORIZED", async () => {
    // With db mocked to null, any login must fail at the database gate.
    const ctx = makeCtx();
    await expect(
      caller(ctx).staff.login({ username: "nurse1", password: "wrong" })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("login succeeds and sets the staff session cookie", async () => {
    const { hash, salt } = hashWithSalt("correct");
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [
              {
                id: 11,
                username: "nurse.sk",
                displayName: "SKTI Nurse",
                role: "nurse",
                assignedFloorId: 1,
                active: true,
                passwordHash: hash,
                passwordSalt: salt,
                lastSignedIn: new Date(),
              },
            ]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    } as unknown as Db;
    mockDb.mockResolvedValue(db);
    const ctx = makeCtx();
    const result = await caller(ctx).staff.login({
      username: "nurse.sk",
      password: "correct",
    });
    expect(result.success).toBe(true);
    expect(result.role).toBe("nurse");
    // setStaffSessionCookie sets the cookie asynchronously (after the JWT
    // is signed), so flush pending promises before asserting. Catch any
    // unhandled rejection from the JWT chain for diagnostic clarity.
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    expect((ctx.res.cookie as ReturnType<typeof vi.fn>).mock.calls.some(
      c => c[0] === "staff_session_id" && c[1] !== ""
    )).toBe(true);
  });

  it("login rejects inactive accounts", async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [
              {
                id: 12,
                username: "nurse.off",
                displayName: "Off Duty Nurse",
                role: "nurse",
                assignedFloorId: 1,
                active: false,
                passwordHash: "abcd",
                passwordSalt: "salt123",
                lastSignedIn: new Date(),
              },
            ]),
          })),
        })),
      })),
    } as unknown as Db;
    mockDb.mockResolvedValue(db);
    const ctx = makeCtx();
    await expect(
      caller(ctx).staff.login({ username: "nurse.off", password: "correct" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("login with empty username is rejected by zod", async () => {
    const ctx = makeCtx();
    await expect(
      caller(ctx).staff.login({ username: "   ", password: "secret" })
    ).rejects.toThrow();
  });

  it("logout clears the staff cookie and reports success", async () => {
    const ctx = makeCtx();
    const result = await caller(ctx).staff.logout();
    expect(result.success).toBe(true);
    expect((ctx.res.cookie as ReturnType<typeof vi.fn>).mock.calls.some(
      c => c[0] === "staff_session_id" && c[1] === ""
    )).toBe(true);
  });
});

describe("end of day report scoping", () => {
  it("supervisor may request the summary without a floor scope", async () => {
    mockResolve.mockResolvedValue({
      accountId: 5,
      username: "supervisor",
      displayName: "SKTI Supervisor",
      role: "supervisor" as const,
      assignedFloorId: null,
    });
    const ctx = { ...makeCtx(), user: null } as TrpcContext;
    const report = await caller(ctx).endOfDay.summary({});
    expect(report.reportDate).toBeTruthy();
    // Nurse floor scope should not have been applied.
    const call = (machineDb.endOfDayReport as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { floorId?: number };
    expect(call.floorId).toBeUndefined();
  });

  it("nurse without a floorId input defaults to their assigned floor", async () => {
    mockResolve.mockResolvedValue({
      accountId: 7,
      username: "nurse.rdu",
      displayName: "RDU Nurse",
      role: "nurse" as const,
      assignedFloorId: 2,
    });
    const ctx = makeCtx();
    const report = await caller(ctx).endOfDay.summary({});
    const call = (machineDb.endOfDayReport as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { floorId?: number };
    expect(call.floorId).toBe(2);
  });

  it("nurse cannot scope the report to a floor outside their assignment", async () => {
    mockResolve.mockResolvedValue({
      accountId: 7,
      username: "nurse.rdu",
      displayName: "RDU Nurse",
      role: "nurse" as const,
      assignedFloorId: 2,
    });
    const ctx = { ...makeCtx(), user: null } as TrpcContext;
    await expect(
      caller(ctx).endOfDay.summary({ floorId: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("guest cannot read the report (staff-only)", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "guest",
      displayName: "Guest",
      role: "guest" as const,
      assignedFloorId: null,
      fromCookie: true,
    });
    const ctx = makeCtx();
    await expect(caller(ctx).endOfDay.summary({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(machineDb.endOfDayReport).not.toHaveBeenCalled();
  });
});

describe("room management scoping (supervisor-only)", () => {
  it("nurse cannot add a room", async () => {
    mockResolve.mockResolvedValue({
      accountId: 7,
      username: "nurse.rdu",
      displayName: "RDU Nurse",
      role: "nurse" as const,
      assignedFloorId: 2,
    });
    const ctx = { ...makeCtx(), user: null } as TrpcContext;
    await expect(
      caller(ctx).rooms.add({ name: "New Room" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(machineDb.addRoom).not.toHaveBeenCalled();
  });

  it("nurse cannot rename a room", async () => {
    mockResolve.mockResolvedValue({
      accountId: 7,
      username: "nurse.rdu",
      displayName: "RDU Nurse",
      role: "nurse" as const,
      assignedFloorId: 2,
    });
    const ctx = { ...makeCtx(), user: null } as TrpcContext;
    await expect(
      caller(ctx).rooms.rename({ roomId: 1, name: "Renamed" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(machineDb.renameRoom).not.toHaveBeenCalled();
  });

  it("nurse cannot remove a room", async () => {
    mockResolve.mockResolvedValue({
      accountId: 7,
      username: "nurse.rdu",
      displayName: "RDU Nurse",
      role: "nurse" as const,
      assignedFloorId: 2,
    });
    const ctx = { ...makeCtx(), user: null } as TrpcContext;
    await expect(
      caller(ctx).rooms.remove({ roomId: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(machineDb.removeRoom).not.toHaveBeenCalled();
  });

  it("supervisor may manage rooms", async () => {
    mockResolve.mockResolvedValue({
      accountId: 5,
      username: "supervisor",
      displayName: "SKTI Supervisor",
      role: "supervisor" as const,
      assignedFloorId: null,
    });
    const ctx = makeCtx();
    const result = await caller(ctx).rooms.add({ name: "New Room" });
    expect(result.success).toBe(true);
  });

  it("OAuth admin (owner) may manage rooms", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "guest",
      displayName: "Guest",
      role: "guest" as const,
      assignedFloorId: null,
      fromCookie: false,
    });
    const ctx: TrpcContext = {
      ...makeCtx(),
      user: { ...makeCtx().user!, role: "admin", name: "Owner" },
    } as TrpcContext;
    const result = await caller(ctx).rooms.add({ name: "Owner Room" });
    expect(result.success).toBe(true);
  });
});

describe("machine removal scoping", () => {
  it("nurse cannot remove a machine on another floor", async () => {
    mockResolve.mockResolvedValue({
      accountId: 7,
      username: "nurse.rdu",
      displayName: "RDU Nurse",
      role: "nurse" as const,
      assignedFloorId: 2,
    });
    // HD-003 lives on floor 1; nurse is assigned to floor 2.
    const ctx = { ...makeCtx(), user: null } as TrpcContext;
    await expect(
      caller(ctx).machines.remove({ machineId: 3 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(machineDb.removeMachine).not.toHaveBeenCalled();
  });

  it("nurse can remove a machine on their own floor", async () => {
    mockResolve.mockResolvedValue({
      accountId: 7,
      username: "nurse.rdu",
      displayName: "RDU Nurse",
      role: "nurse" as const,
      assignedFloorId: 1,
    });
    const ctx = { ...makeCtx(), user: null } as TrpcContext;
    const result = await caller(ctx).machines.remove({ machineId: 3 });
    expect(result.success).toBe(true);
  });

  it("OAuth admin (owner) can remove any machine", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "guest",
      displayName: "Guest",
      role: "guest" as const,
      assignedFloorId: null,
      fromCookie: false,
    });
    const ctx: TrpcContext = {
      ...makeCtx(),
      user: { ...makeCtx().user!, role: "admin", name: "Owner" },
    } as TrpcContext;
    const result = await caller(ctx).machines.remove({ machineId: 3 });
    expect(result.success).toBe(true);
  });

  it("supervisor can remove any machine", async () => {
    mockResolve.mockResolvedValue({
      accountId: 5,
      username: "supervisor",
      displayName: "SKTI Supervisor",
      role: "supervisor" as const,
      assignedFloorId: null,
    });
    const ctx = makeCtx();
    const result = await caller(ctx).machines.remove({ machineId: 3 });
    expect(result.success).toBe(true);
  });
});

describe("floor scoping on write procedures", () => {
  const nurseCtx = {
    accountId: 7,
    username: "nurse.rdu",
    displayName: "RDU Nurse",
    role: "nurse" as const,
    assignedFloorId: 2,
  };

  it("nurse cannot assign a session on a machine outside their floor", async () => {
    mockResolve.mockResolvedValue(nurseCtx);
    // sessions.assign is protected; staffOrAdminProcedure allows nurse
    // sessions; the floor guard then resolves the machine (HD-003 lives on
    // floor 1 while the nurse is assigned to floor 2) and must reject the
    // write with FORBIDDEN — confirming the guard path runs before any
    // write happens.
    const ctx = { ...makeCtx(), user: null } as TrpcContext;
    await expect(
      caller(ctx).sessions.assign({
        machineId: 3,
        patientId: "P-1",
        durationMinutes: 180,
        isolationTag: "clean",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("guest staff session blocks writes even when an OAuth admin is signed in", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "guest",
      displayName: "Guest",
      role: "guest" as const,
      assignedFloorId: null,
      fromCookie: true,
    });
    // An owner signed in with Manus OAuth (admin-level user) who is also in
    // Guest mode must NOT be able to write — the guest staff session wins.
    const ctx: TrpcContext = {
      ...makeCtx(),
      user: {
        ...makeCtx().user!,
        role: "admin",
        name: "Owner",
        email: "owner@clinic.example",
      },
    } as TrpcContext;
    await expect(
      caller(ctx).sessions.assign({
        machineId: 3,
        patientId: "P-1",
        durationMinutes: 180,
        isolationTag: "clean",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(machineDb.assignSession).not.toHaveBeenCalled();
  });

  it("visitor without any staff cookie may write when signed in via OAuth", async () => {
    // No staff cookie at all (fromCookie false): not guest mode, so the
    // OAuth user keeps full access through staffOrAdminProcedure.
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "guest",
      displayName: "Guest",
      role: "guest" as const,
      assignedFloorId: null,
      fromCookie: false,
    });
    const ctx: TrpcContext = {
      ...makeCtx(),
      user: {
        ...makeCtx().user!,
        role: "admin",
        name: "Owner",
        email: "owner@clinic.example",
      },
    } as TrpcContext;
    await caller(ctx).sessions.assign({
      machineId: 3,
      patientId: "P-1",
      durationMinutes: 180,
      isolationTag: "clean",
    });
    expect(machineDb.assignSession).toHaveBeenCalled();
  });

  it("guest cannot perform write procedures", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "guest",
      displayName: "Guest",
      role: "guest" as const,
      assignedFloorId: null,
    });
    // A guest has no OAuth session (user: null), so staffOrAdminProcedure
    // must reject the write with UNAUTHORIZED.
    const ctx: TrpcContext = {
      ...makeCtx(),
      user: null,
    } as TrpcContext;
    await expect(
      caller(ctx).sessions.assign({
        machineId: 3,
        patientId: "P-1",
        durationMinutes: 180,
        isolationTag: "clean",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
