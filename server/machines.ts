import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { floors, machines, narrativeHistory, narrativeReports, sessions, waitingList } from "../drizzle/schema";

export type MachineStatus = "active" | "backup" | "repair";

export type MachineWithSession = {
  machine: { id: number; label: string; location: string; floorId: number | null; sortOrder: number; status: MachineStatus; statusNote: string | null };
  session: {
    id: number;
    machineId: number;
    patientId: string;
    durationMinutes: number;
    startedAt: Date;
    endsAt: Date;
    isolationTag: "clean" | "dirty";
    urgent: boolean;
    startedBy: string | null;
    displayLabel: string | null;
    assignedNurse: string | null;
    needsRepairAfterSession: boolean;
    /** UTC timestamp when the session was paused (NULL = running). */
    pausedAt: Date | null;
    /** Cumulative seconds paused; effective end time = endsAt + pausedSeconds. */
    pausedSeconds: number;
  } | null;
};

export async function listMachines(): Promise<MachineWithSession[]> {
  const db = await getDb();
  if (!db) return [];

  // Run both queries concurrently: each round-trip to the remote database
  // carries its own latency (remote pooler), so parallelizing cuts the wait
  // for the occupancy board roughly in half on cold-ish connections.
  const [allMachines, rows] = await Promise.all([
    db.select().from(machines).orderBy(machines.floorId, machines.sortOrder, machines.id),
    // Floor boards only show machines with status 'active'. Backup/repair
    // machines live on the dedicated Backup & Repair board instead.
    db.select().from(sessions).where(eq(sessions.status, "active")),
  ]);

  const byMachine = new Map<number, (typeof rows)[number]>();
  for (const row of rows) byMachine.set(row.machineId, row);

  return allMachines
    .map(m => ({
    machine: { id: m.id, label: m.label, location: m.location, floorId: m.floorId, sortOrder: m.sortOrder, status: m.status, statusNote: m.statusNote },
    session: (() => {
      const s = byMachine.get(m.id);
      if (!s) return null;
      return {
        id: s.id,
        machineId: s.machineId,
        patientId: s.patientId,
        durationMinutes: s.durationMinutes,
        startedAt: s.startedAt,
        endsAt: s.endsAt,
        isolationTag: s.isolationTag,
        urgent: s.urgent,
        startedBy: s.startedBy,
        displayLabel: s.displayLabel,
        assignedNurse: s.assignedNurse,
        needsRepairAfterSession: s.needsRepairAfterSession,
        pausedAt: s.pausedAt,
        pausedSeconds: s.pausedSeconds,
      };
    })(),
  }))
    .filter(r => r.machine.status === "active");
}

export async function assignSession(input: {
  machineId: number;
  patientId: string;
  durationMinutes: number;
  isolationTag: "clean" | "dirty";
  urgent: boolean;
  startedBy: string;
  displayLabel?: string | null;
  assignedNurse?: string | null;
  /** When true, ending this session automatically parks the machine in repair storage. */
  needsRepairAfterSession?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Run the check and insert on a single connection so two concurrent
  // assignments for the same machine cannot both pass the occupancy check.
  return await db.transaction(async tx => {
    const conflict = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.machineId, input.machineId), eq(sessions.status, "active")))
      .limit(1)
      .for("update");
    if (conflict.length > 0) {
      throw new Error("MACHINE_OCCUPIED");
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + input.durationMinutes * 60 * 1000);

    const result = await tx
      .insert(sessions)
      .values({
        machineId: input.machineId,
        patientId: input.patientId,
        durationMinutes: input.durationMinutes,
        startedAt: now,
        endsAt,
        isolationTag: input.isolationTag,
        urgent: input.urgent,
        startedBy: input.startedBy,
        displayLabel: input.displayLabel ? input.displayLabel.trim() || null : null,
        assignedNurse: input.assignedNurse ? input.assignedNurse.trim() || null : null,
        needsRepairAfterSession: input.needsRepairAfterSession === true,
      })
      .returning({ id: sessions.id });

    return result[0];
  });
}

export async function endSession(input: {
  sessionId: number;
  endedBy: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  // Fetch the pause state + repair flag before ending so we can act on them afterwards.
  // If the session is currently paused, resume it first so pausedSeconds is finalized
  // and the machine isn't left with a stale pausedAt.
  const session = await db
    .select({
      needsRepairAfterSession: sessions.needsRepairAfterSession,
      machineId: sessions.machineId,
      pausedAt: sessions.pausedAt,
      pausedSeconds: sessions.pausedSeconds,
      endsAt: sessions.endsAt,
    })
    .from(sessions)
    .where(eq(sessions.id, input.sessionId))
    .limit(1);

  const row = session[0];
  if (row) {
    // Cumulative paused time across the whole session. While currently paused,
    // the live pause still counts (from pausedAt until this end call); otherwise
    // the stored pausedSeconds is final.
    const elapsedPausedSeconds = row.pausedAt
      ? Math.round((now.getTime() - row.pausedAt.getTime()) / 1000)
      : 0;
    const totalPausedSeconds = row.pausedSeconds + elapsedPausedSeconds;
    // The stored endsAt was already shifted by previously-completed pauses, so
    // only the live (just-closed) pause shifts it further.
    const shiftedEndsAt = new Date(row.endsAt.getTime() + elapsedPausedSeconds * 1000);
    await db
      .update(sessions)
      .set({
        pausedAt: null,
        pausedSeconds: row.pausedAt ? Math.max(0, totalPausedSeconds) : row.pausedSeconds,
        endsAt: shiftedEndsAt,
        status: "ended",
        endedAt: now,
        endedBy: input.endedBy,
      })
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.status, "active")));
  } else {
    await db
      .update(sessions)
      .set({ status: "ended", endedAt: now, endedBy: input.endedBy })
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.status, "active")));
  }

  // If the session was flagged for repair, park the machine in repair storage
  if (session[0]?.needsRepairAfterSession) {
    await setMachineStatus({ machineId: session[0].machineId, status: "repair" })
      .catch(() => {
        // Machine may already be off the floor or missing — never fail the end.
      });
  }
}

