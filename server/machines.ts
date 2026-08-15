import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { floors, machines, sessions, waitingList } from "../drizzle/schema";

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
  } | null;
};

export async function listMachines(): Promise<MachineWithSession[]> {
  const db = await getDb();
  if (!db) return [];

  const allMachines = await db.select().from(machines).orderBy(machines.floorId, machines.sortOrder, machines.id);

  // Floor boards only show machines with status 'active'. Backup/repair machines
  // live on the dedicated Backup & Repair board instead.

  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.status, "active"));

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

  // Guarantee one active session per machine
  const conflict = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.machineId, input.machineId), eq(sessions.status, "active")))
    .limit(1);
  if (conflict.length > 0) {
    throw new Error("MACHINE_OCCUPIED");
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + input.durationMinutes * 60 * 1000);

  const result = await db
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
    .returning({ id: machines.id });

  return result[0];
}

export async function endSession(input: {
  sessionId: number;
  endedBy: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  // Fetch the repair flag before ending so we can act on it afterwards
  const session = await db
    .select({
      needsRepairAfterSession: sessions.needsRepairAfterSession,
      machineId: sessions.machineId,
    })
    .from(sessions)
    .where(eq(sessions.id, input.sessionId))
    .limit(1);

  await db
    .update(sessions)
    .set({ status: "ended", endedAt: now, endedBy: input.endedBy })
    .where(and(eq(sessions.id, input.sessionId), eq(sessions.status, "active")));

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
    .returning({ id: machines.id });

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
    .returning({ id: machines.id });

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

  // Locate the waiting entry on this floor (status must still be 'waiting')
  const entry = await db
    .select()
    .from(waitingList)
    .where(and(eq(waitingList.id, input.entryId), eq(waitingList.floorId, input.floorId), eq(waitingList.status, "waiting")))
    .limit(1);
  if (entry.length === 0) {
    throw new Error("NO_WAITING_PATIENT");
  }

  // Find the first vacant machine on this floor (lowest sortOrder)
  const floorMachines = await db
    .select({ id: machines.id })
    .from(machines)
    .where(eq(machines.floorId, input.floorId))
    .orderBy(machines.sortOrder, machines.id);

  const occupiedIds = await db
    .select({ machineId: sessions.machineId })
    .from(sessions)
    .where(eq(sessions.status, "active"));
  const occupied = new Set(occupiedIds.map(o => o.machineId));

  const vacant = floorMachines.find(m => !occupied.has(m.id));
  if (!vacant) {
    throw new Error("NO_VACANT_MACHINE");
  }

  // Queue-captured details are the default; the admit form may override them.
  const durationMinutes = input.durationMinutes ?? entry[0].durationMinutes;
  const isolationTag = input.isolationTag ?? entry[0].isolationTag;
  const assignedNurse = input.assignedNurse?.trim() || entry[0].assignedNurse;

  const now = new Date();
  const endsAt = new Date(now.getTime() + durationMinutes * 60 * 1000);

  // Start the session, then mark the waiting entry admitted
  await db.insert(sessions).values({
    machineId: vacant.id,
    patientId: entry[0].patientId,
    durationMinutes,
    startedAt: now,
    endsAt,
    isolationTag,
    urgent: input.urgent || entry[0].priority === "veryUrgent",
    startedBy: input.startedBy,
    displayLabel: input.displayLabel ? input.displayLabel.trim() || null : null,
    assignedNurse: assignedNurse || null,
  });

  await db
    .update(waitingList)
    .set({ status: "admitted", admittedAt: now })
    .where(eq(waitingList.id, input.entryId));
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
  };
}
