import { eq } from "drizzle-orm";
import { machines, sessions, waitingList } from "../drizzle/schema";
import { getDb } from "./db";
import { patientTicket } from "./patient-ticket";

/** Resolve live placement, including transfers and admission from the queue. */
export async function findPatientAssignment(ticketOrId: string) {
  const db = await getDb();
  if (!db) return null;
  const [active, waiting] = await Promise.all([
    db.select({ patientId: sessions.patientId, floorId: machines.floorId, label: machines.label })
      .from(sessions).innerJoin(machines, eq(machines.id, sessions.machineId))
      .where(eq(sessions.status, "active")),
    db.select({ patientId: waitingList.patientId, floorId: waitingList.floorId })
      .from(waitingList).where(eq(waitingList.status, "waiting")),
  ]);
  const raw = ticketOrId.trim().toLowerCase();
  const matches = (id: string) => id.toLowerCase() === raw || patientTicket(id).toLowerCase() === raw;
  const activeMatches = active.filter(row => matches(row.patientId));
  const waitingMatches = waiting.filter(row => matches(row.patientId));
  const placements = activeMatches.length ? activeMatches : waitingMatches;
  if (placements.length === 0) return null;
  // If multiple patient IDs match (ticket collision) but they are on different floors, deny access.
  if (new Set(placements.map(row => row.floorId)).size !== 1) return null;
  const placement = placements[0];
  if (placement.floorId === null) return null;
  return {
    ticket: patientTicket(placement.patientId),
    assignedFloorId: placement.floorId,
    activeBay: activeMatches[0]?.label ?? null,
    activeStatus: activeMatches.length ? "in_treatment" as const : "waiting" as const,
  };
}