export async function toggleUrgent(input: { sessionId: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(sessions)
    .set({ urgent: sql`NOT urgent` })
    .where(eq(sessions.id, input.sessionId));
}

/**
 * Pause or resume an active session. While paused the countdown stops and the
 * effective end time shifts forward by the paused duration; resuming records the
 * elapsed pause into pausedSeconds so every client computes the same end time.
 */
export async function togglePause(input: { sessionId: number; paused: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  const rows = await db
    .select({ pausedAt: sessions.pausedAt, pausedSeconds: sessions.pausedSeconds, endsAt: sessions.endsAt })
    .from(sessions)
    .where(and(eq(sessions.id, input.sessionId), eq(sessions.status, "active")))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("NO_ACTIVE_SESSION");

  if (input.paused) {
    // Start a pause — freeze the end time until resumed.
    if (row.pausedAt) return; // already paused
    await db
      .update(sessions)
      .set({ pausedAt: now })
      .where(eq(sessions.id, input.sessionId));
  } else {
    // Resume — fold the elapsed pause into pausedSeconds and shift endsAt.
    if (!row.pausedAt) return; // not paused
    const pausedMs = now.getTime() - row.pausedAt.getTime();
    const addedSeconds = Math.round(pausedMs / 1000);
    const newEndsAt = new Date(row.endsAt.getTime() + addedSeconds * 1000);
    await db
      .update(sessions)
      .set({
        pausedAt: null,
        pausedSeconds: Math.max(0, row.pausedSeconds + addedSeconds),
        endsAt: newEndsAt,
      })
      .where(eq(sessions.id, input.sessionId));
  }
}

/** Set or clear the repair-after-session flag on an active session. */
export async function setRepairFlag(input: { sessionId: number; flag: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(sessions)
    .set({ needsRepairAfterSession: input.flag })
    .where(eq(sessions.id, input.sessionId));
}

export async function updateIsolationTag(input: {
  sessionId: number;
  isolationTag: "clean" | "dirty";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(sessions)
    .set({ isolationTag: input.isolationTag })
    .where(eq(sessions.id, input.sessionId));
}

export async function updateDisplayLabel(input: {
  sessionId: number;
  displayLabel: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const label = input.displayLabel ? input.displayLabel.trim() || null : null;
  if (label !== null && label.length > 64) throw new Error("LABEL_TOO_LONG");

  await db
    .update(sessions)
    .set({ displayLabel: label })
    .where(eq(sessions.id, input.sessionId));
}

export async function getSessionFloorId(sessionId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select({ machineId: sessions.machineId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!rows[0]) return undefined;
  const machine = await getMachineById(rows[0].machineId);
  return machine?.floorId ?? null;
}

export async function getMachineById(machineId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(machines)
    .where(eq(machines.id, machineId))
    .limit(1);
  return rows[0];
}

export async function listFloors() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(floors).orderBy(floors.sortOrder, floors.id);
}

export async function addMachine(input: {
  label: string;
  floorId: number | null;
  location: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Prevent duplicate labels
  const existing = await db
    .select({ id: machines.id })
    .from(machines)
    .where(eq(machines.label, input.label.trim()))
    .limit(1);
  if (existing.length > 0) {
    throw new Error("MACHINE_LABEL_EXISTS");
  }

  const maxOrder = await db
    .select({ sortOrder: machines.sortOrder })
    .from(machines)
    .where(input.floorId ? eq(machines.floorId, input.floorId) : isNull(machines.floorId))
    .orderBy(desc(machines.sortOrder))
    .limit(1);

  const nextOrder = (maxOrder[0]?.sortOrder ?? 0) + 1;

  const result = await db
    .insert(machines)
    .values({
      label: input.label.trim(),
      location: input.location.trim() || "—",
      floorId: input.floorId,
      sortOrder: nextOrder,
    })
    .returning({ id: machines.id });

  return result[0];
}

export async function updateMachineLabel(input: { machineId: number; label: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const newLabel = input.label.trim();
  if (!newLabel) throw new Error("LABEL_REQUIRED");

  // Prevent duplicate labels (excluding the machine being renamed)
  const existing = await db
    .select({ id: machines.id })
    .from(machines)
    .where(and(eq(machines.label, newLabel), sql`${machines.id} <> ${input.machineId}`))
    .limit(1);
  if (existing.length > 0) {
    throw new Error("MACHINE_LABEL_EXISTS");
  }

  await db
    .update(machines)
    .set({ label: newLabel })
    .where(eq(machines.id, input.machineId));
}

/** Non-floor machines for the Backup & Repair board, grouped by status. */
export type OffboardedMachine = {
  id: number;
  label: string;
  location: string;
  status: MachineStatus;
  statusNote: string | null;
  floorId: number | null;
  createdAt: Date;
};

export async function listOffboardedMachines(): Promise<OffboardedMachine[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: machines.id,
      label: machines.label,
      location: machines.location,
      status: machines.status,
      statusNote: machines.statusNote,
      floorId: machines.floorId,
      createdAt: machines.createdAt,
    })
    .from(machines)
    .where(sql`${machines.status} <> 'active'`)
    .orderBy(machines.status, machines.sortOrder, machines.id);
  return rows;
}

/**
 * Move a machine to backup/repair (off the floor) or back to active on a
 * floor. Throws MACHINE_IN_TREATMENT when the machine has an active session.
 * Scoping (which floors the caller may touch) is enforced in the router.
 */
export async function setMachineStatus(input: {
  machineId: number;
  status: MachineStatus;
  /** Required when status === "active": floor to return the machine to. */
  floorId?: number | null;
  statusNote?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const machine = await getMachineById(input.machineId);
  if (!machine) throw new Error("MACHINE_NOT_FOUND");

  // Reject moving a machine mid-treatment; staff must end the session first.
  const active = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.machineId, input.machineId), eq(sessions.status, "active")))
    .limit(1);
  if (active.length > 0) {
    throw new Error("MACHINE_IN_TREATMENT");
  }

  if (input.status === "active") {
    if (input.floorId === undefined || input.floorId === null) {
      throw new Error("FLOOR_REQUIRED");
    }
    const floor = await db.select({ id: floors.id }).from(floors).where(eq(floors.id, input.floorId)).limit(1);
    if (floor.length === 0) throw new Error("FLOOR_NOT_FOUND");
  }

  const note = input.statusNote?.trim() || null;

  await db
    .update(machines)
    .set({
      status: input.status,
      statusNote: note,
      floorId: input.status === "active" ? input.floorId! : machine.floorId,
    })
    .where(eq(machines.id, input.machineId));
}

/**
 * Drag-and-drop swap/reorder: exchange two machines between different floors,
 * or rearrange their positions when they share the same board. Both machines
 * must be free of active sessions. Scoping is enforced in the router (nurses
 * may swap only when both floors are theirs or supervisor).
 */
export async function swapMachines(input: { machineAId: number; machineBId: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const a = await getMachineById(input.machineAId);
  const b = await getMachineById(input.machineBId);
  if (!a || !b) throw new Error("MACHINE_NOT_FOUND");
  if (a.id === b.id) throw new Error("SAME_MACHINE");
  if (!a.floorId || !b.floorId) throw new Error("FLOOR_REQUIRED");
  // Only active floor machines participate in swaps/reorders.
  if (a.status !== "active" || b.status !== "active") throw new Error("MACHINE_OFFBOARD");

  const active = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(sql`${sessions.machineId} IN (${input.machineAId}, ${input.machineBId})`, eq(sessions.status, "active")),
    )
    .limit(1);
  if (active.length > 0) throw new Error("MACHINE_IN_TREATMENT");

  if (a.floorId === b.floorId) {
    // Same-board drop = rearrange positions by exchanging sortOrder.
    await reorderMachines(input.machineAId, input.machineBId);
    return;
  }

  await db
    .update(machines)
    .set({ floorId: b.floorId })
    .where(eq(machines.id, a.id));
  await db
    .update(machines)
    .set({ floorId: a.floorId })
    .where(eq(machines.id, b.id));
}

/** Exchange the sort positions of two machines on the same board. */
async function reorderMachines(machineAId: number, machineBId: number) {
  const db = await getDb();
  if (!db) return;

  const a = await getMachineById(machineAId);
  const b = await getMachineById(machineBId);
  if (!a || !b || a.floorId !== b.floorId) return;

  await db
    .update(machines)
    .set({ sortOrder: b.sortOrder })
    .where(eq(machines.id, a.id));
  await db
    .update(machines)
    .set({ sortOrder: a.sortOrder })
    .where(eq(machines.id, b.id));
}

/* ------------------------------------------------------------------ */
/* Narrative reports (charge-nurse session/transition narratives)      */
/* ------------------------------------------------------------------ */

/**
 * Reporting periods for a board's day. Sessions are the four treatment
 * windows; transitions are the hooking/terminating windows that overlap
 * session boundaries (patients leaving and arriving).
 */
/**
 * Supervisor shift narratives (written in the End of Day Report, 7-3 / 3-11 /
 * 11-7). Stored in the same narrative_reports table with a namespaced key so
 * the board-level NarrativeReport ignores them (it renders only session*/
/** transition keys). */
export const SUPERVISOR_PERIODS = [
  { key: "supShift1", label: "Supervisor Shift · 7:00 AM – 3:00 PM", hours: [7, 15] },
  { key: "supShift2", label: "Supervisor Shift · 3:00 – 11:00 PM", hours: [15, 23] },
  { key: "supShift3", label: "Supervisor Shift · 11:00 PM – 7:00 AM", hours: [23, 7] },
] as const;

export const REPORT_PERIODS = [
  { key: "session1", label: "Session 1 (5:00 AM – 10:00 AM)", hours: [5, 10] },
  { key: "transition1", label: "Transition 1 · Hooking & Terminating (9:00 – 11:00 AM)", hours: [9, 11] },
  { key: "session2", label: "Session 2 (10:00 AM – 2:00 PM)", hours: [10, 14] },
  { key: "transition2", label: "Transition 2 · Hooking & Terminating (1:00 – 3:00 PM)", hours: [13, 15] },
  { key: "session3", label: "Session 3 (2:00 – 6:00 PM)", hours: [14, 18] },
  { key: "transition3", label: "Transition 3 · Hooking & Terminating (5:00 – 8:00 PM)", hours: [17, 20] },
  { key: "session4", label: "Session 4 (6:00 – 10:00 PM)", hours: [18, 22] },
] as const;

/** Supported nurse shift windows. */
export const REPORT_SHIFTS = [
  { key: "05-13", label: "5:00 AM – 1:00 PM" },
  { key: "13-21", label: "1:00 – 9:00 PM" },
  { key: "21-05", label: "9:00 PM – 5:00 AM" },
  { key: "07-15", label: "7:00 AM – 3:00 PM" },
  { key: "15-23", label: "3:00 – 11:00 PM" },
  { key: "23-07", label: "11:00 PM – 7:00 AM" },
] as const;

export const BOARD_PERIOD_KEYS: ReadonlySet<string> = new Set(REPORT_PERIODS.map(p => p.key));
export const SUPERVISOR_PERIOD_KEYS: ReadonlySet<string> = new Set(SUPERVISOR_PERIODS.map(p => p.key));

export async function createNarrative(input: {
  floorId: number;
  reportDate: string;
  periodKey: string;
  shiftKey?: string | null;
  author: string;
  authorRole: string;
  body: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const isSupervisorPeriod = SUPERVISOR_PERIOD_KEYS.has(input.periodKey);
  // Board-level periods (sessions + transitions) are written by charge nurses;
  // supervisors are viewers only there. Supervisor shift narratives are written
  // in the End of Day Report by supervisors only.
  const role = input.authorRole ?? null;
  if (isSupervisorPeriod) {
    if (role !== "supervisor") throw new Error("FORBIDDEN_PERIOD");
  } else if (!BOARD_PERIOD_KEYS.has(input.periodKey)) {
    throw new Error("INVALID_PERIOD");
  } else if (role === "supervisor") {
    throw new Error("FORBIDDEN_PERIOD");
  }
  const body = input.body.trim();
  if (!body) throw new Error("EMPTY_BODY");

  const result = await db
    .insert(narrativeReports)
    .values({
      floorId: input.floorId,
      reportDate: input.reportDate,
      periodKey: input.periodKey,
      shiftKey: input.shiftKey?.trim() || null,
      author: input.author,
      body,
    })
    .returning({ id: narrativeReports.id });

  // Audit trail: who created the narrative and when.
  await db.insert(narrativeHistory).values({
    narrativeId: result[0].id,
    floorId: input.floorId,
    reportDate: input.reportDate,
    periodKey: input.periodKey,
    action: "create",
    actor: input.author,
    actorRole: input.authorRole ?? null,
    bodySnapshot: body,
  });

  return result[0];
}

export async function getNarrativeById(id: number, floorId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(narrativeReports)
    .where(and(eq(narrativeReports.id, id), eq(narrativeReports.floorId, floorId)))
    .limit(1);
  return rows[0];
}

export async function updateNarrativeBody(id: number, body: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(narrativeReports).set({ body }).where(eq(narrativeReports.id, id));
}

export async function listNarratives(input: { floorId: number; reportDate: string }) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(narrativeReports)
    .where(and(eq(narrativeReports.floorId, input.floorId), eq(narrativeReports.reportDate, input.reportDate)))
    .orderBy(narrativeReports.updatedAt);
}

export async function deleteNarrative(input: { id: number; floorId: number; actor?: string; actorRole?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Snapshot the narrative before deleting so the audit trail retains it.
  const rows = await db
    .select()
    .from(narrativeReports)
    .where(and(eq(narrativeReports.id, input.id), eq(narrativeReports.floorId, input.floorId)));
  await db
    .delete(narrativeReports)
    .where(and(eq(narrativeReports.id, input.id), eq(narrativeReports.floorId, input.floorId)));
  const row = rows[0];
  if (row) {
    await db.insert(narrativeHistory).values({
      narrativeId: row.id,
      floorId: row.floorId,
      reportDate: row.reportDate,
      periodKey: row.periodKey,
      action: "delete",
      actor: input.actor ?? "(unknown)",
      actorRole: input.actorRole ?? null,
      bodySnapshot: row.body,
    });
  }
}

/** Audit row for a narrative edit (the router writes the new body itself). */
export async function logNarrativeUpdate(input: {
  narrativeId: number;
  floorId: number;
  reportDate: string;
  periodKey: string;
  actor: string;
  actorRole: string | null;
  body: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(narrativeHistory).values({
    narrativeId: input.narrativeId,
    floorId: input.floorId,
    reportDate: input.reportDate,
    periodKey: input.periodKey,
    action: "update",
    actor: input.actor,
    actorRole: input.actorRole,
    bodySnapshot: input.body,
  });
}

/** Edit-history rows for the auditor. Optional floor/date filter. */
export async function listNarrativeHistory(input: { reportDate?: string; floorId?: number }) {
  const db = await getDb();
  if (!db) return [];
  if (input.floorId !== undefined && input.reportDate) {
    return db
      .select()
      .from(narrativeHistory)
      .where(
        and(eq(narrativeHistory.floorId, input.floorId), eq(narrativeHistory.reportDate, input.reportDate))
      )
      .orderBy(narrativeHistory.createdAt);
  }
  return db.select().from(narrativeHistory).orderBy(narrativeHistory.createdAt);
}

/**
 * Compute per-machine pause minutes and idle minutes for a floor day.
 * Returns a map of machineId -> { pausedMinutes, idleMinutes, occupiedMinutes }.
 * The operating day window is taken as the union of all active sessions on the
 * floor for that date (floors don't have fixed "open" hours), so idle time
 * measures gaps between sessions while the floor was operating.
 */
export async function machineDayMetrics(input: { floorId: number; date: string }) {
  const db = await getDb();
  const out: Record<string, { pausedMinutes: number; idleMinutes: number; occupiedMinutes: number }> = {};
  if (!db) return out;

  const dateStart = new Date(`${input.date}T00:00:00Z`);
  const dateEnd = new Date(`${input.date}T23:59:59Z`);

  const rows = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.status, "ended"),
        sql`${sessions.endedAt} >= ${dateStart}`,
        sql`${sessions.endedAt} <= ${dateEnd}`,
      ),
    );
  // Also include currently active sessions that started today.
  const activeToday = await db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.status, "active"), sql`${sessions.startedAt} >= ${dateStart}`, sql`${sessions.startedAt} <= ${dateEnd}`),
    );

  // Map session.machineId -> machineId requires machine rows on this floor.
  const floorMachines = await db
    .select({ id: machines.id, machineId: machines.id })
    .from(machines)
    .where(and(eq(machines.floorId, input.floorId), eq(machines.status, "active")));
  const onFloor = new Set(floorMachines.map(m => m.id));

  const byMachine = new Map<number, { sessions: (typeof rows)[number][]; pausedSeconds: number }>();
  for (const s of [...rows, ...activeToday]) {
    if (!onFloor.has(s.machineId)) continue;
    let acc = byMachine.get(s.machineId);
    if (!acc) {
      acc = { sessions: [], pausedSeconds: 0 };
      byMachine.set(s.machineId, acc);
    }
    acc.sessions.push(s);
  }

  const now = Date.now();
  for (const entry of Array.from(byMachine.entries())) {
    const [machineId, acc] = entry;
    let occupiedMs = 0;
    let pausedMs = 0;
    for (const s of acc.sessions) {
      const start = Math.max(s.startedAt.getTime(), dateStart.getTime());
      const end = Math.min((s.endedAt ?? new Date(now)).getTime(), dateEnd.getTime());
      if (end > start) occupiedMs += end - start;
      // pausedSeconds accumulates any pauses that completed within the session.
      pausedMs += Math.max(0, s.pausedSeconds) * 1000;
    }
    const floorStart = dateStart.getTime();
    const floorEnd = dateEnd.getTime();
    // Idle = time the floor was operating but this machine was not in treatment.
    const idleMs = Math.max(0, floorEnd - floorStart - occupiedMs);
    out[String(machineId)] = {
      pausedMinutes: Math.round(pausedMs / 60000),
      idleMinutes: Math.round(idleMs / 60000),
      occupiedMinutes: Math.round(occupiedMs / 60000),
    };
  }
  return out;
}

