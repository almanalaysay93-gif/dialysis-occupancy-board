import {
  boolean,
  integer,
  pgEnum,
  pgTable,
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
});

export type Machine = typeof machines.$inferSelect;
export type InsertMachine = typeof machines.$inferInsert;

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
});

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
});

export type WaitingEntry = typeof waitingList.$inferSelect;
export type InsertWaitingEntry = typeof waitingList.$inferInsert;

/**
 * Staff accounts for role-based access on the board:
 *  - role "nurse": RDU nurse assigned to a single board (assignedFloorId)
 *  - role "supervisor": SKTI Supervisor with access to all boards
 * Guest users browse without a staff account (no session cookie).
 * Local auth is independent of the Manus OAuth user table.
 */
export const staffRoleEnum = pgEnum("staff_role", ["nurse", "supervisor", "guest"]);

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
