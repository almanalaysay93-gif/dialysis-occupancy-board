import ExcelJS from "exceljs";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "./db";
import { floors, machineRepairs, machines, sessions } from "../drizzle/schema";
import { patientTicket } from "./patient-ticket";
import type { BoardViewer } from "./machines";

export type MachineSessionMetric = {
  id: number;
  machineId: number;
  machineLabel: string;
  date: string;
  startedAt: Date;
  endedAt: Date | null;
  endsAt: Date;
  durationMinutes: number;
  pausedMinutes: number;
  actualTreatmentMinutes: number;
  idleBeforeMinutes: number;
  patientId: string;
  assignedNurse: string;
  operator: string;
  isolationTag: "clean" | "dirty";
  urgent: boolean;
  status: string;
};

export type MachineRepairMetric = {
  id: number;
  machineId: number;
  machineLabel: string;
  reportedAt: Date;
  resolvedAt: Date | null;
  reportedBy: string;
  technician: string | null;
  issue: string;
  actionTaken: string | null;
  partsReplaced: string | null;
  status: string;
};

export type SingleMachineReport = {
  machineId: number;
  label: string;
  location: string;
  floorId: number | null;
  floorName: string;
  status: string;
  totalSessions: number;
  totalTreatmentMinutes: number;
  totalPausedMinutes: number;
  totalIdleMinutes: number;
  utilizationRate: number;
  sessions: MachineSessionMetric[];
  repairs: MachineRepairMetric[];
};

export type MachineMetricsReport = {
  startDate: string;
  endDate: string;
  generatedAt: string;
  canSeePhi: boolean;
  floorId?: number;
  floorName?: string;
  machines: SingleMachineReport[];
};

/**
 * 60-second in-memory cache for machine metrics reports.
 * Reduces database read load on repeated report views or exports.
 */
const METRICS_CACHE_TTL_MS = 60_000;
const machineMetricsCache = new Map<string, { value: MachineMetricsReport; expiresAt: number }>();

export function invalidateMachineMetricsCache(machineId?: number): void {
  if (machineId === undefined) {
    machineMetricsCache.clear();
    return;
  }
  for (const key of Array.from(machineMetricsCache.keys())) {
    if (key.includes(`m:${machineId}:`) || key.startsWith("floor:")) {
      machineMetricsCache.delete(key);
    }
  }
}

/**
 * Build metrics report for one machine or all machines on a floor.
 */
