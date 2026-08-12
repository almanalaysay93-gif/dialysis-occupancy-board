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
  /** Sort/display order. */
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Machine = typeof machines.$inferSelect;
export type InsertMachine = typeof machines.$inferInsert;

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
  status: mysqlEnum("status", ["active", "ended"]).notNull().default("active"),
  endedAt: timestamp("endedAt"),
  endedBy: text("endedBy"),
  startedBy: text("startedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;
