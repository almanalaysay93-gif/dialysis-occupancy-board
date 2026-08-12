import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { machines, sessions } from "../drizzle/schema";

export type MachineWithSession = {
  machine: { id: number; label: string; location: string; sortOrder: number };
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
  } | null;
};

export async function listMachines(): Promise<MachineWithSession[]> {
  const db = await getDb();
  if (!db) return [];

  const allMachines = await db.select().from(machines).orderBy(machines.sortOrder, machines.id);

  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.status, "active"));

  const byMachine = new Map<number, (typeof rows)[number]>();
  for (const row of rows) byMachine.set(row.machineId, row);

  return allMachines.map(m => ({
    machine: { id: m.id, label: m.label, location: m.location, sortOrder: m.sortOrder },
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
      };
    })(),
  }));
}

export async function assignSession(input: {
  machineId: number;
  patientId: string;
  durationMinutes: 180 | 360 | 480;
  isolationTag: "clean" | "dirty";
  urgent: boolean;
  startedBy: string;
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