export async function getMachineMetricsReport(
  opts: {
    machineId?: number;
    floorId?: number;
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
  },
  viewer: BoardViewer = { canSeePhi: false },
): Promise<MachineMetricsReport> {
  const cacheKey = opts.machineId
    ? `m:${opts.machineId}:${opts.startDate}:${opts.endDate}:${viewer.canSeePhi ? "phi" : "masked"}`
    : `floor:${opts.floorId ?? "all"}:${opts.startDate}:${opts.endDate}:${viewer.canSeePhi ? "phi" : "masked"}`;

  const cached = machineMetricsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const db = await getDb();
  const startTs = new Date(`${opts.startDate}T00:00:00Z`);
  const endTs = new Date(`${opts.endDate}T23:59:59.999Z`);

  if (!db) {
    return {
      startDate: opts.startDate,
      endDate: opts.endDate,
      generatedAt: new Date().toISOString(),
      canSeePhi: viewer.canSeePhi,
      floorId: opts.floorId,
      machines: [],
    };
  }

  // 1. Query target machines
  let machineQuery = db.select().from(machines);
  if (opts.machineId) {
    machineQuery = machineQuery.where(eq(machines.id, opts.machineId)) as typeof machineQuery;
  } else if (opts.floorId) {
    machineQuery = machineQuery.where(eq(machines.floorId, opts.floorId)) as typeof machineQuery;
  }
  const targetMachines = await machineQuery.orderBy(machines.floorId, machines.sortOrder, machines.id);

  // 2. Fetch floors map for friendly floor names
  const allFloors = await db.select().from(floors);
  const floorMap = new Map<number, string>();
  for (const f of allFloors) floorMap.set(f.id, f.name);

  if (targetMachines.length === 0) {
    return {
      startDate: opts.startDate,
      endDate: opts.endDate,
      generatedAt: new Date().toISOString(),
      canSeePhi: viewer.canSeePhi,
      floorId: opts.floorId,
      floorName: opts.floorId ? floorMap.get(opts.floorId) : undefined,
      machines: [],
    };
  }

  const machineIds = targetMachines.map(m => m.id);
  const machineLabelMap = new Map<number, string>();
  for (const m of targetMachines) machineLabelMap.set(m.id, m.label);

  // 3. Query sessions overlapping the date range for these machines
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(
      and(
        sql`${sessions.machineId} IN (${sql.join(machineIds.map(id => sql`${id}`), sql`, `)})`,
        gte(sessions.startedAt, startTs),
        lte(sessions.startedAt, endTs),
      ),
    )
    .orderBy(sessions.machineId, sessions.startedAt);

  // Group sessions by machineId
  const sessionsByMachine = new Map<number, typeof sessionRows>();
  for (const s of sessionRows) {
    const arr = sessionsByMachine.get(s.machineId) ?? [];
    arr.push(s);
    sessionsByMachine.set(s.machineId, arr);
  }

  // 4. Query repair logs for these machines
  let repairsRows: (typeof machineRepairs.$inferSelect)[] = [];
  try {
    repairsRows = await db
      .select()
      .from(machineRepairs)
      .where(
        and(
          sql`${machineRepairs.machineId} IN (${sql.join(machineIds.map(id => sql`${id}`), sql`, `)})`,
          gte(machineRepairs.reportedAt, startTs),
          lte(machineRepairs.reportedAt, endTs),
        ),
      )
      .orderBy(desc(machineRepairs.reportedAt));
  } catch {
    // Gracefully handle if table does not yet exist on current connection
    repairsRows = [];
  }

  const repairsByMachine = new Map<number, typeof repairsRows>();
  for (const r of repairsRows) {
    const arr = repairsByMachine.get(r.machineId) ?? [];
    arr.push(r);
    repairsByMachine.set(r.machineId, arr);
  }

  // 5. Build per-machine aggregated metrics
  const now = Date.now();
  const machineReports: SingleMachineReport[] = targetMachines.map(m => {
    const mSessions = sessionsByMachine.get(m.id) ?? [];
    const mRepairs = repairsByMachine.get(m.id) ?? [];

    let totalTreatmentMs = 0;
    let totalPausedMs = 0;
    let totalIdleMs = 0;

    const formattedSessions: MachineSessionMetric[] = [];
    let previousSessionEnd: Date | null = null;

    for (const s of mSessions) {
      const sStart = new Date(s.startedAt);
      const sEnd = s.endedAt ? new Date(s.endedAt) : (s.status === "active" ? new Date(now) : new Date(s.endsAt));
      const pausedSec = Math.max(0, s.pausedSeconds ?? 0);
      const pausedMs = pausedSec * 1000;
      const elapsedMs = Math.max(0, sEnd.getTime() - sStart.getTime());
      const actualTreatmentMs = Math.max(0, elapsedMs - pausedMs);

      totalTreatmentMs += actualTreatmentMs;
      totalPausedMs += pausedMs;

      // Idle calculation: gap from previous session end or start of day
      let idleBeforeMs = 0;
      if (previousSessionEnd) {
        const gap = sStart.getTime() - previousSessionEnd.getTime();
        if (gap > 0) {
          idleBeforeMs = gap;
          totalIdleMs += gap;
        }
      }
      previousSessionEnd = sEnd;

      const dateStr = sStart.toISOString().slice(0, 10);
      const safePatient = viewer.canSeePhi ? s.patientId : patientTicket(s.patientId);

      formattedSessions.push({
        id: s.id,
        machineId: s.machineId,
        machineLabel: m.label,
        date: dateStr,
        startedAt: sStart,
        endedAt: s.endedAt ? new Date(s.endedAt) : null,
        endsAt: new Date(s.endsAt),
        durationMinutes: s.durationMinutes,
        pausedMinutes: Math.round(pausedMs / 60000),
        actualTreatmentMinutes: Math.round(actualTreatmentMs / 60000),
        idleBeforeMinutes: Math.round(idleBeforeMs / 60000),
        patientId: safePatient,
        assignedNurse: s.assignedNurse?.trim() || "Unassigned",
        operator: s.startedBy?.trim() || "—",
        isolationTag: s.isolationTag,
        urgent: s.urgent,
        status: s.status,
      });
    }

    const formattedRepairs: MachineRepairMetric[] = mRepairs.map(r => ({
      id: r.id,
      machineId: r.machineId,
      machineLabel: m.label,
      reportedAt: new Date(r.reportedAt),
      resolvedAt: r.resolvedAt ? new Date(r.resolvedAt) : null,
      reportedBy: r.reportedBy,
      technician: r.technician,
      issue: r.issue,
      actionTaken: r.actionTaken,
      partsReplaced: r.partsReplaced,
      status: r.status,
    }));

    const totalTreatmentMinutes = Math.round(totalTreatmentMs / 60000);
    const totalPausedMinutes = Math.round(totalPausedMs / 60000);
    const totalIdleMinutes = Math.round(totalIdleMs / 60000);
    const totalActiveSpan = totalTreatmentMinutes + totalIdleMinutes;
    const utilizationRate = totalActiveSpan > 0 ? Math.min(100, Math.round((totalTreatmentMinutes / totalActiveSpan) * 100)) : 0;

    return {
      machineId: m.id,
      label: m.label,
      location: m.location,
      floorId: m.floorId,
      floorName: m.floorId ? (floorMap.get(m.floorId) ?? `Floor ${m.floorId}`) : "Unassigned",
      status: m.status,
      totalSessions: mSessions.length,
      totalTreatmentMinutes,
      totalPausedMinutes,
      totalIdleMinutes,
      utilizationRate,
      sessions: formattedSessions,
      repairs: formattedRepairs,
    };
  });

  const result: MachineMetricsReport = {
    startDate: opts.startDate,
    endDate: opts.endDate,
    generatedAt: new Date().toISOString(),
    canSeePhi: viewer.canSeePhi,
    floorId: opts.floorId,
    floorName: opts.floorId ? floorMap.get(opts.floorId) : undefined,
    machines: machineReports,
  };

  machineMetricsCache.set(cacheKey, { value: result, expiresAt: Date.now() + METRICS_CACHE_TTL_MS });
  return result;
}

