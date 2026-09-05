import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Core user table backing auth flow.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: varchar("role", { length: 16 }).default("user").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn", { mode: "date" }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Physical status of a machine. "active" machines sit on a floor and appear
 * on the occupancy boards; "backup" machines are spare units available for
 * loan to any floor; "repair" machines are out of service for maintenance.
 */
export const machineStatusEnum = pgEnum("machine_status", ["active", "backup", "repair"]);

/**
 * Hemodialysis machines on the unit floor.
 * Each machine row is a persistent physical machine; occupancy is driven by
 * the sessions table (one active session per machine).
 *
 * NOTE: the live MySQL machines table (post merged commit 8f5505f) does not
 * have isolationTag/urgent/displayLabel — those columns were removed by the
 * merge. Keep the drizzle schema in sync with the actual database.
 */
export const machines = pgTable("machines", {
  id: serial("id").primaryKey(),
  /** Display label, e.g. "HD-01". */
  label: varchar("label", { length: 32 }).notNull(),
  /** Physical location within the unit, e.g. "Bay A". */
  location: varchar("location", { length: 64 }).notNull(),
  /** Floor this machine belongs to (NULL for legacy machines). */
  floorId: integer("floorId"),
  /** Physical status: active (on a floor) | backup (spare) | repair (out of service). */
  status: machineStatusEnum("status").notNull().default("active"),
  /** Reason recorded when the machine was moved to backup/repair. */
  statusNote: varchar("statusNote", { length: 256 }),
  /** Sort/display order. */
  sortOrder: integer("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
}, table => [
  // Every floor board and report filters machines by floor and status.
  index("machines_floor_status_idx").on(table.floorId, table.status),
]);

export type Machine = typeof machines.$inferSelect;
export type InsertMachine = typeof machines.$inferInsert;

export type RepairStatus = "pending" | "in_progress" | "resolved";

/**
 * Historical maintenance and repair log per machine.
 * Tracks timestamped breakdown reports, technician interventions, actions taken,
 * replaced parts, and resolution status.
 */
export const machineRepairs = pgTable("machine_repairs", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  reportedAt: timestamp("reportedAt", { mode: "date" }).defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt", { mode: "date" }),
  reportedBy: varchar("reportedBy", { length: 64 }).notNull(),
  technician: varchar("technician", { length: 64 }),
  issue: text("issue").notNull(),
  actionTaken: text("actionTaken"),
  partsReplaced: text("partsReplaced"),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
}, table => [
  index("machine_repairs_machine_status_idx").on(table.machineId, table.status),
  index("machine_repairs_reported_at_idx").on(table.reportedAt),
]);

export type MachineRepair = typeof machineRepairs.$inferSelect;
export type InsertMachineRepair = typeof machineRepairs.$inferInsert;

/**
 * Building floors within the dialysis center. Machines are grouped into
 * floor-based rows on the occupancy board (e.g. Floor 1 · 100 machines,
 * Floor 2 · 36 machines, Floor 3 · 24 machines).
 */
