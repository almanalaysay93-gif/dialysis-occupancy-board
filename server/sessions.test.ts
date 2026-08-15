import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./db";
import { machines, sessions, type Session } from "../drizzle/schema";

type MockRow = {
  select: () => { from: () => Promise<unknown[]> };
};

function mockDbWith(rows: unknown[]) {
  const db: Record<string, unknown> = {};

  // Each drizzle builder step returns a NEW builder, so each call must
  // return a fresh chainable that records its arguments and still resolves.
  // On Postgres, inserts end with .returning(...) which must resolve to the
  // inserted rows, so the chain carries an explicit resolve value.
  const chain = (terminal: unknown, resolveValue = rows) => ({
    from: vi.fn(() => chain(terminal, resolveValue)),
    where: vi.fn(() => chain(terminal, resolveValue)),
    orderBy: vi.fn(() => chain(terminal, resolveValue)),
    limit: vi.fn().mockResolvedValue(rows),
    values: vi.fn(() => chain(terminal, resolveValue)),
    set: vi.fn(() => chain(terminal, resolveValue)),
    // Postgres inserts use .returning({ id: <table>.id }) instead of
    // the MySQL $returningId shortcut; it resolves to the inserted rows.
    returning: vi.fn(() => Promise.resolve([{ id: 99 }])),
    onConflictDoUpdate: vi.fn(() => chain(terminal, resolveValue)),
  });

  db.select = vi.fn(() => chain(undefined));
  db.insert = vi.fn(() => chain(undefined));
  db.update = vi.fn(() => chain(undefined));
  return db;
}

function createAuthContext(name = "Test Staff"): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "staff@example.com",
      name,
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("machines.list", () => {
  it("returns machines joined with their active sessions", async () => {
    const machineRows = [
      { id: 1, label: "HD-01", location: "Bay A", sortOrder: 1, status: "active", statusNote: null },
      { id: 2, label: "HD-02", location: "Bay A", sortOrder: 2, status: "active", statusNote: null },
    ];
    const sessionRows: Session[] = [
      {
        id: 7,
        machineId: 1,
        patientId: "P-101",
        durationMinutes: 180,
        startedAt: new Date(),
        endsAt: new Date(),
        isolationTag: "clean",
        urgent: false,
        status: "active",
        endedAt: null,
        endedBy: null,
        startedBy: "staff",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    let selectCall = 0;
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(sessionRows),
          orderBy: vi.fn().mockResolvedValue(machineRows),
          limit: vi.fn().mockResolvedValue(sessionRows),
        })),
      })),
      insert: vi.fn(),
      update: vi.fn(),
    };
    // machines.list now also filters to status === 'active', so the first
    // machines-select result must surface via the orderBy terminal (used
    // here as the machines query's resolution point).
    db.select.mockImplementation(() => {
      selectCall += 1;
      return {
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(selectCall === 1 ? machineRows : sessionRows),
          orderBy: vi.fn().mockResolvedValue(selectCall === 1 ? machineRows : sessionRows),
          limit: vi.fn().mockResolvedValue(selectCall === 1 ? machineRows : sessionRows),
        })),
      };
    });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.machines.list();

    expect(result).toHaveLength(2);
    expect(result[0]?.session?.patientId).toBe("P-101");
    expect(result[1]?.session).toBeNull();
    // select called for machines then sessions
    expect(db.select).toHaveBeenCalledTimes(2);
  });
});

