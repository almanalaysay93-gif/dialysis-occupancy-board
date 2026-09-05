import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./db";
import { listWaiting, resetWaitingCallSupport, setWaitingCall } from "./machines";

const WAITING_ROW = {
  id: 15,
  patientId: "P-4821",
  floorId: 30001,
  priority: "normal",
  durationMinutes: 480,
  isolationTag: "clean",
  assignedNurse: null,
  addedBy: null,
  joinedAt: new Date("2026-09-05T06:28:00Z"),
  admittedAt: null,
  status: "waiting",
  createdAt: new Date("2026-09-05T06:28:00Z"),
};

/**
 * `columnPresent` decides what the information_schema probe reports, and
 * `allowDdl` whether the role may add the columns itself.
 */
function mockDb(opts: { columnPresent: boolean; allowDdl: boolean }) {
  const chain = (rows: unknown[]): Record<string, unknown> => ({
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    from: vi.fn(() => chain(rows)),
    where: vi.fn(() => chain(rows)),
    orderBy: vi.fn(() => chain(rows)),
  });

  const selectedColumns: string[][] = [];
  const executed: string[] = [];

  const db = {
    select: vi.fn((columns?: Record<string, unknown>) => {
      selectedColumns.push(Object.keys(columns ?? {}));
      return chain([WAITING_ROW]);
    }),
    execute: vi.fn(async (query: { queryChunks?: unknown[] }) => {
      const text = JSON.stringify(query.queryChunks ?? query);
      executed.push(text);
      if (text.includes("information_schema")) {
        return { rows: opts.columnPresent ? [{ "?column?": 1 }] : [] };
      }
      if (!opts.allowDdl) throw new Error("permission denied for table waiting_list");
      return { rows: [] };
    }),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
  };

  vi.mocked(getDb).mockResolvedValue(db as never);
  return { db, selectedColumns, executed };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetWaitingCallSupport();
});

describe("waiting list without the call columns", () => {
  it("still returns the queue when the columns are missing and cannot be added", async () => {
    const { selectedColumns } = mockDb({ columnPresent: false, allowDdl: false });

    const rows = await listWaiting({ floorId: 30001 }, { canSeePhi: true });

    expect(selectedColumns[0]).not.toContain("calledAt");
    expect(rows[0].patientId).toBe("P-4821");
    expect(rows[0].calledAt).toBeNull();
  });

  it("refuses to record a call rather than writing a column that is not there", async () => {
    mockDb({ columnPresent: false, allowDdl: false });

    await expect(
      setWaitingCall({ entryId: 15, floorId: 30001, called: true, calledBy: "Nurse Ana" })
    ).rejects.toThrow("WAITING_CALL_UNAVAILABLE");
  });

  it("adds the columns itself when the role is allowed to", async () => {
    const { selectedColumns, executed } = mockDb({ columnPresent: false, allowDdl: true });

    const rows = await listWaiting({ floorId: 30001 }, { canSeePhi: true });

    expect(executed.some(q => q.includes("add column if not exists"))).toBe(true);
    expect(selectedColumns[0]).toContain("calledAt");
    expect(rows).toHaveLength(1);
  });

  it("probes once per process, not once per query", async () => {
    const { db } = mockDb({ columnPresent: true, allowDdl: true });

    await listWaiting({ floorId: 30001 });
    await listWaiting({ floorId: 30001 });

    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