export const floors = pgTable("floors", {
  id: serial("id").primaryKey(),
  /** Floor identifier, e.g. "F1". */
  code: varchar("code", { length: 16 }).notNull().unique(),
  /** Display name, e.g. "Floor 1". */
  name: varchar("name", { length: 64 }).notNull(),
  /** Sort/display order. */
  sortOrder: integer("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export type Floor = typeof floors.$inferSelect;
export type InsertFloor = typeof floors.$inferInsert;

export const sessionIsolationTagEnum = pgEnum("isolation_tag", ["clean", "dirty"]);
export const sessionStatusEnum = pgEnum("session_status", ["active", "ended"]);

/**
 * Active treatment session on a machine. A machine has at most one session
 * with status other than "ended". End time is stored as a UTC timestamp so
 * every connected client can compute an identical countdown.
 */
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  patientId: varchar("patientId", { length: 64 }).notNull(),
  /** Duration in minutes: 180 (3h), 240 (4h), 360 (6h), or 480 (8h). */
  durationMinutes: integer("durationMinutes").notNull(),
  /** UTC epoch ms when the session started. */
  startedAt: timestamp("startedAt", { mode: "date" }).notNull(),
  /** UTC epoch ms = startedAt + durationMinutes (planned end time). */
  endsAt: timestamp("endsAt", { mode: "date" }).notNull(),
  /** Isolation tag derived from patient diagnosis. */
  isolationTag: sessionIsolationTagEnum("isolationTag").notNull().default("clean"),
  /** Urgent/priority flag for critical cases. */
  urgent: boolean("urgent").notNull().default(false),
  /** Optional staff-set display alias shown on the machine tile instead of the patient id. */
  displayLabel: varchar("displayLabel", { length: 64 }),
  /** Nurse assigned to this patient during the session, shown in the floor's nurse roster. */
  assignedNurse: varchar("assignedNurse", { length: 64 }),
  /** When true, ending this session automatically parks the machine in repair storage. */
  needsRepairAfterSession: boolean("needsRepairAfterSession").notNull().default(false),
  /** UTC timestamp when the session was paused (NULL means not currently paused). */
  pausedAt: timestamp("pausedAt", { mode: "date" }),
  /** Cumulative seconds paused during the session; the effective end time is endsAt + pausedSeconds. */
  pausedSeconds: integer("pausedSeconds").notNull().default(0),
  status: sessionStatusEnum("status").notNull().default("active"),
  endedAt: timestamp("endedAt", { mode: "date" }),
  endedBy: text("endedBy"),
  startedBy: text("startedBy"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
}, table => [
  // Partial indexes: only a few dozen rows are ever "active", while the table
  // grows without bound, so these stay small no matter how much history piles up.
  index("sessions_active_machine_idx")
    .on(table.machineId)
    .where(sql`status = 'active'`),
  index("sessions_active_started_idx")
    .on(table.startedAt)
    .where(sql`status = 'active'`),
  // End of Day and End of Month scan completed sessions by end time.
  index("sessions_ended_at_idx")
    .on(table.endedAt)
    .where(sql`status = 'ended'`),
]);

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;

export const waitingPriorityEnum = pgEnum("waiting_priority", ["normal", "urgent", "veryUrgent"]);
export const waitingIsolationTagEnum = pgEnum("waiting_isolation_tag", ["clean", "dirty"]);
export const waitingStatusEnum = pgEnum("waiting_status", ["waiting", "admitted"]);

/**
 * Patient waiting list per floor. Patients queue for a machine on a given
 * floor; very-urgent patients are sorted to the top of the list and shown
 * with a distinct high-priority marker on the board.
 */
export const waitingList = pgTable("waiting_list", {
  id: serial("id").primaryKey(),
  /** Patient identifier entered by staff, e.g. "P-4821". */
  patientId: varchar("patientId", { length: 64 }).notNull(),
  /** Floor this patient is waiting for a machine on. */
  floorId: integer("floorId").notNull(),
  /** Waiting priority tier. */
  priority: waitingPriorityEnum("priority").notNull().default("normal"),
  /** Planned treatment length, captured when the patient joins the queue. */
  durationMinutes: integer("durationMinutes").notNull().default(240),
  /** Isolation tag from the patient's diagnosis, captured on the queue. */
  isolationTag: waitingIsolationTagEnum("isolationTag").notNull().default("clean"),
  /** Nurse who will handle this patient; shown in the floor's nurse roster. */
  assignedNurse: varchar("assignedNurse", { length: 64 }),
  addedBy: text("addedBy"),
  joinedAt: timestamp("joinedAt", { mode: "date" }).defaultNow().notNull(),
  /** When the patient was admitted onto a machine (leaves the list). */
  admittedAt: timestamp("admittedAt", { mode: "date" }),
  status: waitingStatusEnum("status").notNull().default("waiting"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, table => [
  // The queue is always read as "still waiting, on this floor".
  index("waiting_list_status_floor_idx").on(table.status, table.floorId),
]);

export type WaitingEntry = typeof waitingList.$inferSelect;
export type InsertWaitingEntry = typeof waitingList.$inferInsert;

/**
 * Staff accounts for role-based access on the board:
 *  - role "nurse": RDU nurse assigned to a single board (assignedFloorId)
 *  - role "supervisor": SKTI Supervisor with access to all boards
 * Guest users browse without a staff account (no session cookie).
 * Local auth is independent of the Manus OAuth user table.
 */
export const staffRoleEnum = pgEnum("staff_role", ["nurse", "supervisor", "guest", "auditor"]);

export const staffAccounts = pgTable("staff_accounts", {
  id: serial("id").primaryKey(),
  /** Login username, unique. */
  username: varchar("username", { length: 64 }).notNull().unique(),
  displayName: varchar("displayName", { length: 64 }).notNull(),
  role: staffRoleEnum("role").notNull(),
  /** Board this nurse works on (NULL for supervisors and guests). */
  assignedFloorId: integer("assignedFloorId"),
  /** Hex-encoded SHA-256(password + salt) + salt stored alongside. */
  passwordHash: varchar("passwordHash", { length: 128 }).notNull(),
  passwordSalt: varchar("passwordSalt", { length: 32 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn", { mode: "date" }),
  tokenVersion: integer("tokenVersion").default(1).notNull(),
});

export type StaffAccount = typeof staffAccounts.$inferSelect;
export type InsertStaffAccount = typeof staffAccounts.$inferInsert;

/**
 * Charge-nurse narrative entries per board. One board has a fixed set of
 * reporting periods per day (four sessions plus three hooking/terminating
 * transitions); nurses write a narrative per period they cover, optionally
 * tagged with the shift on duty. The end-of-day report pulls these in.
 */
export const narrativeReports = pgTable("narrative_reports", {
  id: serial("id").primaryKey(),
  /** Floor this narrative belongs to. */
  floorId: integer("floorId").notNull(),
  /** Calendar date of the narrative, stored as a date string "YYYY-MM-DD". */
  reportDate: varchar("reportDate", { length: 10 }).notNull(),
  /** Period key: session1, session2, session3, session4, transition1, transition2, transition3. */
  periodKey: varchar("periodKey", { length: 16 }).notNull(),
  /** Optional shift key of the reporting nurse, e.g. "05-13" or "07-15". */
  shiftKey: varchar("shiftKey", { length: 16 }),
  /** Staff member who wrote the narrative. */
  author: text("author").notNull(),
  /** Free-text narrative for this period. */
  body: text("body").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
}, table => [
  index("narrative_reports_floor_date_idx").on(table.floorId, table.reportDate),
]);

export type NarrativeReport = typeof narrativeReports.$inferSelect;
export type InsertNarrativeReport = typeof narrativeReports.$inferInsert;

/**
 * Audit trail for narrative changes. Every create, update, and delete on
 * narrative_reports appends a row here with the actor and a body snapshot.
 * Readable only by the auditor account (dedicated Audit Viewer login).
 */
export const narrativeHistory = pgTable("narrative_history", {
  id: serial("id").primaryKey(),
  narrativeId: integer("narrative_id"),
  floorId: integer("floor_id").notNull(),
  reportDate: varchar("report_date", { length: 10 }).notNull(),
  periodKey: varchar("period_key", { length: 16 }).notNull(),
  /** "create", "update", or "delete". */
  action: varchar("action", { length: 10 }).notNull(),
  actor: varchar("actor", { length: 64 }).notNull(),
  actorRole: varchar("actor_role", { length: 32 }),
  /** Snapshot of the narrative body (null for deletes). */
  bodySnapshot: text("body_snapshot"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
}, table => [
  index("narrative_history_floor_date_idx").on(table.floorId, table.reportDate),
]);

export type NarrativeHistory = typeof narrativeHistory.$inferSelect;
export type InsertNarrativeHistory = typeof narrativeHistory.$inferInsert;

/**
 * Shift handover endorsements between outgoing and incoming charge nurses.
 */
export const shiftEndorsements = pgTable("shift_endorsements", {
  id: serial("id").primaryKey(),
  shift: varchar("shift", { length: 32 }).notNull(),
  floorId: integer("floorId").notNull(),
  date: varchar("date", { length: 16 }).notNull(),
  incomingNurse: varchar("incomingNurse", { length: 64 }).notNull(),
  outgoingNurse: varchar("outgoingNurse", { length: 64 }).notNull(),
  patientNotes: text("patientNotes"),
  accessIssues: text("accessIssues"),
  equipmentNotes: text("equipmentNotes"),
  floorName: varchar("floorName", { length: 64 }),
  // SBAR handover narrative.
  situation: text("situation"),
  background: text("background"),
  assessment: text("assessment"),
  recommendations: text("recommendations"),
  // JSON payloads: the census snapshot, the safety checklist, and the
  // special-watch patient list. They are read and written whole, never queried
  // field by field, so a column per key would buy nothing.
  censusJson: text("censusJson"),
  checklistJson: text("checklistJson"),
  specialWatchJson: text("specialWatchJson"),
  status: varchar("status", { length: 32 }).notNull().default("DRAFT"),
  endorsedAt: timestamp("endorsedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
}, table => [
  index("shift_endorsements_floor_date_idx").on(table.floorId, table.date),
]);

export type ShiftEndorsement = typeof shiftEndorsements.$inferSelect;
export type InsertShiftEndorsement = typeof shiftEndorsements.$inferInsert;

/**
 * Intra-dialytic complication records tied to treatment sessions.
 */
export const sessionComplications = pgTable("session_complications", {
  id: serial("id").primaryKey(),
  sessionId: integer("sessionId").notNull(),
  complicationType: varchar("complicationType", { length: 64 }).notNull(),
  onsetMinutes: integer("onsetMinutes"),
  intervention: text("intervention"),
  resolved: boolean("resolved").notNull().default(false),
  machineId: integer("machineId"),
  machineLabel: varchar("machineLabel", { length: 32 }),
  floorId: integer("floorId"),
  patientId: varchar("patientId", { length: 64 }),
  patientDisplayAlias: varchar("patientDisplayAlias", { length: 64 }),
  date: varchar("date", { length: 16 }),
  timeOfDay: varchar("timeOfDay", { length: 8 }),
  nurseName: varchar("nurseName", { length: 96 }),
  severity: varchar("severity", { length: 32 }),
  // Vitals at the moment of the event.
  preEventBp: varchar("preEventBp", { length: 16 }),
  eventBp: varchar("eventBp", { length: 16 }),
  heartRate: integer("heartRate"),
  spo2: integer("spo2"),
  bfr: integer("bfr"),
  ufr: integer("ufr"),
  /** Interventions performed, JSON string array. */
  interventionsJson: text("interventionsJson"),
  salineBolusVolumeMl: integer("salineBolusVolumeMl"),
  physicianNotified: varchar("physicianNotified", { length: 96 }),
  outcome: varchar("outcome", { length: 64 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, table => [
  index("session_complications_session_idx").on(table.sessionId),
]);

export type SessionComplication = typeof sessionComplications.$inferSelect;
export type InsertSessionComplication = typeof sessionComplications.$inferInsert;

/**
 * Daily hemodialysis water treatment and reverse osmosis (RO) quality logs.
 */
export const waterQualityLogs = pgTable("water_quality_logs", {
  id: serial("id").primaryKey(),
  date: varchar("date", { length: 16 }).notNull(),
  floorId: integer("floorId").notNull(),
  tdsIn: integer("tdsIn"),
  tdsOut: integer("tdsOut"),
  chlorineLevel: varchar("chlorineLevel", { length: 32 }),
  hardness: varchar("hardness", { length: 32 }),
  waterTemp: varchar("waterTemp", { length: 32 }),
  technician: varchar("technician", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pass"),
  timeOfDay: varchar("timeOfDay", { length: 8 }),
  shift: varchar("shift", { length: 48 }),
  inspectorRole: varchar("inspectorRole", { length: 32 }),
  // RO performance. Fractional by nature (product TDS runs around 3.2 ppm),
  // so these are real, not the integer tdsIn/tdsOut kept above for the
  // pre-existing rows.
  feedTds: real("feedTds"),
  productTds: real("productTds"),
  rejectionRate: real("rejectionRate"),
  productConductivity: real("productConductivity"),
  waterHardnessPpm: real("waterHardnessPpm"),
  loopFeedPressure: real("loopFeedPressure"),
  loopReturnPressure: real("loopReturnPressure"),
  waterTemperatureC: real("waterTemperatureC"),
  // Chlorine and chloramine: the hemolysis barrier.
  totalChlorine: real("totalChlorine"),
  chloramineBreakthrough: boolean("chloramineBreakthrough").notNull().default(false),
  // Disinfection cycle.
  heatDisinfectionCompleted: boolean("heatDisinfectionCompleted").notNull().default(false),
  heatPeakTemp: real("heatPeakTemp"),
  heatHoldMinutes: integer("heatHoldMinutes"),
  chemicalAgentUsed: varchar("chemicalAgentUsed", { length: 48 }),
  residualChemicalTestNegative: boolean("residualChemicalTestNegative").notNull().default(false),
  // Microbial surveillance.
  endotoxinLevel: real("endotoxinLevel"),
  colonyCount: integer("colonyCount"),
  correctiveAction: text("correctiveAction"),
  notes: text("notes"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
}, table => [
  index("water_quality_logs_floor_date_idx").on(table.floorId, table.date),
]);

export type WaterQualityLog = typeof waterQualityLogs.$inferSelect;
export type InsertWaterQualityLog = typeof waterQualityLogs.$inferInsert;

/**
 * Infection control and serology surveillance tracking for dialysis patients.
 */
export const infectionSurveillance = pgTable("infection_surveillance", {
  id: serial("id").primaryKey(),
  patientId: varchar("patientId", { length: 64 }).notNull(),
  hbsagStatus: varchar("hbsagStatus", { length: 32 }).notNull().default("negative"),
  hcvStatus: varchar("hcvStatus", { length: 32 }).notNull().default("negative"),
  hivStatus: varchar("hivStatus", { length: 32 }).notNull().default("negative"),
  mdrStatus: varchar("mdrStatus", { length: 32 }).notNull().default("negative"),
  lastTestedDate: varchar("lastTestedDate", { length: 16 }),
  assignedIsolationRoom: varchar("assignedIsolationRoom", { length: 64 }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
});

export type InfectionSurveillance = typeof infectionSurveillance.$inferSelect;
export type InsertInfectionSurveillance = typeof infectionSurveillance.$inferInsert;

/**
 * Dialysis supply inventory, dialyzers, bloodlines, concentrates, and PPE stock.
 */
export const inventorySupplies = pgTable("inventory_supplies", {
  id: serial("id").primaryKey(),
  itemCode: varchar("itemCode", { length: 64 }).notNull().unique(),
  itemName: varchar("itemName", { length: 128 }).notNull(),
  unit: varchar("unit", { length: 32 }).notNull(),
  currentStock: integer("currentStock").notNull().default(0),
  reorderLevel: integer("reorderLevel").notNull().default(10),
  category: varchar("category", { length: 64 }).notNull().default("general"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
});

export type InventorySupply = typeof inventorySupplies.$inferSelect;
export type InsertInventorySupply = typeof inventorySupplies.$inferInsert;