/**
 * Bulk version of machineDayMetrics for a whole date range. Computes
 * { pausedMinutes, idleMinutes, occupiedMinutes } per machine in ONE query
 * (plus one machine-list query per floor) instead of one query per day.
 * Used by monthReport to keep monthly aggregation fast.
 */
async function machineRangeMetrics(input: {
  floorId: number;
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<Record<string, { pausedMinutes: number; idleMinutes: number; occupiedMinutes: number }>> {
  const db = await getDb();
  const out: Record<string, { pausedMinutes: number; idleMinutes: number; occupiedMinutes: number }> = {};
  if (!db) return out;

  // All ended sessions that ended within the UTC range.
  const rows = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.status, "ended"),
        sql`${sessions.endedAt} >= ${input.rangeStart}`,
        sql`${sessions.endedAt} < ${input.rangeEnd}`,
      ),
    );
  // Active sessions that started within the range (still running).
  const active = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.status, "active"),
        sql`${sessions.startedAt} >= ${input.rangeStart}`,
        sql`${sessions.startedAt} < ${input.rangeEnd}`,
      ),
    );

  const floorMachines = await db
    .select({ id: machines.id })
    .from(machines)
    .where(and(eq(machines.floorId, input.floorId), eq(machines.status, "active")));
  const onFloor = new Set(floorMachines.map(m => m.id));

  // Operating window of the floor in this range = union of session spans
  // clipped to the range, mirroring machineDayMetrics's "open hours = session
  // hours" semantics.
  let floorStart: number | null = null;
  let floorEnd: number | null = null;
  const byMachine = new Map<number, { sessions: (typeof rows)[number][] }>();
  const now = Date.now();
  for (const s of [...rows, ...active]) {
    if (!onFloor.has(s.machineId)) continue;
    const start = Math.max(s.startedAt.getTime(), input.rangeStart.getTime());
    const end = Math.min((s.endedAt ?? new Date(now)).getTime(), input.rangeEnd.getTime());
    if (end <= start) continue;
    if (floorStart === null) {
      floorStart = start;
      floorEnd = end;
    } else {
      floorStart = Math.min(floorStart, start);
      floorEnd = Math.max(floorEnd!, end);
    }
    let acc = byMachine.get(s.machineId);
    if (!acc) {
      acc = { sessions: [] };
      byMachine.set(s.machineId, acc);
    }
    acc.sessions.push(s);
  }
  if (floorStart === null || floorEnd === null) return out;

  for (const entry of Array.from(byMachine.entries())) {
    const [machineId, acc] = entry;
    let occupiedMs = 0;
    let pausedMs = 0;
    for (const s of acc.sessions) {
      const start = Math.max(s.startedAt.getTime(), input.rangeStart.getTime());
      const end = Math.min((s.endedAt ?? new Date(now)).getTime(), input.rangeEnd.getTime());
      if (end > start) occupiedMs += end - start;
      pausedMs += Math.max(0, s.pausedSeconds) * 1000;
    }
    const idleMs = Math.max(0, floorEnd - floorStart - occupiedMs);
    out[String(machineId)] = {
      pausedMinutes: Math.round(pausedMs / 60000),
      idleMinutes: Math.round(idleMs / 60000),
      occupiedMinutes: Math.round(occupiedMs / 60000),
    };
  }
  return out;
}

