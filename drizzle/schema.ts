import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Hemodialysis machines on the unit floor.
 * Each machine row is a persistent physical machine; occupancy is driven by
 * the sessions table (one active session per machine).
 */
export const machines = mysqlTable("machines", {
  id: int("id").autoincrement().primaryKey(),
  /** Display label, e.g. "HD-01". */
  label: varchar("label", { length: 32 }).notNull(),
  /** Physical location within the unit, e.g. "Bay A". */
  location: varchar("location", { length: 64 }).notNull(),
  /** Floor this machine belongs to (nullable for legacy/unassigned machines). */
  floorId: int("floorId"),
  /** Sort/display order. */
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Machine = typeof machines.$inferSelect;
export type InsertMachine = typeof machines.$inferInsert;

/**
 * Building floors within the dialysis center. Machines are grouped into
 * floor-based rows on the occupancy board (e.g. Floor 1 · 100 machines,
 * Floor 2 · 36 machines, Floor 3 · 24 machines).
 */
export const floors = mysqlTable("floors", {
  id: int("id").autoincrement().primaryKey(),
  /** Floor identifier, e.g. "F1". */
  code: varchar("code", { length: 16 }).notNull().unique(),
  /** Display name, e.g. "Floor 1". */
  name: varchar("name", { length: 64 }).notNull(),
  /** Sort/display order. */
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Floor = typeof floors.$inferSelect;
export type InsertFloor = typeof floors.$inferInsert;

/**
 * Active treatment session on a machine. A machine has at most one session
 * with status other than "ended". End time is stored as a UTC timestamp so
 * every connected client can compute an identical countdown.
 */
export const sessions = mysqlTable("sessions", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  patientId: varchar("patientId", { length: 64 }).notNull(),
  /** Duration in minutes: 180 (3h), 360 (6h), or 480 (8h). */
  durationMinutes: int("durationMinutes").notNull(),
  /** UTC epoch ms when the session started. */
  startedAt: timestamp("startedAt").notNull(),
  /** UTC epoch ms = startedAt + durationMinutes (planned end time). */
  endsAt: timestamp("endsAt").notNull(),
  /** Isolation tag derived from patient diagnosis. */
  isolationTag: mysqlEnum("isolationTag", ["clean", "dirty"]).notNull().default("clean"),
  /** Urgent/priority flag for critical cases. */
  urgent: boolean("urgent").notNull().default(false),
  /** Optional staff-set display alias shown on the machine tile instead of the patient id. */
  displayLabel: varchar("displayLabel", { length: 64 }),
  /** Nurse assigned to this patient during the session, shown in the floor's nurse roster. */
  assignedNurse: varchar("assignedNurse", { length: 64 }),
  status: mysqlEnum("status", ["active", "ended"]).notNull().default("active"),
  endedAt: timestamp("endedAt"),
  endedBy: text("endedBy"),
  startedBy: text("startedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;

/**
 * Patient waiting list per floor. Patients queue for a machine on a given
 * floor; very-urgent patients are sorted to the top of the list and shown
 * with a distinct high-priority marker on the board.
 */
export const waitingList = mysqlTable("waiting_list", {
  id: int("id").autoincrement().primaryKey(),
  /** Patient identifier entered by staff, e.g. "P-4821". */
  patientId: varchar("patientId", { length: 64 }).notNull(),
  /** Floor this patient is waiting for a machine on. */
  floorId: int("floorId").notNull(),
  /** Waiting priority tier. */
  priority: mysqlEnum("priority", ["normal", "urgent", "veryUrgent"]).notNull().default("normal"),
  addedBy: text("addedBy"),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  /** When the patient was admitted onto a machine (leaves the list). */
  admittedAt: timestamp("admittedAt"),
  status: mysqlEnum("status", ["waiting", "admitted"]).notNull().default("waiting"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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
export const staffAccounts = mysqlTable("staff_accounts", {
  id: int("id").autoincrement().primaryKey(),
  /** Login username, unique. */
  username: varchar("username", { length: 64 }).notNull().unique(),
  displayName: varchar("displayName", { length: 64 }).notNull(),
  role: mysqlEnum("role", ["nurse", "supervisor"]).notNull(),
  /** Board this nurse works on (NULL for supervisors). */
  assignedFloorId: int("assignedFloorId"),
  /** Hex-encoded SHA-256(password + salt) + salt stored alongside. */
  passwordHash: varchar("passwordHash", { length: 128 }).notNull(),
  passwordSalt: varchar("passwordSalt", { length: 32 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn"),
  tokenVersion: int("tokenVersion").default(1).notNull(),
});

export type StaffAccount = typeof staffAccounts.$inferSelect;
export type InsertStaffAccount = typeof staffAccounts.$inferInsert;
