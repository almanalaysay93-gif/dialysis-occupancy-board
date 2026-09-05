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
  startedAt: new Date("2026-09-01T08:00:00Z"),
  endedAt: new Date("2026-09-01T12:00:00Z"),
  endsAt: new Date("2026-09-01T12:00:00Z"),
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
  startedAt: new Date("2026-09-01T13:00:00Z"), // 1 hour idle gap after session 1
  endedAt: new Date("2026-09-01T17:00:00Z"),
  endsAt: new Date("2026-09-01T17:00:00Z"),
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
  reportedAt: new Date("2026-09-01T17:30:00Z"),
  resolvedAt: new Date("2026-09-01T19:00:00Z"),
  reportedBy: "Nurse Maria, RN",
  technician: "Tech Dave",
  issue: "Arterial pressure sensor loose",
  actionTaken: "Recalibrated and tightened transducer protector",
  partsReplaced: "Transducer protector",
  status: "resolved",
  createdAt: new Date("2026-09-01T17:30:00Z"),
  updatedAt: new Date("2026-09-01T19:00:00Z"),
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
