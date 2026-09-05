import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./db";
import {
  getMachineMetricsReport,
  generateMachineMetricsExcel,
  invalidateMachineMetricsCache,
  logMachineRepair,
  listMachineRepairs,
} from "./machine-metrics";

const MOCK_MACHINE = {
  id: 10,
  label: "HD-10",
  location: "Bay 2",
  floorId: 1,
  sortOrder: 1,
  status: "active",
  statusNote: null,
};

const MOCK_FLOOR = {
  id: 1,
  name: "Ground Floor",
  code: "F1",
  sortOrder: 1,
};

const MOCK_SESSION_1 = {
  id: 101,
  machineId: 10,
  patientId: "P-9901",
  durationMinutes: 240,
  startedAt: new Date("2026-09-01T08:00:00+08:00"),
  endedAt: new Date("2026-09-01T12:00:00+08:00"),
  endsAt: new Date("2026-09-01T12:00:00+08:00"),
  isolationTag: "clean",
  urgent: false,
  status: "ended",
  startedBy: "Nurse Maria, RN",
  displayLabel: "Santos, M.",
  assignedNurse: "Nurse Maria, RN",
  needsRepairAfterSession: false,
  pausedAt: null,
  pausedSeconds: 1200, // 20 minutes paused
};

const MOCK_SESSION_2 = {
  id: 102,
  machineId: 10,
  patientId: "P-9902",
  durationMinutes: 240,
  startedAt: new Date("2026-09-01T13:00:00+08:00"), // 1 hour idle gap after session 1
  endedAt: new Date("2026-09-01T17:00:00+08:00"),
  endsAt: new Date("2026-09-01T17:00:00+08:00"),
  isolationTag: "dirty",
  urgent: true,
  status: "ended",
  startedBy: "Nurse John, RN",
  displayLabel: "Reyes, J.",
  assignedNurse: "Nurse John, RN",
  needsRepairAfterSession: false,
  pausedAt: null,
  pausedSeconds: 0,
};

const MOCK_REPAIR = {
  id: 1,
  machineId: 10,
  reportedAt: new Date("2026-09-01T17:30:00+08:00"),
  resolvedAt: new Date("2026-09-01T19:00:00+08:00"),
  reportedBy: "Nurse Maria, RN",
  technician: "Tech Dave",
  issue: "Arterial pressure sensor loose",
  actionTaken: "Recalibrated and tightened transducer protector",
  partsReplaced: "Transducer protector",
  status: "resolved",
  createdAt: new Date("2026-09-01T17:30:00+08:00"),
  updatedAt: new Date("2026-09-01T19:00:00+08:00"),
};

function createMockDb() {
  const chain = (rows: unknown[]): Record<string, unknown> => ({
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    from: vi.fn(() => chain(rows)),
    where: vi.fn(() => chain(rows)),
    orderBy: vi.fn(() => chain(rows)),
    limit: vi.fn(() => chain(rows)),
    values: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve([MOCK_REPAIR])),
    })),
  });

  let selectCount = 0;
  return {
    select: vi.fn(() => {
      selectCount += 1;
      // 1st query: machines
      if (selectCount === 1) return chain([MOCK_MACHINE]);
      // 2nd query: floors
      if (selectCount === 2) return chain([MOCK_FLOOR]);
      // 3rd query: sessions
      if (selectCount === 3) return chain([MOCK_SESSION_1, MOCK_SESSION_2]);
      // 4th query: repairs
      return chain([MOCK_REPAIR]);
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([MOCK_REPAIR])),
      })),
    })),
  };
}

/** A session fixture carrying only the fields the report reads. */
function session(over: Record<string, unknown>) {
  return {
    id: 900,
    machineId: 10,
    patientId: "P-9999",
    durationMinutes: 240,
    isolationTag: "clean",
    urgent: false,
    status: "ended",
    startedBy: "Nurse Ana, RN",
    displayLabel: "Cruz, A.",
    assignedNurse: "Nurse Ana, RN",
    needsRepairAfterSession: false,
    pausedAt: null,
    pausedSeconds: 0,
    endedAt: null,
    ...over,
  };
}

/** Mock db returning a caller-supplied session set instead of the two defaults. */
function createDbWithSessions(sessionRows: unknown[], repairRows: unknown[] = []) {
  const chain = (rows: unknown[]): Record<string, unknown> => ({
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    from: vi.fn(() => chain(rows)),
    where: vi.fn(() => chain(rows)),
    orderBy: vi.fn(() => chain(rows)),
    limit: vi.fn(() => chain(rows)),
  });
  let selectCount = 0;
  return {
    select: vi.fn(() => {
      selectCount += 1;
      if (selectCount === 1) return chain([MOCK_MACHINE]);
      if (selectCount === 2) return chain([MOCK_FLOOR]);
      if (selectCount === 3) return chain(sessionRows);
      return chain(repairRows);
    }),
  };
}

