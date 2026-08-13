import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { floors, machines, sessions, waitingList } from "../drizzle/schema";

export type MachineWithSession = {
  machine: { id: number; label: string; location: string; floorId: number | null; sortOrder: number };
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
  } | null;
};

export async function listMachines(): Promise<MachineWithSession[]> {
  const db = await getDb();
  if (!db) return [];

  const allMachines = await db.select().from(machines).orderBy(machines.floorId, machines.sortOrder, machines.id);

  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.status, "active"));

  const byMachine = new Map<number, (typeof rows)[number]>();
  for (const row of rows) byMachine.set(row.machineId, row);

  return allMachines.map(m => ({
    machine: { id: m.id, label: m.label, location: m.location, floorId: m.floorId, sortOrder: m.sortOrder },
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
      };
    })(),
  }));
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
    })
    .$returningId();

  return result[0];
}

export async function endSession(input: {
  sessionId: number;
  endedBy: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  await db
    .update(sessions)
    .set({ status: "ended", endedAt: now, endedBy: input.endedBy })
    .where(and(eq(sessions.id, input.sessionId), eq(sessions.status, "active")));
}

export async function toggleUrgent(input: { sessionId: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(sessions)
    .set({ urgent: sql`NOT urgent` })
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
    .$returningId();

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
    .$returningId();

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
  addedBy: string | null;
  joinedAt: Date;
};

/** Every still-waiting patient across all floors (for the cross-board urgent register). */
export async function listWaitingAll(): Promise<WaitingEntryView[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(waitingList)
    .where(eq(waitingList.status, "waiting"))
    .orderBy(desc(waitingList.priority), waitingList.joinedAt, waitingList.id);

  return rows.map(r => ({
    id: r.id,
    patientId: r.patientId,
    floorId: r.floorId,
    priority: r.priority,
    addedBy: r.addedBy,
    joinedAt: r.joinedAt,
  }));
}

export async function listWaiting(input: { floorId: number }): Promise<WaitingEntryView[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(waitingList)
    .where(and(eq(waitingList.floorId, input.floorId), eq(waitingList.status, "waiting")))
    .orderBy(desc(waitingList.priority), waitingList.joinedAt, waitingList.id);

  return rows.map(r => ({
    id: r.id,
    patientId: r.patientId,
    floorId: r.floorId,
    priority: r.priority,
    addedBy: r.addedBy,
    joinedAt: r.joinedAt,
  }));
}

export async function addWaiting(input: {
  floorId: number;
  patientId: string;
  priority: "normal" | "urgent" | "veryUrgent";
  addedBy: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const trimmed = input.patientId.trim();
  if (!trimmed) throw new Error("PATIENT_ID_REQUIRED");
  if (trimmed.length > 64) throw new Error("PATIENT_ID_TOO_LONG");

  const result = await db
    .insert(waitingList)
    .values({
      floorId: input.floorId,
      patientId: trimmed,
      priority: input.priority,
      addedBy: input.addedBy,
    })
    .$returningId();

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
  durationMinutes: number;
  isolationTag: "clean" | "dirty";
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

  const now = new Date();
  const endsAt = new Date(now.getTime() + input.durationMinutes * 60 * 1000);

  // Start the session, then mark the waiting entry admitted
  await db.insert(sessions).values({
    machineId: vacant.id,
    patientId: entry[0].patientId,
    durationMinutes: input.durationMinutes,
    startedAt: now,
    endsAt,
    isolationTag: input.isolationTag,
    urgent: input.urgent || entry[0].priority === "veryUrgent",
    startedBy: input.startedBy,
    displayLabel: input.displayLabel ? input.displayLabel.trim() || null : null,
    assignedNurse: input.assignedNurse ? input.assignedNurse.trim() || null : null,
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
  machineId: number;
  machineLabel: string;
  patientId: string;
  displayLabel: string | null;
  endsAt: Date;
  durationMinutes: number;
  startedAt: Date;
  urgent: boolean;
  isolationTag: "clean" | "dirty";
};

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

  const UNASSIGNED = "Unassigned";
  return rows
    .map(r => ({
      nurse: r.assignedNurse ? r.assignedNurse.trim() || UNASSIGNED : UNASSIGNED,
      machineId: r.machineId,
      machineLabel: labelById.get(r.machineId) ?? `M${r.machineId}`,
      patientId: r.patientId,
      displayLabel: r.displayLabel,
      endsAt: r.endsAt,
      durationMinutes: r.durationMinutes,
      startedAt: r.startedAt,
      urgent: r.urgent,
      isolationTag: r.isolationTag,
    }))
    .sort((a, b) => {
      const nurseOrder = a.nurse === UNASSIGNED ? 1 : b.nurse === UNASSIGNED ? -1 : a.nurse.localeCompare(b.nurse);
      if (nurseOrder !== 0) return nurseOrder;
      return a.endsAt.getTime() - b.endsAt.getTime();
    });
}