export async function removeMachine(input: { machineId: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Refuse to remove a machine mid-treatment
  const active = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.machineId, input.machineId), eq(sessions.status, "active")))
    .limit(1);
  if (active.length > 0) {
    throw new Error("MACHINE_IN_TREATMENT");
  }

  // Machines in Backup/Repair storage are off the floor — return them to a
  // board first; this keeps the machine count on each board accurate.
  const machine = await db
    .select({ status: machines.status })
    .from(machines)
    .where(eq(machines.id, input.machineId))
    .limit(1);
  if (machine.length === 0) throw new Error("MACHINE_NOT_FOUND");
  if (machine[0].status !== "active") {
    throw new Error("MACHINE_OFFBOARD");
  }

  await db.delete(sessions).where(eq(sessions.machineId, input.machineId));
  await db.delete(machines).where(eq(machines.id, input.machineId));
}

export async function addRoom(input: { name: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select({ id: floors.id })
    .from(floors)
    .where(eq(floors.name, input.name.trim()))
    .limit(1);
  if (existing.length > 0) {
    throw new Error("ROOM_EXISTS");
  }

  const maxOrder = await db
    .select({ sortOrder: floors.sortOrder })
    .from(floors)
    .orderBy(desc(floors.sortOrder))
    .limit(1);

  const code = `F${(maxOrder[0]?.sortOrder ?? 0) + 1}`;

  const result = await db
    .insert(floors)
    .values({
      code,
      name: input.name.trim(),
      sortOrder: (maxOrder[0]?.sortOrder ?? 0) + 1,
    })
    .returning({ id: floors.id });

  return result[0];
}

export async function renameRoom(input: { roomId: number; name: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const newName = input.name.trim();
  if (!newName) throw new Error("ROOM_NAME_REQUIRED");
  if (newName.length > 64) throw new Error("ROOM_NAME_TOO_LONG");

  // Prevent duplicate room names (excluding the room being renamed)
  const existing = await db
    .select({ id: floors.id })
    .from(floors)
    .where(and(eq(floors.name, newName), sql`${floors.id} <> ${input.roomId}`))
    .limit(1);
  if (existing.length > 0) {
    throw new Error("ROOM_EXISTS");
  }

  await db
    .update(floors)
    .set({ name: newName })
    .where(eq(floors.id, input.roomId));
}

export async function removeRoom(input: { roomId: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const active = await db
    .select({ id: sessions.id })
    .from(sessions)
    .innerJoin(machines, eq(machines.id, sessions.machineId))
    .where(and(eq(machines.floorId, input.roomId), eq(sessions.status, "active")))
    .limit(1);
  if (active.length > 0) {
    throw new Error("ROOM_HAS_ACTIVE_SESSIONS");
  }

  const machineCount = await db
    .select({ id: machines.id })
    .from(machines)
    .where(eq(machines.floorId, input.roomId))
    .limit(1);
  if (machineCount.length > 0) {
    throw new Error("ROOM_HAS_MACHINES");
  }

  await db.delete(floors).where(eq(floors.id, input.roomId));
}

// ---------------------------------------------------------------------------
// Waiting list helpers
// ---------------------------------------------------------------------------

export type WaitingEntryView = {
  id: number;
  patientId: string;
  floorId: number;
  priority: "normal" | "urgent" | "veryUrgent";
  /** Planned treatment length captured when the patient joined the queue. */
  durationMinutes: number;
  isolationTag: "clean" | "dirty";
  assignedNurse: string | null;
  addedBy: string | null;
  joinedAt: Date;
};

/** Shared row → view mapper for the waiting list queries. */
function toWaitingView(r: typeof waitingList.$inferSelect): WaitingEntryView {
  return {
    id: r.id,
    patientId: r.patientId,
    floorId: r.floorId,
    priority: r.priority,
    durationMinutes: r.durationMinutes,
    isolationTag: r.isolationTag,
    assignedNurse: r.assignedNurse,
    addedBy: r.addedBy,
    joinedAt: r.joinedAt,
  };
}

/** Every still-waiting patient across all floors (for the cross-board urgent register). */
export async function listWaitingAll(): Promise<WaitingEntryView[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(waitingList)
    .where(eq(waitingList.status, "waiting"))
    .orderBy(desc(waitingList.priority), waitingList.joinedAt, waitingList.id);

  return rows.map(toWaitingView);
}

export async function listWaiting(input: { floorId: number }): Promise<WaitingEntryView[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(waitingList)
    .where(and(eq(waitingList.floorId, input.floorId), eq(waitingList.status, "waiting")))
    .orderBy(desc(waitingList.priority), waitingList.joinedAt, waitingList.id);

  return rows.map(toWaitingView);
}

export async function addWaiting(input: {
  floorId: number;
  patientId: string;
  priority: "normal" | "urgent" | "veryUrgent";
  durationMinutes: number;
  isolationTag: "clean" | "dirty";
  assignedNurse?: string | null;
  addedBy: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const trimmed = input.patientId.trim();
  if (!trimmed) throw new Error("PATIENT_ID_REQUIRED");
  if (trimmed.length > 64) throw new Error("PATIENT_ID_TOO_LONG");
  if (input.durationMinutes < 15 || input.durationMinutes > 1440) {
    throw new Error("DURATION_OUT_OF_RANGE");
  }

  const result = await db
    .insert(waitingList)
    .values({
      floorId: input.floorId,
      patientId: trimmed,
      priority: input.priority,
      durationMinutes: input.durationMinutes,
      isolationTag: input.isolationTag,
      assignedNurse: input.assignedNurse?.trim() || null,
      addedBy: input.addedBy,
    })
    .returning({ id: waitingList.id });

  return result[0];
}

export async function removeWaiting(input: { entryId: number; floorId: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .delete(waitingList)
    .where(
      and(eq(waitingList.id, input.entryId), eq(waitingList.floorId, input.floorId), eq(waitingList.status, "waiting"))
    );
}

export async function markWaitingUrgent(input: {
  entryId: number;
  floorId: number;
  priority: "normal" | "urgent" | "veryUrgent";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(waitingList)
    .set({ priority: input.priority })
    .where(and(eq(waitingList.id, input.entryId), eq(waitingList.floorId, input.floorId), eq(waitingList.status, "waiting")));
}

/** Number of vacant machines on a floor (no active session). */
export async function countVacantMachines(input: { floorId: number }): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const floorMachines = await db
    .select({ id: machines.id })
    .from(machines)
    .where(eq(machines.floorId, input.floorId));

  const occupiedIds = await db
    .select({ machineId: sessions.machineId })
    .from(sessions)
    .where(eq(sessions.status, "active"));
  const occupied = new Set(occupiedIds.map(o => o.machineId));

  return floorMachines.filter(m => !occupied.has(m.id)).length;
}

/**
 * Admit the top waiting patient onto the first vacant machine of the floor.
 * Marks the waiting entry as admitted and starts a session. Throws
 * NO_WAITING_PATIENTS if the queue is empty or NO_VACANT_MACHINE if the floor
 * has no free machine.
 */
export async function admitWaiting(input: {
  floorId: number;
  entryId: number;
  /** Omit to reuse what was captured when the patient joined the queue. */
  durationMinutes?: number;
  isolationTag?: "clean" | "dirty";
  urgent: boolean;
  startedBy: string;
  displayLabel?: string | null;
  assignedNurse?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Locate the waiting entry on this floor (status must still be 'waiting').
  // Done outside the transaction to fail fast, then re-checked inside it.
  const entry = await db
    .select()
    .from(waitingList)
    .where(and(eq(waitingList.id, input.entryId), eq(waitingList.floorId, input.floorId), eq(waitingList.status, "waiting")))
    .limit(1);
  if (entry.length === 0) {
    throw new Error("NO_WAITING_PATIENT");
  }

  const entryRow = entry[0];

  // Queue-captured details are the default; the admit form may override them.
  const durationMinutes = input.durationMinutes ?? entryRow.durationMinutes;
  const isolationTag = input.isolationTag ?? entryRow.isolationTag;
  const assignedNurse = input.assignedNurse?.trim() || entryRow.assignedNurse;

  // Vacancy lookup + session start run in one transaction with row locks so
  // two concurrent admits for the same floor cannot grab the same machine.
  await db.transaction(async tx => {
    // Re-verify the waiting entry is still claimable inside the transaction.
    const locked = await tx
      .select({ id: waitingList.id, patientId: waitingList.patientId })
      .from(waitingList)
      .where(and(eq(waitingList.id, input.entryId), eq(waitingList.status, "waiting")))
      .limit(1)
      .for("update", { skipLocked: true });
    if (locked.length === 0) {
      throw new Error("NO_WAITING_PATIENT");
    }

    // Find the first vacant machine on this floor (lowest sortOrder).
    const floorMachines = await tx
      .select({ id: machines.id })
      .from(machines)
      .where(eq(machines.floorId, input.floorId))
      .orderBy(machines.sortOrder, machines.id);

    const occupiedIds = await tx
      .select({ machineId: sessions.machineId })
      .from(sessions)
      .where(eq(sessions.status, "active"));
    const occupied = new Set(occupiedIds.map(o => o.machineId));

    const vacant = floorMachines.find(m => !occupied.has(m.id));
    if (!vacant) {
      throw new Error("NO_VACANT_MACHINE");
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationMinutes * 60 * 1000);

    await tx.insert(sessions).values({
      machineId: vacant.id,
      patientId: locked[0].patientId,
      durationMinutes,
      startedAt: now,
      endsAt,
      isolationTag,
      urgent: input.urgent || entryRow.priority === "veryUrgent",
      startedBy: input.startedBy,
      displayLabel: input.displayLabel ? input.displayLabel.trim() || null : null,
      assignedNurse: assignedNurse || null,
    });

    await tx
      .update(waitingList)
      .set({ status: "admitted", admittedAt: now })
      .where(eq(waitingList.id, input.entryId));
  });
}

/**
 * Active sessions on a floor with nurse assignment info, for the floor's
 * "Nurse Patient Assignments" list. Nurses with multiple patients appear once
 * per patient row; rows with no nurse are grouped under the label "Unassigned".
 */
export type NurseAssignmentRow = {
  nurse: string;
  /** "session" = on a machine now; "waiting" = queued for this nurse. */
  kind: "session" | "waiting";
  /** Session id or waiting-entry id, unique within its kind. */
  id: number;
  machineId: number | null;
  machineLabel: string | null;
  patientId: string;
  displayLabel: string | null;
  /** Planned end of treatment; null while the patient is still waiting. */
  endsAt: Date | null;
  durationMinutes: number;
  startedAt: Date | null;
  /** When a waiting patient joined the queue; null for active sessions. */
  joinedAt: Date | null;
  urgent: boolean;
  isolationTag: "clean" | "dirty";
};

const UNASSIGNED_NURSE = "Unassigned";

export async function listNurseAssignments(input: { floorId: number }): Promise<NurseAssignmentRow[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      sessionId: sessions.id,
      machineId: sessions.machineId,
      patientId: sessions.patientId,
      durationMinutes: sessions.durationMinutes,
      startedAt: sessions.startedAt,
      endsAt: sessions.endsAt,
      urgent: sessions.urgent,
      isolationTag: sessions.isolationTag,
      displayLabel: sessions.displayLabel,
      assignedNurse: sessions.assignedNurse,
    })
    .from(sessions)
    .innerJoin(machines, eq(sessions.machineId, machines.id))
    .where(and(eq(sessions.status, "active"), eq(machines.floorId, input.floorId)));

  const machineLabels = await db.select({ id: machines.id, label: machines.label }).from(machines);
  const labelById = new Map<number, string>();
  for (const m of machineLabels) labelById.set(m.id, m.label);

  // Patients still queued for this floor belong on the roster too — the team
  // needs to see who a nurse is about to take on, not only who they hold now.
  const waiting = await listWaiting({ floorId: input.floorId });

  const sessionRows: NurseAssignmentRow[] = rows.map(r => ({
    nurse: r.assignedNurse?.trim() || UNASSIGNED_NURSE,
    kind: "session",
    id: r.sessionId,
    machineId: r.machineId,
    machineLabel: labelById.get(r.machineId) ?? `M${r.machineId}`,
    patientId: r.patientId,
    displayLabel: r.displayLabel,
    endsAt: r.endsAt,
    durationMinutes: r.durationMinutes,
    startedAt: r.startedAt,
    joinedAt: null,
    urgent: r.urgent,
    isolationTag: r.isolationTag,
  }));

  const waitingRows: NurseAssignmentRow[] = waiting.map(w => ({
    nurse: w.assignedNurse?.trim() || UNASSIGNED_NURSE,
    kind: "waiting",
    id: w.id,
    machineId: null,
    machineLabel: null,
    patientId: w.patientId,
    displayLabel: null,
    endsAt: null,
    durationMinutes: w.durationMinutes,
    startedAt: null,
    joinedAt: w.joinedAt,
    urgent: w.priority !== "normal",
    isolationTag: w.isolationTag,
  }));

  return [...sessionRows, ...waitingRows].sort((a, b) => {
    const nurseOrder =
      a.nurse === UNASSIGNED_NURSE
        ? b.nurse === UNASSIGNED_NURSE
          ? 0
          : 1
        : b.nurse === UNASSIGNED_NURSE
          ? -1
          : a.nurse.localeCompare(b.nurse);
    if (nurseOrder !== 0) return nurseOrder;
    // In-treatment patients first (soonest to finish), then the queue.
    if (a.kind !== b.kind) return a.kind === "session" ? -1 : 1;
    if (a.endsAt && b.endsAt) return a.endsAt.getTime() - b.endsAt.getTime();
    if (a.joinedAt && b.joinedAt) return a.joinedAt.getTime() - b.joinedAt.getTime();
    return 0;
  });
}

// ---------------------------------------------------------------------------
// End of Day report
// ---------------------------------------------------------------------------

export type EndOfDayReport = {
  reportDate: string;
  floorName: string | null;
  totalMachinesOnFloor: number;
  sessionsEnded: number;
  machinesUtilized: { used: number; total: number };
  patientsCatered: number;
  urgency: { normal: number; urgent: number; veryUrgent: number };
  isolation: { clean: number; dirty: number };
  totalTreatmentHours: number;
  waitingAdds: { normal: number; urgent: number; veryUrgent: number; total: number };
  sessions: {
    patientId: string;
    machineLabel: string;
    durationMinutes: number;
    startedAt: Date;
    endedAt: Date;
    urgent: boolean;
    isolationTag: string;
    nurse: string | null;
  }[];
  /** Per-machine minutes: pause time and idle (vacant) time for the day. */
  machineMetrics: Record<
    string,
    { pausedMinutes: number; idleMinutes: number; occupiedMinutes: number }
  >;
  /** Pause-time summary across the floor for the day. */
  pauseSummary: { totalPausedMinutes: number; machinesPaused: number };
};

/**
 * End of Day report. `date` is ISO YYYY-MM-DD; when omitted, today in
 * Asia/Manila time is used. Aggregates sessions ENDED within the day window:
 * machines utilized, patients catered, urgency and isolation breakdowns.
 */
export async function endOfDayReport(opts?: {
  floorId?: number;
  date?: string;
}): Promise<EndOfDayReport> {
  const db = await getDb();
  if (!db) return baseEmptyReport(opts?.floorId, opts?.date);

  const reportDate = opts?.date ?? manilaToday();
  const range = dayRangeUtc(reportDate);

  const floorName = opts?.floorId ? await floorNameFor(db, opts.floorId) : null;

  // Machines belonging to the selected floor (or all).
  const floorMachines = await db
    .select()
    .from(machines)
    .where(opts?.floorId ? eq(machines.floorId, opts.floorId) : undefined);
  const totalMachinesOnFloor = floorMachines.length;
  const floorMachineIds = new Set(floorMachines.map(m => m.id));
  const machineLabels = new Map<number, string>(floorMachines.map(m => [m.id, m.label]));

  // Sessions that ENDED during the report day (UTC window, +08:00 anchored).
  const rows = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.status, "ended"),
        sql`${sessions.endedAt} >= ${range.from} AND ${sessions.endedAt} < ${range.to}`,
      ),
    );

  const filtered = floorMachineIds.size > 0 ? rows.filter(r => floorMachineIds.has(r.machineId)) : rows;

  const urgency = { normal: 0, urgent: 0, veryUrgent: 0 };
  const isolation = { clean: 0, dirty: 0 };
  const patients = new Set<string>();
  const usedMachines = new Set<number>();
  let totalMinutes = 0;

  for (const s of filtered) {
    if (s.urgent) urgency.urgent++;
    else urgency.normal++;
    if (s.isolationTag === "dirty") isolation.dirty++;
    else isolation.clean++;
    patients.add(s.patientId);
    usedMachines.add(s.machineId);
    totalMinutes += s.durationMinutes;
  }

  // Waiting-list additions during the same day, for the full picture.
  const waitingRows = await db
    .select()
    .from(waitingList)
    .where(
      opts?.floorId
        ? and(
            eq(waitingList.floorId, opts.floorId),
            sql`${waitingList.joinedAt} >= ${range.from} AND ${waitingList.joinedAt} < ${range.to}`,
          )
        : sql`${waitingList.joinedAt} >= ${range.from} AND ${waitingList.joinedAt} < ${range.to}`,
    );
  const waitingAdds = { normal: 0, urgent: 0, veryUrgent: 0, total: waitingRows.length };
  for (const w of waitingRows) {
    if (w.priority === "veryUrgent") waitingAdds.veryUrgent++;
    else if (w.priority === "urgent") waitingAdds.urgent++;
    else waitingAdds.normal++;
  }

  // Per-machine pause & idle minutes for the floor day.
  const machineMetrics = opts?.floorId
    ? await machineDayMetrics({ floorId: opts.floorId, date: reportDate })
    : {};

  // Attach machine labels to the metrics map for display.
  const metricsWithLabels: Record<
    string,
    {
      machineLabel: string;
      pausedMinutes: number;
      idleMinutes: number;
      occupiedMinutes: number;
    }
  > = {};
  for (const key of Object.keys(machineMetrics)) {
    const id = Number(key);
    metricsWithLabels[machineLabels.get(id) ?? key] = {
      machineLabel: machineLabels.get(id) ?? key,
      ...machineMetrics[key],
    };
  }

  let totalPausedMinutes = 0;
  let machinesPaused = 0;
  for (const m of Object.values(metricsWithLabels)) {
    if (m.pausedMinutes > 0) {
      machinesPaused++;
      totalPausedMinutes += m.pausedMinutes;
    }
  }

  return {
    reportDate,
    floorName,
    totalMachinesOnFloor,
    sessionsEnded: filtered.length,
    machinesUtilized: { used: usedMachines.size, total: totalMachinesOnFloor },
    patientsCatered: patients.size,
    urgency,
    isolation,
    totalTreatmentHours: Math.round((totalMinutes / 60) * 10) / 10,
    waitingAdds,
    sessions: filtered.map(s => ({
      patientId: s.patientId,
      machineLabel: machineLabels.get(s.machineId) ?? String(s.machineId),
      durationMinutes: s.durationMinutes,
      startedAt: s.startedAt,
      endedAt: s.endedAt!,
      urgent: s.urgent,
      isolationTag: s.isolationTag,
      nurse: s.assignedNurse,
    })),
    machineMetrics: metricsWithLabels,
    pauseSummary: { totalPausedMinutes, machinesPaused },
  };
}

/** ISO date (YYYY-MM-DD) of today in Asia/Manila timezone. */
function manilaToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

/** UTC day window (00:00–24:00) for an ISO date, anchored to +08:00. */
function dayRangeUtc(isoDate: string): { from: Date; to: Date } {
  const from = new Date(`${isoDate}T00:00:00.000+08:00`);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

/** Resolve a floor name by id, or null. */
async function floorNameFor(db: Awaited<ReturnType<typeof getDb>>, floorId: number): Promise<string | null> {
  if (!db) return null;
  const rows = await db.select().from(floors).where(eq(floors.id, floorId)).limit(1);
  return rows[0]?.name ?? null;
}

function baseEmptyReport(floorId?: number, date?: string): EndOfDayReport {
  void floorId;
  return {
    reportDate: date ?? manilaToday(),
    floorName: null,
    totalMachinesOnFloor: 0,
    sessionsEnded: 0,
    machinesUtilized: { used: 0, total: 0 },
    patientsCatered: 0,
    urgency: { normal: 0, urgent: 0, veryUrgent: 0 },
    isolation: { clean: 0, dirty: 0 },
    totalTreatmentHours: 0,
    waitingAdds: { normal: 0, urgent: 0, veryUrgent: 0, total: 0 },
    sessions: [],
    machineMetrics: {},
    pauseSummary: { totalPausedMinutes: 0, machinesPaused: 0 },
  };
}

/**
 * End of Month report. Aggregates end-of-day data across every day of the
 * given month (Asia/Manila) for each floor: total sessions ended, machines
 * utilized (max of daily peak), patients catered, urgency/isolation
 * breakdowns, treatment hours, waiting-list additions and pause time.
 */
export type MonthlyReportDay = {
  date: string;
  sessionsEnded: number;
  patientsCatered: number;
  machinesUtilized: number;
  totalMachinesOnFloor: number;
  urgency: { normal: number; urgent: number; veryUrgent: number };
  isolation: { clean: number; dirty: number };
  totalTreatmentHours: number;
  waitingAdds: number;
  totalPausedMinutes: number;
};

export type MonthlyBoardReport = {
  floorId: number;
  floorName: string | null;
  month: string; // YYYY-MM
  days: MonthlyReportDay[];
  totals: {
    sessionsEnded: number;
    peakMachinesUtilized: number;
    totalMachinesOnFloor: number;
    patientsCatered: number;
    urgency: { normal: number; urgent: number; veryUrgent: number };
    isolation: { clean: number; dirty: number };
    totalTreatmentHours: number;
    waitingAdds: { normal: number; urgent: number; veryUrgent: number; total: number };
    totalPausedMinutes: number;
    daysWithActivity: number;
  };
};

/** ISO month (YYYY-MM) of today in Asia/Manila time. */
function manilaMonth(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
  });
}