describe("sessions.assign", () => {
  it("rejects assignment when machine already has an active session", async () => {
    const db = mockDbWith([{ id: 5 }]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    await expect(
      caller.sessions.assign({
        machineId: 1,
        patientId: "P-102",
        durationMinutes: "360",
        isolationTag: "dirty",
        urgent: true,
      })
    ).rejects.toThrow("already has an active session");
  });

  it("creates a session with correct duration-based end time", async () => {
    const db = mockDbWith([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.sessions.assign({
      machineId: 2,
      patientId: "P-103",
      durationMinutes: "180",
      isolationTag: "clean",
      urgent: false,
    });

    expect(result.success).toBe(true);
    expect(db.insert).toHaveBeenCalled();
    const insertChain = (db.insert as ReturnType<typeof vi.fn>).mock.results[0].value as Record<
      string,
      unknown
    >;
    const valuesCalls = (
      insertChain.values as ReturnType<typeof vi.fn>
    ).mock.calls;
    const vals = valuesCalls[0][0] as Record<string, unknown>;
    expect(vals.durationMinutes).toBe(180);
    const started = vals.startedAt as Date;
    const ended = vals.endsAt as Date;
    expect(ended.getTime() - started.getTime()).toBe(180 * 60 * 1000);
    expect(vals.isolationTag).toBe("clean");
    expect(vals.urgent).toBe(false);
    expect(vals.startedBy).toBe("Test Staff");
  });
});

describe("sessions.toggleUrgent and updateTag", () => {
  it("toggles the urgent flag", async () => {
    const db = mockDbWith([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.sessions.toggleUrgent({ sessionId: 7 });
    expect(result.success).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });

  it("updates the isolation tag", async () => {
    const db = mockDbWith([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.sessions.updateTag({
      sessionId: 7,
      isolationTag: "dirty",
    });
    expect(result.success).toBe(true);
  });
});

describe("sessions.end", () => {
  it("marks the session ended and records staff identity", async () => {
    const db = mockDbWith([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext("Nurse J"));
    const result = await caller.sessions.end({ sessionId: 7 });
    expect(result.success).toBe(true);
    const updateChain = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value as Record<
      string,
      unknown
    >;
    const setCalls = (
      updateChain.set as ReturnType<typeof vi.fn>
    ).mock.calls;
    const set = setCalls[0][0] as Record<string, unknown>;
    expect(set.status).toBe("ended");
    expect(set.endedBy).toBe("Nurse J");
    expect(set.endedAt).toBeInstanceOf(Date);
  });
});

describe("sessions.updateLabel (editable highlighted title)", () => {
  it("persists a display label and trims whitespace", async () => {
    const db = mockDbWith([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.sessions.updateLabel({
      sessionId: 7,
      displayLabel: "  Bed 4 — P-101  ",
    });
    expect(result.success).toBe(true);
    expect(db.update).toHaveBeenCalled();
    const updateChain = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value as Record<
      string,
      unknown
    >;
    const setCalls = (updateChain.set as ReturnType<typeof vi.fn>).mock.calls;
    const set = setCalls[0][0] as Record<string, unknown>;
    expect(set.displayLabel).toBe("Bed 4 — P-101");
  });

  it("clears the display label when given null or blank", async () => {
    const db = mockDbWith([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    await caller.sessions.updateLabel({ sessionId: 7, displayLabel: null });
    const chain1 = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value as Record<string, unknown>;
    const set1 = ((chain1.set as ReturnType<typeof vi.fn>).mock.calls[0][0]) as Record<string, unknown>;
    expect(set1.displayLabel).toBeNull();

    await caller.sessions.updateLabel({ sessionId: 7, displayLabel: "   " });
    const chain2 = (db.update as ReturnType<typeof vi.fn>).mock.results[1].value as Record<string, unknown>;
    const set2 = ((chain2.set as ReturnType<typeof vi.fn>).mock.calls[0][0]) as Record<string, unknown>;
    expect(set2.displayLabel).toBeNull();
  });

  it("rejects labels longer than 64 characters", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    await expect(
      caller.sessions.updateLabel({
        sessionId: 7,
        displayLabel: "a".repeat(65),
      })
    ).rejects.toThrow();
  });

  it("assign accepts an optional display label stored on the session", async () => {
    const db = mockDbWith([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    await caller.sessions.assign({
      machineId: 2,
      patientId: "P-103",
      durationMinutes: "180",
      isolationTag: "clean",
      urgent: false,
      displayLabel: "Alias 1",
    });

    const insertChain = (db.insert as ReturnType<typeof vi.fn>).mock.results[0].value as Record<string, unknown>;
    const vals = ((insertChain.values as ReturnType<typeof vi.fn>).mock.calls[0][0]) as Record<string, unknown>;
    expect(vals.displayLabel).toBe("Alias 1");
  });

  it("assign stores an optional nurse and trims whitespace", async () => {
    const db = mockDbWith([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    await caller.sessions.assign({
      machineId: 2,
      patientId: "P-103",
      durationMinutes: "180",
      isolationTag: "clean",
      urgent: false,
      assignedNurse: "  Nurse Ana  ",
    });

    const insertChain = (db.insert as ReturnType<typeof vi.fn>).mock.results[0].value as Record<string, unknown>;
    const vals = ((insertChain.values as ReturnType<typeof vi.fn>).mock.calls[0][0]) as Record<string, unknown>;
    expect(vals.assignedNurse).toBe("Nurse Ana");
  });

  it("assign clears the nurse when blank", async () => {
    const db = mockDbWith([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    await caller.sessions.assign({
      machineId: 2,
      patientId: "P-103",
      durationMinutes: "180",
      isolationTag: "clean",
      urgent: false,
      assignedNurse: "   ",
    });

    const insertChain = (db.insert as ReturnType<typeof vi.fn>).mock.results[0].value as Record<string, unknown>;
    const vals = ((insertChain.values as ReturnType<typeof vi.fn>).mock.calls[0][0]) as Record<string, unknown>;
    expect(vals.assignedNurse).toBeNull();
  });
});

describe("sessions.repair flag (needsRepairAfterSession)", () => {
  it("assign stores needsRepairAfterSession when flagged", async () => {
    const db = mockDbWith([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    await caller.sessions.assign({
      machineId: 2,
      patientId: "P-103",
      durationMinutes: "180",
      isolationTag: "clean",
      urgent: false,
      needsRepairAfterSession: true,
    });

    const insertChain = (db.insert as ReturnType<typeof vi.fn>).mock.results[0].value as Record<string, unknown>;
    const vals = ((insertChain.values as ReturnType<typeof vi.fn>).mock.calls[0][0]) as Record<string, unknown>;
    expect(vals.needsRepairAfterSession).toBe(true);
  });

  it("assign defaults needsRepairAfterSession to false", async () => {
    const db = mockDbWith([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    await caller.sessions.assign({
      machineId: 2,
      patientId: "P-103",
      durationMinutes: "180",
      isolationTag: "clean",
      urgent: false,
    });

    const insertChain = (db.insert as ReturnType<typeof vi.fn>).mock.results[0].value as Record<string, unknown>;
    const vals = ((insertChain.values as ReturnType<typeof vi.fn>).mock.calls[0][0]) as Record<string, unknown>;
    expect(vals.needsRepairAfterSession).toBe(false);
  });

  it("setRepairFlag updates the repair-after-session flag", async () => {
    const db = mockDbWith([]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.sessions.setRepairFlag({ sessionId: 7, flag: true });
    expect(result.success).toBe(true);
    expect(db.update).toHaveBeenCalled();
    const updateChain = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value as Record<string, unknown>;
    const set = ((updateChain.set as ReturnType<typeof vi.fn>).mock.calls[0][0]) as Record<string, unknown>;
    expect(set.needsRepairAfterSession).toBe(true);
  });

  it("ending a flagged session parks the machine in repair storage", async () => {
    // End session: first select reads the flag, then update ends the session,
    // then (flag set) setMachineStatus is invoked (getMachineById select +
    // in-treatment guard select + machines update) → machines update.
    const sessionWithFlag = [{ needsRepairAfterSession: true, machineId: 2 }];
    const machineRow = { id: 2, label: "HD-02", status: "active", floorId: 1 };
    let selectCalls = 0;
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
            })),
            limit: vi.fn().mockImplementation(async () => {
              selectCalls += 1;
              // First read is the flag lookup in endSession; subsequent reads
              // (getMachineById, in-treatment guard) must pass their checks:
              // the guard must see no active sessions, and the machine must exist.
              if (selectCalls === 1) return sessionWithFlag;
              if (selectCalls === 2) return [machineRow];
              return [];
            }),
          })),
        })),
      })),
      insert: vi.fn(),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.sessions.end({ sessionId: 7 });
    expect(result.success).toBe(true);

    // At least two update chains: end the session, then park the machine in repair.
    expect(db.update).toHaveBeenCalledTimes(2);
    const endSet = ((db.update.mock.results[0].value.set as ReturnType<typeof vi.fn>).mock.calls[0][0]) as Record<string, unknown>;
    expect(endSet.status).toBe("ended");
    const repairSet = ((db.update.mock.results[1].value.set as ReturnType<typeof vi.fn>).mock.calls[0][0]) as Record<string, unknown>;
    expect(repairSet.status).toBe("repair");
  });

  it("ending an unflagged session does NOT touch the machine status", async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              { needsRepairAfterSession: false, machineId: 2 },
            ]),
          })),
        })),
      })),
      insert: vi.fn(),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.sessions.end({ sessionId: 7 });
    expect(result.success).toBe(true);
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});

describe("input validation", () => {
  it("rejects durations outside 3/6/8 hours", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    await expect(
      caller.sessions.assign({
        machineId: 1,
        patientId: "P-104",
        // @ts-expect-error intentional invalid duration
        durationMinutes: "120",
        isolationTag: "clean",
        urgent: false,
      })
    ).rejects.toThrow();
  });

  it("rejects empty patient identifier", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    await expect(
      caller.sessions.assign({
        machineId: 1,
        patientId: "   ",
        durationMinutes: "480",
        isolationTag: "clean",
        urgent: false,
      })
    ).rejects.toThrow();
  });
});