/**
 * Log a new machine repair record.
 */
export async function logMachineRepair(input: {
  machineId: number;
  reportedBy: string;
  issue: string;
  technician?: string | null;
  actionTaken?: string | null;
  partsReplaced?: string | null;
  status?: "pending" | "in_progress" | "resolved";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const inserted = await db
    .insert(machineRepairs)
    .values({
      machineId: input.machineId,
      reportedBy: input.reportedBy,
      issue: input.issue.trim(),
      technician: input.technician?.trim() || null,
      actionTaken: input.actionTaken?.trim() || null,
      partsReplaced: input.partsReplaced?.trim() || null,
      status: input.status ?? "pending",
      resolvedAt: input.status === "resolved" ? new Date() : null,
    })
    .returning();

  invalidateMachineMetricsCache(input.machineId);
  return inserted[0];
}

/**
 * List repair history for a specific machine.
 */
export async function listMachineRepairs(machineId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(machineRepairs)
    .where(eq(machineRepairs.machineId, machineId))
    .orderBy(desc(machineRepairs.reportedAt));
}

/**
 * Generate a multi-tab Excel (.xlsx) workbook from the metrics report.
 */
export async function generateMachineMetricsExcel(report: MachineMetricsReport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dialysis Occupancy Board";
  workbook.created = new Date();

  const titleHeaderFill: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F172A" }, // Slate 900
  };
  const tableHeaderFill: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" }, // Slate 800
  };
  const whiteBoldText: Partial<ExcelJS.Font> = {
    color: { argb: "FFFFFFFF" },
    bold: true,
    name: "Segoe UI",
    size: 10,
  };
  const regularText: Partial<ExcelJS.Font> = {
    name: "Segoe UI",
    size: 9,
  };
  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FFE2E8F0" } },
    bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
    left: { style: "thin", color: { argb: "FFE2E8F0" } },
    right: { style: "thin", color: { argb: "FFE2E8F0" } },
  };

  // -------------------------------------------------------------------------
  // Sheet 1: Machine Overview
  // -------------------------------------------------------------------------
  const summarySheet = workbook.addWorksheet("Machine Overview", {
    views: [{ showGridLines: true }],
  });

  summarySheet.columns = [
    { header: "Machine Label", key: "label", width: 16 },
    { header: "Floor", key: "floor", width: 18 },
    { header: "Location", key: "location", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Total Sessions", key: "sessions", width: 16 },
    { header: "Treatment Time (Hrs)", key: "treatmentHours", width: 22 },
    { header: "Paused Time (Hrs)", key: "pausedHours", width: 20 },
    { header: "Idle Time (Hrs)", key: "idleHours", width: 18 },
    { header: "Utilization (%)", key: "utilization", width: 18 },
    { header: "Total Repairs", key: "repairs", width: 14 },
  ];

  const summaryHeader = summarySheet.getRow(1);
  summaryHeader.height = 26;
  summaryHeader.eachCell(cell => {
    cell.fill = tableHeaderFill;
    cell.font = whiteBoldText;
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  for (const m of report.machines) {
    const row = summarySheet.addRow({
      label: m.label,
      floor: m.floorName,
      location: m.location,
      status: m.status.toUpperCase(),
      sessions: m.totalSessions,
      treatmentHours: Number((m.totalTreatmentMinutes / 60).toFixed(1)),
      pausedHours: Number((m.totalPausedMinutes / 60).toFixed(1)),
      idleHours: Number((m.totalIdleMinutes / 60).toFixed(1)),
      utilization: `${m.utilizationRate}%`,
      repairs: m.repairs.length,
    });
    row.height = 20;
    row.eachCell(cell => {
      cell.font = regularText;
      cell.border = thinBorder;
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
  }

  // -------------------------------------------------------------------------
  // Sheet 2: Treatment Sessions
  // -------------------------------------------------------------------------
  const sessionsSheet = workbook.addWorksheet("Treatment Sessions", {
    views: [{ showGridLines: true }],
  });

  sessionsSheet.columns = [
    { header: "Session ID", key: "id", width: 14 },
    { header: "Machine", key: "machineLabel", width: 16 },
    { header: "Date", key: "date", width: 14 },
    { header: "Started At", key: "startedAt", width: 20 },
    { header: "Ended At", key: "endedAt", width: 20 },
    { header: "Planned Duration (Min)", key: "duration", width: 22 },
    { header: "Actual Treatment (Min)", key: "actual", width: 22 },
    { header: "Paused (Min)", key: "paused", width: 16 },
    { header: "Idle Before (Min)", key: "idle", width: 18 },
    { header: report.canSeePhi ? "Patient ID" : "Patient Ticket", key: "patient", width: 20 },
    { header: "Assigned Nurse", key: "nurse", width: 22 },
    { header: "Operator", key: "operator", width: 18 },
    { header: "Tag", key: "tag", width: 12 },
    { header: "Priority", key: "priority", width: 12 },
    { header: "Status", key: "status", width: 14 },
  ];

  const sessionsHeader = sessionsSheet.getRow(1);
  sessionsHeader.height = 26;
  sessionsHeader.eachCell(cell => {
    cell.fill = tableHeaderFill;
    cell.font = whiteBoldText;
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  for (const m of report.machines) {
    for (const s of m.sessions) {
      const row = sessionsSheet.addRow({
        id: s.id,
        machineLabel: s.machineLabel,
        date: s.date,
        startedAt: s.startedAt.toLocaleString([], { timeZone: "Asia/Manila" }),
        endedAt: s.endedAt ? s.endedAt.toLocaleString([], { timeZone: "Asia/Manila" }) : "Active",
        duration: s.durationMinutes,
        actual: s.actualTreatmentMinutes,
        paused: s.pausedMinutes,
        idle: s.idleBeforeMinutes,
        patient: s.patientId,
        nurse: s.assignedNurse,
        operator: s.operator,
        tag: s.isolationTag.toUpperCase(),
        priority: s.urgent ? "URGENT" : "Normal",
        status: s.status.toUpperCase(),
      });
      row.height = 20;
      row.eachCell(cell => {
        cell.font = regularText;
        cell.border = thinBorder;
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });
    }
  }

  // -------------------------------------------------------------------------
  // Sheet 3: Maintenance & Repairs
  // -------------------------------------------------------------------------
  const repairsSheet = workbook.addWorksheet("Maintenance & Repairs", {
    views: [{ showGridLines: true }],
  });

  repairsSheet.columns = [
    { header: "Repair ID", key: "id", width: 14 },
    { header: "Machine", key: "machineLabel", width: 16 },
    { header: "Reported Date", key: "reportedAt", width: 20 },
    { header: "Reported By", key: "reportedBy", width: 18 },
    { header: "Technician", key: "technician", width: 18 },
    { header: "Issue Description", key: "issue", width: 32 },
    { header: "Action Taken", key: "actionTaken", width: 32 },
    { header: "Parts Replaced", key: "partsReplaced", width: 24 },
    { header: "Resolved Date", key: "resolvedAt", width: 20 },
    { header: "Status", key: "status", width: 16 },
  ];

  const repairsHeader = repairsSheet.getRow(1);
  repairsHeader.height = 26;
  repairsHeader.eachCell(cell => {
    cell.fill = tableHeaderFill;
    cell.font = whiteBoldText;
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  for (const m of report.machines) {
    for (const r of m.repairs) {
      const row = repairsSheet.addRow({
        id: r.id,
        machineLabel: r.machineLabel,
        reportedAt: r.reportedAt.toLocaleString([], { timeZone: "Asia/Manila" }),
        reportedBy: r.reportedBy,
        technician: r.technician ?? "—",
        issue: r.issue,
        actionTaken: r.actionTaken ?? "—",
        partsReplaced: r.partsReplaced ?? "—",
        resolvedAt: r.resolvedAt ? r.resolvedAt.toLocaleString([], { timeZone: "Asia/Manila" }) : "Unresolved",
        status: r.status.toUpperCase(),
      });
      row.height = 20;
      row.eachCell(cell => {
        cell.font = regularText;
        cell.border = thinBorder;
        cell.alignment = { vertical: "middle", horizontal: "left" };
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