export async function monthReport(opts?: {
  floorId?: number;
  month?: string;
}): Promise<MonthlyBoardReport[]> {
  const db = await getDb();
  if (!db) return [];
  const month = opts?.month ?? manilaMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("Month must be YYYY-MM.");
  }

  // Build the UTC day windows for every day of the month, anchored to +08:00.
  const [year, monthNum] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const dayRanges = Array.from({ length: daysInMonth }, (_, i) => {
    const iso = `${year}-${String(monthNum).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
    return { iso, ...dayRangeUtc(iso) };
  });
  const rangeStart = dayRanges[0].from;
  const rangeEnd = dayRanges[dayRanges.length - 1].to;

  // Load everything once, in parallel: the remote pooler serializes queries
  // (~1.3s each), so one round trip per table beats a per-floor loop.
  const [floorRows, allMachines, monthSessions, allWaiting, activeRows] = await Promise.all([
    db.select().from(floors).where(opts?.floorId ? eq(floors.id, opts.floorId) : undefined),
    db.select().from(machines),
    db.execute(sql`
      SELECT * FROM ${sessions}
      WHERE "status" = 'ended' AND "endedAt" >= ${rangeStart} AND "endedAt" < ${rangeEnd}
    `),
    db.execute(sql`
      SELECT * FROM ${waitingList}
      WHERE "joinedAt" >= ${rangeStart} AND "joinedAt" < ${rangeEnd}
    `),
    db.execute(sql`
      SELECT "machineId","startedAt","endedAt","pausedSeconds","status" FROM ${sessions}
      WHERE "status" = 'active' AND "startedAt" >= ${rangeStart} AND "startedAt" < ${rangeEnd}
    `),
  ]);
  type MonthSessionRow = {
    id: number;
    machineId: number;
    patientId: string;
    startedAt: Date;
    endedAt: Date | null;
    pausedSeconds: number;
    durationMinutes: number;
    urgent: boolean;
    isolationTag: string | null;
  };
  const monthEnded: MonthSessionRow[] = ((monthSessions?.rows ?? []) as unknown[]).map(r => r as MonthSessionRow);
  const waitingRows: { floorId: number; joinedAt: Date; priority: string | null }[] = (allWaiting?.rows ?? []) as never;
  const activeSessionRows: { machineId: number; startedAt: Date; endedAt: Date | null; pausedSeconds: number }[] = ((activeRows?.rows as object[]) ?? []).map((raw: unknown) => {
    const r = raw as { machineId: unknown; startedAt: unknown; endedAt: unknown; pausedSeconds: unknown };
    return {
      machineId: Number(r.machineId ?? 0),
      startedAt: r.startedAt instanceof Date ? r.startedAt : new Date(String(r.startedAt ?? 0)),
      endedAt: r.endedAt instanceof Date ? r.endedAt : (r.endedAt ? new Date(String(r.endedAt)) : null),
      pausedSeconds: Number(r.pausedSeconds ?? 0),
    };
  });

  const out: MonthlyBoardReport[] = [];
  for (const floor of floorRows) {
    const floorMachines = allMachines.filter(m => m.floorId === floor.id);
    const machineIds = new Set(floorMachines.map(m => m.id));
    const machineLabels = new Map<number, string>(floorMachines.map(m => [m.id, m.label]));

    const sOfFloor = monthEnded.filter((s: MonthSessionRow) => machineIds.has(s.machineId));

    // Waiting-list additions during the month on this floor.
    const waiting = waitingRows.filter(w => w.floorId === floor.id);

    const perDay = new Map<string, {
      sessionsEnded: number; patientsCatered: number; machinesUtilized: number;
      urgency: { normal: number; urgent: number; veryUrgent: number };
      isolation: { clean: number; dirty: number }; totalMinutes: number; waitingAdds: number;
      pausedMinutes: number; sessionKeys: Set<string>; machineKeys: Set<number>;
    }>();
    for (const dr of dayRanges) {
      perDay.set(dr.iso, {
        sessionsEnded: 0, patientsCatered: 0, machinesUtilized: 0,
        urgency: { normal: 0, urgent: 0, veryUrgent: 0 },
        isolation: { clean: 0, dirty: 0 }, totalMinutes: 0, waitingAdds: 0,
        pausedMinutes: 0, sessionKeys: new Set(), machineKeys: new Set(),
      });
    }

    const allPatients = new Set<string>();
    for (const s of sOfFloor) {
      const d = new Date(s.endedAt!);
      const iso = d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
      const bucket = perDay.get(iso);
      if (!bucket) continue;
      bucket.sessionKeys.add(String(s.id));
      bucket.machineKeys.add(s.machineId);
      allPatients.add(s.patientId);
      if (s.urgent) bucket.urgency.urgent++;
      else bucket.urgency.normal++;
      if (s.isolationTag === "dirty") bucket.isolation.dirty++;
      else bucket.isolation.clean++;
      bucket.totalMinutes += s.durationMinutes;
    }
    // Waiting adds bucketed per day too.
    for (const w of waiting) {
      const iso = w.joinedAt
        ? new Date(w.joinedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })
        : null;
      if (iso && perDay.has(iso)) perDay.get(iso)!.waitingAdds++;
    }
    // Pause minutes per day via the same machine-day metrics helper. The
    // per-day calls are acceptable here (one query each) because only machines
    // on this floor are re-scanned — but for large months we compute the month
    // in bulk once via machineRangeMetrics and split the paused seconds by day
    // from the already-fetched session rows (pausedSeconds is a session-level
    // cumulative value, so per-session attribution by endedAt day matches the
    // per-day loop above).
    // Pause minutes per floor: compute in memory from the already-fetched
    // sessions (pausedSeconds is cumulative per session, so splitting by the
    // endedAt day matches the per-day loop above). The range-spanning
    // operating window comes straight from the fetched rows.
    const onFloor = new Set(floorMachines.map(m => m.id));
    const floorSessionSpans: { machineId: number; startedAt: Date; endedAt: Date | null; pausedSeconds: number }[] = [
      ...sOfFloor.map((s: MonthSessionRow) => ({ machineId: s.machineId, startedAt: s.startedAt, endedAt: s.endedAt ?? null, pausedSeconds: s.pausedSeconds })),
      ...activeSessionRows.filter(a => onFloor.has(a.machineId)),
    ];
    let floorStart: number | null = null;
    let floorEnd: number | null = null;
    const now = Date.now();
    for (const s of floorSessionSpans) {
      if (!(s.startedAt instanceof Date)) s.startedAt = new Date(s.startedAt);
      if (s.endedAt && !(s.endedAt instanceof Date)) s.endedAt = new Date(s.endedAt);
      const start = Math.max(s.startedAt.getTime(), rangeStart.getTime());
      const end = Math.min((s.endedAt ? s.endedAt.getTime() : now), rangeEnd.getTime());
      if (end <= start) continue;
      if (floorStart === null) { floorStart = start; floorEnd = end; } // (range clipped below)
      else { floorStart = Math.min(floorStart, start); floorEnd = Math.max(floorEnd!, end); }
    }
    const pausedByMachine = new Map<number, number>();
    if (floorStart !== null) {
      for (const s of sOfFloor) {
        const pausedMin = Math.round((s.pausedSeconds ?? 0) * 1000 / 60000);
        if (pausedMin > 0) pausedByMachine.set(s.machineId, (pausedByMachine.get(s.machineId) ?? 0) + pausedMin);
      }
    }
    for (const s of sOfFloor) {
      const pausedMin = pausedByMachine.get(s.machineId) ?? 0;
      if (pausedMin > 0) {
        const d = new Date(s.endedAt!);
        const iso = d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
        const bucket = perDay.get(iso);
        if (bucket) {
          // Attribute the machine's paused minutes to the day the session
          // ended on (same day window used for sessionsEnded/patientsCatered).
          bucket.pausedMinutes += pausedMin;
          pausedByMachine.set(s.machineId, 0);
        }
      }
    }

    const days: MonthlyReportDay[] = dayRanges.map(dr => {
      const b = perDay.get(dr.iso)!;
      b.sessionsEnded = b.sessionKeys.size;
      b.machinesUtilized = b.machineKeys.size;
      b.patientsCatered = b.sessionKeys.size; // sessions ended == patients treated (per session)
      return {
        date: dr.iso,
        sessionsEnded: b.sessionsEnded,
        patientsCatered: b.patientsCatered,
        machinesUtilized: b.machinesUtilized,
        totalMachinesOnFloor: floorMachines.length,
        urgency: { ...b.urgency },
        isolation: { ...b.isolation },
        totalTreatmentHours: Math.round((b.totalMinutes / 60) * 10) / 10,
        waitingAdds: b.waitingAdds,
        totalPausedMinutes: b.pausedMinutes,
      };
    });

    const waitingPriority = { normal: 0, urgent: 0, veryUrgent: 0 };
    for (const w of waiting) {
      if (w.priority === "veryUrgent") waitingPriority.veryUrgent++;
      else if (w.priority === "urgent") waitingPriority.urgent++;
      else waitingPriority.normal++;
    }

    let totalPaused = 0;
    for (const d of days) totalPaused += d.totalPausedMinutes;

    out.push({
      floorId: floor.id,
      floorName: floor.name,
      month,
      days,
      totals: {
        sessionsEnded: days.reduce((a, d) => a + d.sessionsEnded, 0),
        peakMachinesUtilized: Math.max(...days.map(d => d.machinesUtilized), 0),
        totalMachinesOnFloor: floorMachines.length,
        patientsCatered: allPatients.size,
        urgency: {
          normal: days.reduce((a, d) => a + d.urgency.normal, 0),
          urgent: days.reduce((a, d) => a + d.urgency.urgent, 0),
          veryUrgent: days.reduce((a, d) => a + d.urgency.veryUrgent, 0),
        },
        isolation: {
          clean: days.reduce((a, d) => a + d.isolation.clean, 0),
          dirty: days.reduce((a, d) => a + d.isolation.dirty, 0),
        },
        totalTreatmentHours: Math.round(days.reduce((a, d) => a + d.totalTreatmentHours, 0) * 10) / 10,
        waitingAdds: { ...waitingPriority, total: waiting.length },
        totalPausedMinutes: totalPaused,
        daysWithActivity: days.filter(d => d.sessionsEnded > 0).length,
      },
    });
  }
  return out;
}

/**
 * Bulk End of Day report for ALL boards in one server call.
 *
 * The per-floor `endOfDay.summary` RPC issues ~7 DB round trips each; for a
 * supervisor with 5 boards that is 30+ round trips at ~1.3s each (the fixed
 * network cost of the remote Supabase pooler), i.e. 10-15s wall time. This
 * variant fetches everything globally once (~6 round trips TOTAL), which is
 * the single biggest load-time win for the /report page.
 */
export async function endOfDayReportBulk(opts?: { date?: string }): Promise<{
  reportDate: string;
  floors: { id: number; name: string }[];
  summaries: Record<string, EndOfDayReport>;
  narratives: Record<string, NarrativeEntry[]>;
}> {
  const db = await getDb();
  const reportDate = opts?.date ?? manilaToday();
  if (!db) {
    return {
      reportDate,
      floors: [],
      summaries: {},
      narratives: {},
    };
  }

  const t0 = Date.now();
  const floorList = await db.select().from(floors).orderBy(floors.sortOrder, floors.id);
  console.log(`[bulk] floors done at ${Date.now() - t0}ms`);

  const narrativeEntries = await listNarrativesBulk(db, { reportDate });
  console.log(`[bulk] narratives done at ${Date.now() - t0}ms`);

  // Run the remaining day-wide loads concurrently: one sessions, one waiting,
  // one machines query each, regardless of floor count.
  const range = dayRangeUtc(reportDate);
  const t1 = Date.now();
  const [allMachines, waitingRows, daySessions] = await Promise.all([
    db.select().from(machines),
    db
      .select()
      .from(waitingList)
      .where(sql`${waitingList.joinedAt} >= ${range.from} AND ${waitingList.joinedAt} < ${range.to}`),
    // Both ended and active-today sessions in ONE round trip: the remote
    // Supabase pooler runs in transaction mode with a single connection,
    // so "parallel" queries actually serialize (~1.3s each). One UNION
    // all halves the session round trips.
    db.execute(sql`
      SELECT "machineId", "patientId", "startedAt", "endedAt", "pausedSeconds", "durationMinutes",
             "assignedNurse", "status", "urgent", "isolationTag"
      FROM ${sessions}
      WHERE ("status" = 'ended' AND "endedAt" >= ${range.from} AND "endedAt" < ${range.to})
         OR ("status" = 'active' AND "startedAt" >= ${range.from} AND "startedAt" <= ${range.to})
    `),
  ]);
  console.log(`[bulk] big batch done at ${Date.now() - t1}ms (total ${Date.now() - t0}ms)`);
  type DaySessionRow = {
    machineId: number;
    patientId: string;
    startedAt: Date;
    endedAt: Date | null;
    pausedSeconds: number;
    durationMinutes: number;
    assignedNurse: string | null;
    status: string;
    urgent: boolean;
    isolationTag: string | null;
  };
  const ended: DaySessionRow[] = ((daySessions?.rows ?? []) as DaySessionRow[]).filter((r: DaySessionRow) => r.status === "ended");
  const activeToday = ((daySessions?.rows ?? []) as DaySessionRow[]).filter((r: DaySessionRow) => r.status === "active").map((r: DaySessionRow) => ({
    machineId: r.machineId,
    startedAt: r.startedAt,
    pausedSeconds: r.pausedSeconds,
    endedAt: r.endedAt,
  }));

  const byFloor = new Map<number, typeof allMachines>();
  for (const m of allMachines) {
    const arr = byFloor.get(m.floorId ?? 0);
    if (arr) arr.push(m);
    else byFloor.set(m.floorId ?? 0, [m]);
  }

  const summaries: Record<string, EndOfDayReport> = {};
  for (const f of floorList) {
    const floorMachines = byFloor.get(f.id) ?? [];
    const floorMachineIds = new Set(floorMachines.map(m => m.id));
    const machineLabels = new Map<number, string>(floorMachines.map(m => [m.id, m.label]));

    const filtered = ended.filter(r => floorMachineIds.has(r.machineId));
    const urgency = { normal: 0, urgent: 0, veryUrgent: 0 };
    const isolation = { clean: 0, dirty: 0 };
    const patients = new Set<string>();
    const usedMachines = new Set<number>();
    let totalMinutes = 0;
    for (const s of filtered) {
      if (s.urgent) urgency.urgent++;
      else urgency.normal++;
      if (s.isolationTag === "dirty") isolation.dirty++;
      else isolation.clean++;
      patients.add(s.patientId ?? String(s.machineId));
      usedMachines.add(s.machineId);
      totalMinutes += s.durationMinutes;
    }

    const floorWaiting = waitingRows.filter(w => w.floorId === f.id);
    const waitingAdds = { normal: 0, urgent: 0, veryUrgent: 0, total: floorWaiting.length };
    for (const w of floorWaiting) {
      if (w.priority === "veryUrgent") waitingAdds.veryUrgent++;
      else if (w.priority === "urgent") waitingAdds.urgent++;
      else waitingAdds.normal++;
    }

    const machineMetrics = machineDayMetricsInline({
      floorId: f.id,
      date: reportDate,
      ended,
      activeToday,
      machines: floorMachines,
    });

    const metricsWithLabels: Record<string, { machineLabel: string; pausedMinutes: number; idleMinutes: number; occupiedMinutes: number }> = {};
    for (const key of Object.keys(machineMetrics)) {
      const id = Number(key);
      metricsWithLabels[machineLabels.get(id) ?? key] = { machineLabel: machineLabels.get(id) ?? key, ...machineMetrics[key] };
    }

    let totalPausedMinutes = 0;
    let machinesPaused = 0;
    for (const m of Object.values(metricsWithLabels)) {
      if (m.pausedMinutes > 0) {
        machinesPaused++;
        totalPausedMinutes += m.pausedMinutes;
      }
    }

    summaries[String(f.id)] = {
      reportDate,
      floorName: f.name,
      totalMachinesOnFloor: floorMachines.length,
      sessionsEnded: filtered.length,
      machinesUtilized: { used: usedMachines.size, total: floorMachines.length },
      patientsCatered: patients.size,
      urgency,
      isolation,
      totalTreatmentHours: Math.round((totalMinutes / 60) * 10) / 10,
      waitingAdds,
      sessions: filtered.map(s => ({
        patientId: s.patientId ?? String(s.machineId),
        machineLabel: machineLabels.get(s.machineId) ?? String(s.machineId),
        durationMinutes: s.durationMinutes,
        startedAt: s.startedAt,
        endedAt: s.endedAt!,
        urgent: s.urgent,
        isolationTag: s.isolationTag ?? "clean",
        nurse: s.assignedNurse,
      })),
      machineMetrics: metricsWithLabels,
      pauseSummary: { totalPausedMinutes, machinesPaused },
    };
  }

  const narratives: Record<string, NarrativeEntry[]> = {};
  for (const f of floorList) {
    narratives[String(f.id)] = narrativeEntries.filter(e => e.floorId === f.id);
  }

  return { reportDate, floors: floorList, summaries, narratives };
}

type NarrativeEntry = {
  id: number;
  floorId: number;
  reportDate: string;
  periodKey: string;
  shiftKey: string | null;
  author: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

/** Narrative list without a per-floor round trip — used by the bulk endpoint. */
async function listNarrativesBulk(
  db: Awaited<ReturnType<typeof getDb>>,
  opts: { reportDate: string },
): Promise<NarrativeEntry[]> {
  if (!db) return [];
  return db
    .select({
      id: narrativeReports.id,
      floorId: narrativeReports.floorId,
      reportDate: narrativeReports.reportDate,
      periodKey: narrativeReports.periodKey,
      shiftKey: narrativeReports.shiftKey,
      author: narrativeReports.author,
      body: narrativeReports.body,
      createdAt: narrativeReports.createdAt,
      updatedAt: narrativeReports.updatedAt,
    })
    .from(narrativeReports)
    .where(eq(narrativeReports.reportDate, opts.reportDate))
    .orderBy(narrativeReports.floorId, narrativeReports.periodKey);
}

/**
 * Same math as `machineDayMetrics` but reuses the already-fetched ended
 * sessions + floor machine rows, so the bulk endpoint doesn't pay extra
 * round trips per floor.
 */
function machineDayMetricsInline(input: {
  floorId: number;
  date: string;
  ended: {
    machineId: number;
    startedAt: Date;
    endedAt: Date | null;
    pausedSeconds: number;
  }[];
  activeToday: {
    machineId: number;
    startedAt: Date;
    endedAt: Date | null;
    pausedSeconds: number;
  }[];
  machines: { id: number }[];
}): Record<string, { pausedMinutes: number; idleMinutes: number; occupiedMinutes: number }> {
  const { ended, activeToday, machines } = input;
  const out: Record<string, { pausedMinutes: number; idleMinutes: number; occupiedMinutes: number }> = {};
  const dateStart = new Date(`${input.date}T00:00:00Z`);
  const dateEnd = new Date(`${input.date}T23:59:59Z`);
  // Fully in-memory: ended + active-today sessions were pre-fetched
  // day-wide by the bulk helper (no per-floor DB round trips).
  const onFloor = new Set(machines.map(m => m.id));
  const byMachine = new Map<number, { sessions: { startedAt: Date; endedAt: Date | null; pausedSeconds: number }[] }>();
  for (const s of [...ended, ...activeToday]) {
    if (!onFloor.has(s.machineId)) continue;
    let acc = byMachine.get(s.machineId);
    if (!acc) {
      acc = { sessions: [] };
      byMachine.set(s.machineId, acc);
    }
    acc.sessions.push({ startedAt: s.startedAt, endedAt: s.endedAt, pausedSeconds: s.pausedSeconds });
  }

  const now = Date.now();
  for (const entry of Array.from(byMachine.entries())) {
    const [machineId, acc] = entry;
    let occupiedMs = 0;
    let pausedMs = 0;
    for (const s of acc.sessions) {
      const start = Math.max(s.startedAt.getTime(), dateStart.getTime());
      const end = Math.min((s.endedAt ?? new Date(now)).getTime(), dateEnd.getTime());
      if (end > start) occupiedMs += end - start;
      pausedMs += Math.max(0, s.pausedSeconds) * 1000;
    }
    const idleMs = Math.max(0, dateEnd.getTime() - dateStart.getTime() - occupiedMs);
    out[String(machineId)] = {
      pausedMinutes: Math.round(pausedMs / 60000),
      idleMinutes: Math.round(idleMs / 60000),
      occupiedMinutes: Math.round(occupiedMs / 60000),
    };
  }
  return out;
}
