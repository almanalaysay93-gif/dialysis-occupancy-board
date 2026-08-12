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
  const chain = (terminal: unknown) => ({
    from: vi.fn(() => chain(terminal)),
    where: vi.fn(() => chain(terminal)),
    orderBy: vi.fn(() => chain(terminal)),
    limit: vi.fn().mockResolvedValue(rows),
    values: vi.fn(() => chain(terminal)),
    set: vi.fn(() => chain(terminal)),
    $returningId: vi.fn().mockResolvedValue([{ id: 99 }]),
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
      { id: 1, label: "HD-01", location: "Bay A", sortOrder: 1 },
      { id: 2, label: "HD-02", location: "Bay A", sortOrder: 2 },
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