describe("machine-metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateMachineMetricsCache();
  });

  it("calculates session metrics, paused time, and idle gaps correctly for staff viewer", async () => {
    const mockDb = createMockDb();
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const report = await getMachineMetricsReport(
      { machineId: 10, startDate: "2026-09-01", endDate: "2026-09-01" },
      { canSeePhi: true }
    );

    expect(report.machines).toHaveLength(1);
    const m = report.machines[0];
    expect(m.label).toBe("HD-10");
    expect(m.floorName).toBe("Ground Floor");
    expect(m.totalSessions).toBe(2);
    expect(m.sessions).toHaveLength(2);

    // Session 1: 4 hours (240 min) minus 20 min paused = 220 min treatment
    expect(m.sessions[0].pausedMinutes).toBe(20);
    expect(m.sessions[0].actualTreatmentMinutes).toBe(220);
    expect(m.sessions[0].patientId).toBe("P-9901"); // staff sees real patient ID
    expect(m.sessions[0].assignedNurse).toBe("Nurse Maria, RN");

    // Session 2: Starts 13:00, session 1 ended 12:00 -> 60 min idle before
    expect(m.sessions[1].idleBeforeMinutes).toBe(60);
    expect(m.sessions[1].actualTreatmentMinutes).toBe(240);
    expect(m.sessions[1].patientId).toBe("P-9902");

    // Total idle time should include the 60 min gap
    expect(m.totalIdleMinutes).toBe(60);
    expect(m.totalTreatmentMinutes).toBe(460); // 220 + 240
    expect(m.totalPausedMinutes).toBe(20);

    // Repairs
    expect(m.repairs).toHaveLength(1);
    expect(m.repairs[0].issue).toBe("Arterial pressure sensor loose");
    expect(m.repairs[0].status).toBe("resolved");
  });

  it("masks patient identifiers for guest or unauthenticated viewers (PHI Gate)", async () => {
    const mockDb = createMockDb();
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const report = await getMachineMetricsReport(
      { machineId: 10, startDate: "2026-09-01", endDate: "2026-09-01" },
      { canSeePhi: false } // guest/kiosk
    );

    expect(report.canSeePhi).toBe(false);
    expect(report.machines[0].sessions[0].patientId).not.toBe("P-9901");
    expect(report.machines[0].sessions[0].patientId).toMatch(/^TK-\d{4}$/);
  });

  it("serves repeated requests from in-memory cache and clears on invalidateMachineMetricsCache", async () => {
    const mockDb = createMockDb();
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const first = await getMachineMetricsReport(
      { machineId: 10, startDate: "2026-09-01", endDate: "2026-09-01" },
      { canSeePhi: true }
    );
    expect(mockDb.select).toHaveBeenCalled();

    const selectCallCount = mockDb.select.mock.calls.length;

    // Second call with same parameters should hit cache without new select calls
    const second = await getMachineMetricsReport(
      { machineId: 10, startDate: "2026-09-01", endDate: "2026-09-01" },
      { canSeePhi: true }
    );
    expect(second).toEqual(first);
    expect(mockDb.select.mock.calls.length).toBe(selectCallCount);

    // Invalidation clears cache
    invalidateMachineMetricsCache(10);
    await getMachineMetricsReport(
      { machineId: 10, startDate: "2026-09-01", endDate: "2026-09-01" },
      { canSeePhi: true }
    );
    expect(mockDb.select.mock.calls.length).toBeGreaterThan(selectCallCount);
  });

  it("generates a valid multi-sheet Excel (.xlsx) buffer with all required headers", async () => {
    const mockDb = createMockDb();
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const report = await getMachineMetricsReport(
      { machineId: 10, startDate: "2026-09-01", endDate: "2026-09-01" },
      { canSeePhi: true }
    );

    const buffer = await generateMachineMetricsExcel(report);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);

    // Zip / OpenXML magic bytes: PK (0x50, 0x4B, 0x03, 0x04)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    expect(buffer[2]).toBe(0x03);
    expect(buffer[3]).toBe(0x04);

    // Verify parsing back with ExcelJS
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const summarySheet = workbook.getWorksheet("Machine Overview");
    expect(summarySheet).toBeDefined();
    expect(summarySheet?.getCell("A1").value).toBe("Machine Label");
    expect(summarySheet?.getCell("A2").value).toBe("HD-10");

    const sessionsSheet = workbook.getWorksheet("Treatment Sessions");
    expect(sessionsSheet).toBeDefined();
    expect(sessionsSheet?.getCell("A1").value).toBe("Session ID");
    expect(sessionsSheet?.getCell("B2").value).toBe("HD-10");

    const repairsSheet = workbook.getWorksheet("Maintenance & Repairs");
    expect(repairsSheet).toBeDefined();
    expect(repairsSheet?.getCell("A1").value).toBe("Repair ID");
    expect(repairsSheet?.getCell("F2").value).toBe("Arterial pressure sensor loose");
  });

  it("dates and clamps sessions on the Asia/Manila day, not the UTC day", async () => {
    // 07:00 Manila is 23:00 UTC the day before. A UTC-anchored window labels
    // this session 2026-08-31 and clamps an hour of it away.
    const early = session({
      startedAt: new Date("2026-09-01T07:00:00+08:00"),
      endedAt: new Date("2026-09-01T11:00:00+08:00"),
      endsAt: new Date("2026-09-01T11:00:00+08:00"),
    });
    vi.mocked(getDb).mockResolvedValue(createDbWithSessions([early]) as never);

    const report = await getMachineMetricsReport(
      { machineId: 10, startDate: "2026-09-01", endDate: "2026-09-01" },
      { canSeePhi: true },
    );

    expect(report.machines[0].sessions[0].date).toBe("2026-09-01");
    expect(report.machines[0].totalTreatmentMinutes).toBe(240);
  });

  it("clamps a session that runs past the end of the window", async () => {
    // 21:00 -> 01:00 Manila: only the 3 hours before midnight fall in day 1.
    const overnight = session({
      startedAt: new Date("2026-09-01T21:00:00+08:00"),
      endedAt: new Date("2026-09-02T01:00:00+08:00"),
      endsAt: new Date("2026-09-02T01:00:00+08:00"),
    });
    vi.mocked(getDb).mockResolvedValue(createDbWithSessions([overnight]) as never);

    const report = await getMachineMetricsReport(
      { machineId: 10, startDate: "2026-09-01", endDate: "2026-09-01" },
      { canSeePhi: true },
    );

    expect(report.machines[0].sessions[0].actualTreatmentMinutes).toBe(180);
    // The row still reports the true end time.
    expect(report.machines[0].sessions[0].endedAt?.toISOString()).toBe(
      new Date("2026-09-02T01:00:00+08:00").toISOString(),
    );
  });

  it("masks nurse, operator, and repair staff names for non-PHI viewers", async () => {
    const mockDb = createMockDb();
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const report = await getMachineMetricsReport(
      { machineId: 10, startDate: "2026-09-01", endDate: "2026-09-01" },
      { canSeePhi: false },
    );

    const s = report.machines[0].sessions[0];
    expect(s.assignedNurse).toBe("Restricted");
    expect(s.operator).toBe("Restricted");
    expect(report.machines[0].repairs[0].reportedBy).toBe("Restricted");
    expect(report.machines[0].repairs[0].technician).toBe("Restricted");
  });

  it("masks repair staff names in listMachineRepairs for non-PHI viewers", async () => {
    const chain = (rows: unknown[]): Record<string, unknown> => ({
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
      from: vi.fn(() => chain(rows)),
      where: vi.fn(() => chain(rows)),
      orderBy: vi.fn(() => chain(rows)),
    });
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn(() => chain([MOCK_REPAIR])),
    } as never);

    const staffView = await listMachineRepairs(10, { canSeePhi: true });
    expect(staffView[0].reportedBy).toBe("Nurse Maria, RN");

    const guestView = await listMachineRepairs(10, { canSeePhi: false });
    expect(guestView[0].reportedBy).toBe("Restricted");
    expect(guestView[0].technician).toBe("Restricted");
  });

  it("measures utilization against the elapsed window, not its own busy span", async () => {
    // One 4-hour session on a full past day: 240 / 1440 = 17%, not 100%.
    const single = session({
      startedAt: new Date("2026-09-01T08:00:00+08:00"),
      endedAt: new Date("2026-09-01T12:00:00+08:00"),
      endsAt: new Date("2026-09-01T12:00:00+08:00"),
    });
    vi.mocked(getDb).mockResolvedValue(createDbWithSessions([single]) as never);

    const report = await getMachineMetricsReport(
      { machineId: 10, startDate: "2026-09-01", endDate: "2026-09-01" },
      { canSeePhi: true },
    );

    expect(report.machines[0].availableMinutes).toBe(1440);
    expect(report.machines[0].utilizationRate).toBe(17);
  });

  it("does not charge the overnight gap between two days as idle time", async () => {
    const day1 = session({
      id: 901,
      startedAt: new Date("2026-09-01T08:00:00+08:00"),
      endedAt: new Date("2026-09-01T12:00:00+08:00"),
      endsAt: new Date("2026-09-01T12:00:00+08:00"),
    });
    const day2 = session({
      id: 902,
      startedAt: new Date("2026-09-02T08:00:00+08:00"),
      endedAt: new Date("2026-09-02T12:00:00+08:00"),
      endsAt: new Date("2026-09-02T12:00:00+08:00"),
    });
    vi.mocked(getDb).mockResolvedValue(createDbWithSessions([day1, day2]) as never);

    const report = await getMachineMetricsReport(
      { machineId: 10, startDate: "2026-09-01", endDate: "2026-09-02" },
      { canSeePhi: true },
    );

    // 12:00 day 1 -> 08:00 day 2 is 20 hours of overnight gap.
    expect(report.machines[0].totalIdleMinutes).toBe(0);
    expect(report.machines[0].totalTreatmentMinutes).toBe(480);
  });

  it("counts the running pause of a session that is paused right now", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:00+08:00"));
    // Started 08:00, paused since 11:00 -> 3h treatment, 1h paused.
    const paused = session({
      startedAt: new Date("2026-09-01T08:00:00+08:00"),
      endedAt: null,
      endsAt: new Date("2026-09-01T12:00:00+08:00"),
      status: "active",
      pausedAt: new Date("2026-09-01T11:00:00+08:00"),
      pausedSeconds: 0,
    });
    vi.mocked(getDb).mockResolvedValue(createDbWithSessions([paused]) as never);

    const report = await getMachineMetricsReport(
      { machineId: 10, startDate: "2026-09-01", endDate: "2026-09-01" },
      { canSeePhi: true },
    );

    expect(report.machines[0].sessions[0].pausedMinutes).toBe(60);
    expect(report.machines[0].sessions[0].actualTreatmentMinutes).toBe(180);
    vi.useRealTimers();
  });

  it("caps the cache instead of keeping one entry per requested date range", async () => {
    vi.mocked(getDb).mockImplementation(async () => createMockDb() as never);

    // 200 distinct keys, past the 128-entry cap.
    for (let i = 1; i <= 200; i++) {
      const day = `2026-01-${String((i % 28) + 1).padStart(2, "0")}`;
      await getMachineMetricsReport(
        { machineId: i, startDate: day, endDate: day },
        { canSeePhi: true },
      );
    }

    // The oldest key must have been evicted, so it costs a fresh read.
    const before = vi.mocked(getDb).mock.calls.length;
    await getMachineMetricsReport(
      { machineId: 1, startDate: "2026-01-02", endDate: "2026-01-02" },
      { canSeePhi: true },
    );
    expect(vi.mocked(getDb).mock.calls.length).toBeGreaterThan(before);
  });

  it("rethrows repair-query failures that are not a missing table", async () => {
    const chain = (rows: unknown[]): Record<string, unknown> => ({
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
      from: vi.fn(() => chain(rows)),
      where: vi.fn(() => chain(rows)),
      orderBy: vi.fn(() => chain(rows)),
    });
    const failing = (): Record<string, unknown> => ({
      from: vi.fn(() => failing()),
      where: vi.fn(() => failing()),
      orderBy: vi.fn(() => ({
        then: (_resolve: unknown, reject: (e: unknown) => unknown) =>
          reject(Object.assign(new Error("connection terminated"), { code: "57P01" })),
      })),
    });
    let n = 0;
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn(() => {
        n += 1;
        if (n === 1) return chain([MOCK_MACHINE]);
        if (n === 2) return chain([MOCK_FLOOR]);
        if (n === 3) return chain([]);
        return failing();
      }),
    } as never);

    await expect(
      getMachineMetricsReport(
        { machineId: 10, startDate: "2026-09-01", endDate: "2026-09-01" },
        { canSeePhi: true },
      ),
    ).rejects.toThrow("connection terminated");
  });

  it("logs a machine repair record and invalidates the cache", async () => {
    const mockDb = createMockDb();
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const logged = await logMachineRepair({
      machineId: 10,
      reportedBy: "Nurse Maria, RN",
      issue: "Arterial pressure sensor loose",
      technician: "Tech Dave",
      status: "resolved",
    });

    expect(logged).toBeDefined();
    expect(logged.id).toBe(1);
    expect(mockDb.insert).toHaveBeenCalled();
  });
});
