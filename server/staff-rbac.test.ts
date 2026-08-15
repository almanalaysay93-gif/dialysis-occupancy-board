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
  updateMachineLabel: vi.fn(async () => undefined),
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
    machineMetrics: {},
    pauseSummary: { totalPausedMinutes: 0, machinesPaused: 0 },
  })),
  listNarratives: vi.fn(async () => []),
  createNarrative: vi.fn(async () => ({ id: 99 })),
  deleteNarrative: vi.fn(async () => undefined),
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
import { hashWithSalt, verifyStaffSession } from "./staffAuth";

async function resolveStaffSessionFor(token: string) {
  const staff = await verifyStaffSession(token);
  if (staff) return staff;
  return { role: "guest", fromCookie: false } as const;
}

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

describe("narrative reports", () => {
  it("nurse can list and create narratives for their own floor", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "nurse.sk",
      displayName: "SKTI Nurse",
      role: "nurse" as const,
      assignedFloorId: 1,
    });
    const ctx = makeCtx();
    const list = await caller(ctx).narratives.list({ floorId: 1, reportDate: "2026-08-15" });
    expect(machineDb.listNarratives).toHaveBeenCalledWith({ floorId: 1, reportDate: "2026-08-15" });
    expect(list).toEqual([]);

    const created = await caller(ctx).narratives.create({
      floorId: 1,
      reportDate: "2026-08-15",
      periodKey: "session1",
      shiftKey: "05-13",
      author: "SKTI Nurse",
      body: "All patients hooked on time.",
    });
    expect(created.success).toBe(true);
    expect(machineDb.createNarrative).toHaveBeenCalledOnce();
  });

  it("nurse cannot create narratives for another floor", async () => {
    // Floor scoping in requireFloorAccess only applies to staff-cookie sessions
    // (ctx.user null); an OAuth user keeps global access, so drop the OAuth user.
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "nurse.sk",
      displayName: "SKTI Nurse",
      role: "nurse" as const,
      assignedFloorId: 1,
    });
    const ctx = { ...makeCtx(), user: null } as TrpcContext;
    await expect(
      caller(ctx).narratives.create({
        floorId: 2,
        reportDate: "2026-08-15",
        periodKey: "session2",
        shiftKey: null,
        author: "SKTI Nurse",
        body: "Should not persist.",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(machineDb.createNarrative).not.toHaveBeenCalled();
  });

  it("supervisor can create narratives for any floor; guest cannot", async () => {
    const ctx = makeCtx(); // supervisor via staff cookie + OAuth user still passes
    const created = await caller(ctx).narratives.create({
      floorId: 2,
      reportDate: "2026-08-15",
      periodKey: "transition1",
      shiftKey: "07-15",
      author: "Supervisor",
      body: "Two patients admitted from waiting list.",
    });
    expect(created.success).toBe(true);

    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "guest",
      displayName: "Guest",
      role: "guest" as const,
      assignedFloorId: null,
      fromCookie: true,
    });
    const guestCtx = { ...makeCtx(), user: null } as TrpcContext;
    // Guests may view narratives (read-only); writing stays blocked.
    const entries = await caller(guestCtx).narratives.list({ floorId: 1, reportDate: "2026-08-15" });
    expect(Array.isArray(entries)).toBe(true);
    (machineDb.createNarrative as ReturnType<typeof vi.fn>).mockClear();
    await expect(
      caller(guestCtx).narratives.create({
        floorId: 1,
        reportDate: "2026-08-15",
        periodKey: "session1",
        author: "Guest",
        body: "Guests cannot write.",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(machineDb.createNarrative).not.toHaveBeenCalled();
  });

  it("endOfDay summary includes pause and idle metrics", async () => {
    const ctx = makeCtx();
    const report = await caller(ctx).endOfDay.summary({ floorId: 1, date: "2026-08-15" });
    expect(report.machineMetrics).toBeDefined();
    expect(report.pauseSummary).toEqual({ totalPausedMinutes: 0, machinesPaused: 0 });
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

  it("login bumps the token version so old tokens are revoked", async () => {
    const { hash, salt } = hashWithSalt("correct");
    // Simulate the DB tracking the tokenVersion: every bump (login/logout)
    // increments the version returned by subsequent reads.
    let storedVersion = 1;
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () =>
              [
                {
                  id: 11,
                  username: "nurse.sk",
                  displayName: "SKTI Nurse",
                  role: "nurse",
                  assignedFloorId: 1,
                  active: true,
                  passwordHash: hash,
                  passwordSalt: salt,
                  tokenVersion: storedVersion,
                  lastSignedIn: new Date(),
                },
              ] as never[]
            ),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => {
            storedVersion += 1;
            return undefined;
          }) as never,
        })),
      })),
    } as unknown as Db;
    mockDb.mockResolvedValue(db);
    // First login signs tokenVersion 1→2 into the cookie-bearing token.
    const ctx = makeCtx();
    const first = await caller(ctx).staff.login({ username: "nurse.sk", password: "correct" });
    expect(first.success).toBe(true);
    const tokenCall = (ctx.res.cookie as ReturnType<typeof vi.fn>).mock.calls.find(
      c => c[0] === "staff_session_id" && c[1] !== ""
    );
    expect(tokenCall).toBeTruthy();
    const firstToken = tokenCall![1] as string;
    // A second login bumps to version 3 — the first token must stop working.
    const ctx2 = makeCtx();
    await caller(ctx2).staff.login({ username: "nurse.sk", password: "correct" });
    const resolved = await resolveStaffSessionFor(firstToken);
    expect(resolved.role).toBe("guest");
  });

  it("logout revokes the current token", async () => {
    // bumpTokenVersion needs db.update().set().where() in the logout path.
    mockDb.mockResolvedValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 1, tokenVersion: 1 }] as never[]) })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(async () => undefined) as never })),
      })),
    } as unknown as Db);
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

  it("guest may view the report read-only (floor defaults to undefined, no write calls)", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "guest",
      displayName: "Guest",
      role: "guest" as const,
      assignedFloorId: null,
      fromCookie: true,
    });
    const ctx = makeCtx();
    const report = await caller(ctx).endOfDay.summary({});
    expect(report.reportDate).toBeTruthy();
    const call = (machineDb.endOfDayReport as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { floorId?: number };
    expect(call.floorId).toBeUndefined();
    expect(machineDb.createNarrative).not.toHaveBeenCalled();
  });

  it("guest may view a board's narratives but cannot write one", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "guest",
      displayName: "Guest",
      role: "guest" as const,
      assignedFloorId: null,
      fromCookie: true,
    });
    const ctx = makeCtx();
    const entries = await caller(ctx).narratives.list({ floorId: 1, reportDate: "2026-08-15" });
    expect(Array.isArray(entries)).toBe(true);
    await expect(
      caller(ctx).narratives.create({
        floorId: 1,
        reportDate: "2026-08-15",
        periodKey: "session1",
        author: "Guest",
        body: "Guests cannot write narratives.",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(machineDb.createNarrative).not.toHaveBeenCalled();
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

describe("machine rename scoping", () => {
  it("nurse cannot rename a machine on another floor", async () => {
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
      caller(ctx).machines.updateLabel({ machineId: 3, label: "HD-999" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(machineDb.updateMachineLabel).not.toHaveBeenCalled();
  });

  it("nurse can rename a machine on their own floor", async () => {
    mockResolve.mockResolvedValue({
      accountId: 7,
      username: "nurse.rdu",
      displayName: "RDU Nurse",
      role: "nurse" as const,
      assignedFloorId: 1,
    });
    const ctx = { ...makeCtx(), user: null } as TrpcContext;
    const result = await caller(ctx).machines.updateLabel({ machineId: 3, label: "HD-004" });
    expect(result.success).toBe(true);
    expect(machineDb.updateMachineLabel).toHaveBeenCalledWith({ machineId: 3, label: "HD-004" });
  });
});

describe("guest mode", () => {
  it("issues a signed guest JWT cookie that locks writes server-side", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "guest",
      displayName: "Guest",
      role: "guest" as const,
      assignedFloorId: null,
      fromCookie: false,
    });
    const ctx = makeCtx() as TrpcContext;
    const result = await caller(ctx).staff.guest();
    expect(result.success).toBe(true);
    const cookieCall = (ctx.res.cookie as ReturnType<typeof vi.fn>).mock.calls.find(
      c => c[0] === "staff_session_id" && typeof c[1] === "string" && c[1] !== ""
    );
    expect(cookieCall).toBeDefined();
    const token = cookieCall![1] as string;
    // The guest token must verify as a JWT carrying the guest role.
    const session = await verifyStaffSession(token);
    expect(session?.role).toBe("guest");
    expect(session?.fromCookie).toBeUndefined();
  });

  it("a guest cookie blocks writes even for a signed-in OAuth owner", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "guest",
      displayName: "Guest",
      role: "guest" as const,
      assignedFloorId: null,
      fromCookie: true,
    });
    const ctx: TrpcContext = {
      ...makeCtx(),
      user: { ...makeCtx().user!, role: "admin", name: "Owner" },
    } as TrpcContext;
    await expect(
      caller(ctx).machines.remove({ machineId: 3 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
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
