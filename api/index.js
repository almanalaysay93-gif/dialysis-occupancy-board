// server/vercel.ts
import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state) => {
  let decoded;
  try {
    decoded = atob(state);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";

// server/db.ts
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// drizzle/schema.ts
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
  varchar
} from "drizzle-orm/pg-core";
var users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: varchar("role", { length: 16 }).default("user").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn", { mode: "date" }).defaultNow().notNull()
});
var machineStatusEnum = pgEnum("machine_status", ["active", "backup", "repair"]);
var machines = pgTable("machines", {
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
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
}, (table) => [
  // Every floor board and report filters machines by floor and status.
  index("machines_floor_status_idx").on(table.floorId, table.status)
]);
var machineRepairs = pgTable("machine_repairs", {
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
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
}, (table) => [
  index("machine_repairs_machine_status_idx").on(table.machineId, table.status),
  index("machine_repairs_reported_at_idx").on(table.reportedAt)
]);
var floors = pgTable("floors", {
  id: serial("id").primaryKey(),
  /** Floor identifier, e.g. "F1". */
  code: varchar("code", { length: 16 }).notNull().unique(),
  /** Display name, e.g. "Floor 1". */
  name: varchar("name", { length: 64 }).notNull(),
  /** Sort/display order. */
  sortOrder: integer("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull()
});
var sessionIsolationTagEnum = pgEnum("isolation_tag", ["clean", "dirty"]);
var sessionStatusEnum = pgEnum("session_status", ["active", "ended"]);
var sessions = pgTable("sessions", {
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
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
}, (table) => [
  // Partial indexes: only a few dozen rows are ever "active", while the table
  // grows without bound, so these stay small no matter how much history piles up.
  index("sessions_active_machine_idx").on(table.machineId).where(sql`status = 'active'`),
  index("sessions_active_started_idx").on(table.startedAt).where(sql`status = 'active'`),
  // End of Day and End of Month scan completed sessions by end time.
  index("sessions_ended_at_idx").on(table.endedAt).where(sql`status = 'ended'`)
]);
var waitingPriorityEnum = pgEnum("waiting_priority", ["normal", "urgent", "veryUrgent"]);
var waitingIsolationTagEnum = pgEnum("waiting_isolation_tag", ["clean", "dirty"]);
var waitingStatusEnum = pgEnum("waiting_status", ["waiting", "admitted"]);
var waitingList = pgTable("waiting_list", {
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
  /** When a nurse called this patient to the treatment area. NULL until called. */
  calledAt: timestamp("calledAt", { mode: "date" }),
  /** Nurse who made the call. Kept for the supervisor report. */
  calledBy: varchar("calledBy", { length: 64 }),
  /** When the patient was admitted onto a machine (leaves the list). */
  admittedAt: timestamp("admittedAt", { mode: "date" }),
  status: waitingStatusEnum("status").notNull().default("waiting"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull()
}, (table) => [
  // The queue is always read as "still waiting, on this floor".
  index("waiting_list_status_floor_idx").on(table.status, table.floorId)
]);
var staffRoleEnum = pgEnum("staff_role", ["nurse", "supervisor", "guest", "auditor"]);
var staffAccounts = pgTable("staff_accounts", {
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
  tokenVersion: integer("tokenVersion").default(1).notNull()
});
var narrativeReports = pgTable("narrative_reports", {
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
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
}, (table) => [
  index("narrative_reports_floor_date_idx").on(table.floorId, table.reportDate)
]);
var narrativeHistory = pgTable("narrative_history", {
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
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull()
}, (table) => [
  index("narrative_history_floor_date_idx").on(table.floorId, table.reportDate)
]);
var shiftEndorsements = pgTable("shift_endorsements", {
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
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
}, (table) => [
  index("shift_endorsements_floor_date_idx").on(table.floorId, table.date)
]);
var sessionComplications = pgTable("session_complications", {
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
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull()
}, (table) => [
  index("session_complications_session_idx").on(table.sessionId)
]);
var waterQualityLogs = pgTable("water_quality_logs", {
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
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull()
}, (table) => [
  index("water_quality_logs_floor_date_idx").on(table.floorId, table.date)
]);
var infectionSurveillance = pgTable("infection_surveillance", {
  id: serial("id").primaryKey(),
  patientId: varchar("patientId", { length: 64 }).notNull(),
  hbsagStatus: varchar("hbsagStatus", { length: 32 }).notNull().default("negative"),
  hcvStatus: varchar("hcvStatus", { length: 32 }).notNull().default("negative"),
  hivStatus: varchar("hivStatus", { length: 32 }).notNull().default("negative"),
  mdrStatus: varchar("mdrStatus", { length: 32 }).notNull().default("negative"),
  lastTestedDate: varchar("lastTestedDate", { length: 16 }),
  assignedIsolationRoom: varchar("assignedIsolationRoom", { length: 64 }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
});
var inventorySupplies = pgTable("inventory_supplies", {
  id: serial("id").primaryKey(),
  itemCode: varchar("itemCode", { length: 64 }).notNull().unique(),
  itemName: varchar("itemName", { length: 128 }).notNull(),
  unit: varchar("unit", { length: 32 }).notNull(),
  currentStock: integer("currentStock").notNull().default(0),
  reorderLevel: integer("reorderLevel").notNull().default(10),
  category: varchar("category", { length: 64 }).notNull().default("general"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
});

// server/_core/database-url.ts
function decodeStrictBase64(raw) {
  const decoded = Buffer.from(raw, "base64").toString("utf-8");
  const normalize = (s) => s.replace(/\s/g, "").replace(/=+$/, "");
  if (normalize(Buffer.from(decoded, "utf-8").toString("base64")) !== normalize(raw)) {
    return { error: "value is not valid base64 (decoding dropped characters \u2014 the secret is truncated or corrupted)" };
  }
  return { value: decoded };
}
function validatePostgresUri(candidate) {
  const trimmed = candidate.trim();
  if (!trimmed) return "value is empty";
  if (!/^postgres(ql)?:\/\//.test(trimmed)) return "value is not a postgres:// URI";
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "value does not parse as a URI (likely truncated)";
  }
  if (!parsed.hostname) return "URI has no host";
  if (!parsed.username) return "URI has no username";
  if (!parsed.password) return "URI has no password";
  if (parsed.pathname.replace(/^\//, "") === "") return "URI has no database name (likely truncated)";
  return null;
}
function resolveDatabaseUrl(env = process.env) {
  const encoded = env.SUPABASE_DATABASE_URL_B64?.trim();
  const plain = env.DATABASE_URL?.trim();
  let encodedError = null;
  if (encoded) {
    const decoded = decodeStrictBase64(encoded);
    if ("error" in decoded) {
      encodedError = decoded.error;
    } else {
      const invalid = validatePostgresUri(decoded.value);
      if (invalid) encodedError = invalid;
      else return { url: decoded.value.trim(), source: "SUPABASE_DATABASE_URL_B64", warning: null };
    }
  }
  if (plain) {
    const invalid = validatePostgresUri(plain);
    if (invalid) {
      return {
        url: null,
        source: null,
        reason: encodedError ? `SUPABASE_DATABASE_URL_B64 is unusable (${encodedError}) and DATABASE_URL is also invalid (${invalid})` : `DATABASE_URL is invalid: ${invalid}`
      };
    }
    return {
      url: plain,
      source: "DATABASE_URL",
      // Falling back is correct, but silence here is what made a mangled secret
      // look like "no database configured" for the whole deploy.
      warning: encodedError ? `SUPABASE_DATABASE_URL_B64 was ignored: ${encodedError}` : null
    };
  }
  return {
    url: null,
    source: null,
    reason: encodedError ? `SUPABASE_DATABASE_URL_B64 is unusable (${encodedError}) and DATABASE_URL is not set` : "neither SUPABASE_DATABASE_URL_B64 nor DATABASE_URL is set"
  };
}

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  // Must match what the pool actually connects with, or a Supabase-only deploy
  // reads "" here while the app is connected fine.
  databaseUrl: resolveDatabaseUrl().url ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
var _urlDiagnosticLogged = false;
function resolveUrl() {
  const resolved = resolveDatabaseUrl();
  if (!_urlDiagnosticLogged) {
    if (resolved.url === null) console.error(`[Database] No usable connection string: ${resolved.reason}`);
    else if (resolved.warning) console.warn(`[Database] ${resolved.warning}`);
    _urlDiagnosticLogged = resolved.url === null || resolved.warning !== null;
  }
  return resolved.url;
}
var _pool = null;
var POOL_MAX = process.env.VERCEL ? 2 : 8;
function buildPool(url) {
  const pool = new Pool({
    connectionString: url,
    max: POOL_MAX,
    min: 0,
    idleTimeoutMillis: 3e4,
    connectionTimeoutMillis: 8e3,
    keepAlive: true,
    keepAliveInitialDelayMillis: 1e4,
    // Always negotiate TLS. Supabase pooler connections (including those
    // routed through the platform proxy) present a certificate chain that
    // node-postgres does not trust by default, so self-signed intermediates
    // must be accepted to avoid SELF_SIGNED_CERT_IN_CHAIN.
    ssl: url.startsWith("postgresql") || url.startsWith("postgres") ? { rejectUnauthorized: false } : void 0
  });
  pool.on("error", (err) => {
    console.error("[Database] Idle client error, resetting pool:", err);
    void resetPool();
  });
  return pool;
}
async function resetPool() {
  const dying = _pool;
  _pool = null;
  _db = null;
  if (dying) {
    try {
      await dying.end();
    } catch {
    }
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function getDb() {
  const url = resolveUrl();
  if (!url) return null;
  if (_db) return _db;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!_pool) _pool = buildPool(url);
      await _pool.query("SELECT 1");
      _db = drizzle(_pool);
      return _db;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("terminated") && !message.includes("timeout") && !message.includes("unexpectedly")) break;
      await sleep(500 * (attempt + 1));
      await resetPool();
    }
  }
  console.warn("[Database] Failed to connect after retries:", lastError);
  return null;
}
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      openId: user.openId
    };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onConflictDoUpdate({
      target: [users.openId],
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  const host = (req.headers.host ?? "").toLowerCase();
  const isKnownProductionHost = host.endsWith(".manus.space") || host.endsWith(".manus.im");
  const isHttpsSite = isSecureRequest(req) || isKnownProductionHost;
  const secure = isHttpsSite;
  const sameSite = isKnownProductionHost || secure ? "none" : "lax";
  return {
    httpOnly: true,
    path: "/",
    sameSite,
    secure
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/routers.ts
import { TRPCError as TRPCError4 } from "@trpc/server";
import { z as z2 } from "zod";

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";

// server/staffAuth.ts
import { SignJWT as SignJWT2, jwtVerify as jwtVerify2 } from "jose";
import { parse as parseCookieHeader3 } from "cookie";
import { randomBytes, createHash } from "crypto";
import { eq as eq2 } from "drizzle-orm";
var STAFF_COOKIE_NAME = "staff_session_id";
var GUEST_SESSION = {
  accountId: 0,
  username: "guest",
  displayName: "Guest",
  role: "guest",
  assignedFloorId: null
};
function hashPassword(password, salt) {
  return createHash("sha256").update(salt + password).digest("hex");
}
function verifyPassword(password, salt, hash) {
  return hashPassword(password, salt) === hash;
}
function getSessionSecret() {
  const secret = process.env.JWT_SECRET || ENV.cookieSecret || "dialysis-occupancy-board-secure-session-key-fallback";
  return new TextEncoder().encode(secret);
}
async function createStaffSessionToken(staff, options = {}) {
  const issuedAt = Date.now();
  const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
  const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
  const payload = {
    staff: {
      accountId: staff.accountId,
      username: staff.username,
      displayName: staff.displayName,
      role: staff.role,
      assignedFloorId: staff.assignedFloorId
    },
    tokenVersion: options.tokenVersion ?? 1,
    appId: ENV.appId
  };
  return new SignJWT2(payload).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(getSessionSecret());
}
async function verifyStaffSession(cookieValue) {
  if (!cookieValue) return null;
  try {
    const { payload } = await jwtVerify2(cookieValue, getSessionSecret(), {
      algorithms: ["HS256"]
    });
    const rec = payload;
    const staff = rec.staff;
    const tokenVersion = rec.tokenVersion;
    if (!staff || typeof staff.accountId !== "number" || typeof staff.username !== "string" || typeof staff.displayName !== "string" || !["nurse", "supervisor", "guest", "auditor", "patient"].includes(String(staff.role))) {
      return null;
    }
    const isGuestJwt = String(staff.role) === "guest";
    if (isGuestJwt) {
      return {
        accountId: 0,
        username: "guest",
        displayName: "Guest",
        role: "guest",
        assignedFloorId: null
      };
    }
    const isPatientJwt = String(staff.role) === "patient";
    if (isPatientJwt) {
      return {
        accountId: 0,
        username: String(staff.username || "patient"),
        displayName: String(staff.displayName || "Patient"),
        role: "patient",
        assignedFloorId: null
      };
    }
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(staffAccounts).where(eq2(staffAccounts.id, staff.accountId)).limit(1);
    const account = rows[0];
    if (!account || !account.active) return null;
    if (typeof tokenVersion !== "number" || tokenVersion !== account.tokenVersion) {
      return null;
    }
    return {
      accountId: account.id,
      username: account.username,
      displayName: account.displayName,
      role: account.role,
      assignedFloorId: account.assignedFloorId
    };
  } catch {
    return null;
  }
}
async function resolveStaffSession(req) {
  const cookies = parseCookieHeader3(req.headers.cookie ?? "");
  const token = cookies[STAFF_COOKIE_NAME] ?? null;
  const staff = await verifyStaffSession(token);
  if (staff) return { ...staff, fromCookie: true };
  return { ...GUEST_SESSION, fromCookie: token !== null };
}
async function bumpTokenVersion(accountId) {
  const db = await getDb();
  if (!db) return;
  const rows = await db.select({ tokenVersion: staffAccounts.tokenVersion }).from(staffAccounts).where(eq2(staffAccounts.id, accountId)).limit(1);
  const next = (rows[0]?.tokenVersion ?? 0) + 1;
  await db.update(staffAccounts).set({ tokenVersion: next }).where(eq2(staffAccounts.id, accountId));
}
async function setStaffSessionCookieSync(req, res, staff, tokenVersion) {
  const cookieOptions = getSessionCookieOptions(req);
  if (!staff) {
    res.cookie(STAFF_COOKIE_NAME, "", { ...cookieOptions, maxAge: -1 });
    return;
  }
  if (staff.role !== "nurse" && staff.role !== "supervisor" && staff.role !== "guest" && staff.role !== "auditor" && staff.role !== "patient") return;
  const token = await createStaffSessionToken(
    {
      accountId: staff.accountId,
      username: staff.username,
      displayName: staff.displayName,
      role: staff.role,
      assignedFloorId: staff.assignedFloorId
    },
    { tokenVersion }
  );
  res.cookie(STAFF_COOKIE_NAME, token, {
    ...cookieOptions,
    maxAge: ONE_YEAR_MS
  });
}
function staffAccessedFloors(staff) {
  if (staff.role === "supervisor" || staff.role === "auditor") return null;
  if (staff.assignedFloorId) return [staff.assignedFloorId];
  return [];
}

// server/machines.ts
import { and as and2, desc as desc2, eq as eq4, isNull as isNull2, sql as sql3 } from "drizzle-orm";

// server/machine-metrics.ts
import ExcelJS from "exceljs";
import { and, desc, eq as eq3, gte, isNull, lt, lte, or, sql as sql2 } from "drizzle-orm";

// server/patient-ticket.ts
function patientTicket(patientId) {
  if (!patientId) return "TK-0000";
  let hash = 0;
  for (let i = 0; i < patientId.length; i++) {
    hash = (hash << 5) - hash + patientId.charCodeAt(i);
    hash |= 0;
  }
  return `TK-${Math.abs(hash) % 9e3 + 1e3}`;
}

// server/machine-metrics.ts
var MASKED_NAME = "Restricted";
function manilaDate(at) {
  return at.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}
function manilaRangeUtc(startDate, endDate) {
  const from = /* @__PURE__ */ new Date(`${startDate}T00:00:00.000+08:00`);
  const to = new Date((/* @__PURE__ */ new Date(`${endDate}T00:00:00.000+08:00`)).getTime() + 24 * 60 * 60 * 1e3);
  return { from, to };
}
var METRICS_CACHE_TTL_MS = 6e4;
var METRICS_CACHE_MAX_ENTRIES = 128;
var machineMetricsCache = /* @__PURE__ */ new Map();
function cacheReport(key, value) {
  const now = Date.now();
  for (const k of Array.from(machineMetricsCache.keys())) {
    const entry = machineMetricsCache.get(k);
    if (entry && entry.expiresAt <= now) machineMetricsCache.delete(k);
  }
  machineMetricsCache.set(key, { value, expiresAt: now + METRICS_CACHE_TTL_MS });
  while (machineMetricsCache.size > METRICS_CACHE_MAX_ENTRIES) {
    const oldest = Array.from(machineMetricsCache.keys())[0];
    if (oldest === void 0) break;
    machineMetricsCache.delete(oldest);
  }
}
function invalidateMachineMetricsCache(machineId) {
  if (machineId === void 0) {
    machineMetricsCache.clear();
    return;
  }
  for (const key of Array.from(machineMetricsCache.keys())) {
    if (key.includes(`m:${machineId}:`) || key.startsWith("floor:")) {
      machineMetricsCache.delete(key);
    }
  }
}
function isUndefinedTableError(error) {
  const code = error?.code;
  if (code === "42P01") return true;
  const cause = error?.cause;
  return cause?.code === "42P01";
}
async function getMachineMetricsReport(opts, viewer = { canSeePhi: false }) {
  const cacheKey2 = opts.machineId ? `m:${opts.machineId}:${opts.startDate}:${opts.endDate}:${viewer.canSeePhi ? "phi" : "masked"}` : `floor:${opts.floorId ?? "all"}:${opts.startDate}:${opts.endDate}:${viewer.canSeePhi ? "phi" : "masked"}`;
  const cached = machineMetricsCache.get(cacheKey2);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const db = await getDb();
  const { from: startTs, to: endTs } = manilaRangeUtc(opts.startDate, opts.endDate);
  const windowEndTs = new Date(Math.min(endTs.getTime(), Date.now()));
  const availableMinutes = Math.max(0, Math.round((windowEndTs.getTime() - startTs.getTime()) / 6e4));
  if (!db) {
    return {
      startDate: opts.startDate,
      endDate: opts.endDate,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      canSeePhi: viewer.canSeePhi,
      floorId: opts.floorId,
      machines: []
    };
  }
  let machineQuery = db.select().from(machines);
  if (opts.machineId) {
    machineQuery = machineQuery.where(eq3(machines.id, opts.machineId));
  } else if (opts.floorId) {
    machineQuery = machineQuery.where(eq3(machines.floorId, opts.floorId));
  }
  const targetMachines = await machineQuery.orderBy(machines.floorId, machines.sortOrder, machines.id);
  const allFloors = await db.select().from(floors);
  const floorMap = /* @__PURE__ */ new Map();
  for (const f of allFloors) floorMap.set(f.id, f.name);
  if (targetMachines.length === 0) {
    return {
      startDate: opts.startDate,
      endDate: opts.endDate,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      canSeePhi: viewer.canSeePhi,
      floorId: opts.floorId,
      floorName: opts.floorId ? floorMap.get(opts.floorId) : void 0,
      machines: []
    };
  }
  const machineIds = targetMachines.map((m) => m.id);
  const sessionRows = await db.select().from(sessions).where(
    and(
      sql2`${sessions.machineId} IN (${sql2.join(machineIds.map((id) => sql2`${id}`), sql2`, `)})`,
      lt(sessions.startedAt, endTs),
      or(isNull(sessions.endedAt), gte(sessions.endedAt, startTs))
    )
  ).orderBy(sessions.machineId, sessions.startedAt);
  const sessionsByMachine = /* @__PURE__ */ new Map();
  for (const s of sessionRows) {
    const arr = sessionsByMachine.get(s.machineId) ?? [];
    arr.push(s);
    sessionsByMachine.set(s.machineId, arr);
  }
  let repairsRows = [];
  try {
    repairsRows = await db.select().from(machineRepairs).where(
      and(
        sql2`${machineRepairs.machineId} IN (${sql2.join(machineIds.map((id) => sql2`${id}`), sql2`, `)})`,
        gte(machineRepairs.reportedAt, startTs),
        lte(machineRepairs.reportedAt, endTs)
      )
    ).orderBy(desc(machineRepairs.reportedAt));
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
    repairsRows = [];
  }
  const repairsByMachine = /* @__PURE__ */ new Map();
  for (const r of repairsRows) {
    const arr = repairsByMachine.get(r.machineId) ?? [];
    arr.push(r);
    repairsByMachine.set(r.machineId, arr);
  }
  const now = Date.now();
  const machineReports = targetMachines.map((m) => {
    const mSessions = sessionsByMachine.get(m.id) ?? [];
    const mRepairs = repairsByMachine.get(m.id) ?? [];
    let totalTreatmentMs = 0;
    let totalPausedMs = 0;
    let totalIdleMs = 0;
    const formattedSessions = [];
    let previousSessionEnd = null;
    for (const s of mSessions) {
      const sStart = new Date(s.startedAt);
      const sEnd = s.endedAt ? new Date(s.endedAt) : s.status === "active" ? new Date(now) : new Date(s.endsAt);
      const clampedStartMs = Math.max(sStart.getTime(), startTs.getTime());
      const clampedEndMs = Math.min(sEnd.getTime(), windowEndTs.getTime());
      const elapsedMs = Math.max(0, clampedEndMs - clampedStartMs);
      const livePauseMs = s.pausedAt ? Math.max(0, now - new Date(s.pausedAt).getTime()) : 0;
      const recordedPausedMs = Math.max(0, s.pausedSeconds ?? 0) * 1e3 + livePauseMs;
      const pausedMs = Math.min(recordedPausedMs, elapsedMs);
      const actualTreatmentMs = elapsedMs - pausedMs;
      totalTreatmentMs += actualTreatmentMs;
      totalPausedMs += pausedMs;
      const clampedStart = new Date(clampedStartMs);
      const dateStr = manilaDate(clampedStart);
      let idleBeforeMs = 0;
      if (previousSessionEnd && manilaDate(previousSessionEnd) === dateStr) {
        const gap = clampedStartMs - previousSessionEnd.getTime();
        if (gap > 0) {
          idleBeforeMs = gap;
          totalIdleMs += gap;
        }
      }
      previousSessionEnd = new Date(clampedEndMs);
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
        pausedMinutes: Math.round(pausedMs / 6e4),
        actualTreatmentMinutes: Math.round(actualTreatmentMs / 6e4),
        idleBeforeMinutes: Math.round(idleBeforeMs / 6e4),
        patientId: safePatient,
        // The routers gate this report behind clinicalReadProcedure, so a
        // caller normally sees the real names: a supervisor needs them to trace
        // a problem back to the patient and the staff on duty. The mask stays
        // for any non-PHI caller a future route may introduce.
        assignedNurse: viewer.canSeePhi ? s.assignedNurse?.trim() || "Unassigned" : MASKED_NAME,
        operator: viewer.canSeePhi ? s.startedBy?.trim() || "\u2014" : MASKED_NAME,
        isolationTag: s.isolationTag,
        urgent: s.urgent,
        status: s.status
      });
    }
    const formattedRepairs = mRepairs.map((r) => ({
      id: r.id,
      machineId: r.machineId,
      machineLabel: m.label,
      reportedAt: new Date(r.reportedAt),
      resolvedAt: r.resolvedAt ? new Date(r.resolvedAt) : null,
      reportedBy: viewer.canSeePhi ? r.reportedBy : MASKED_NAME,
      technician: viewer.canSeePhi ? r.technician : MASKED_NAME,
      issue: r.issue,
      actionTaken: r.actionTaken,
      partsReplaced: r.partsReplaced,
      status: r.status
    }));
    const totalTreatmentMinutes = Math.round(totalTreatmentMs / 6e4);
    const totalPausedMinutes = Math.round(totalPausedMs / 6e4);
    const totalIdleMinutes = Math.round(totalIdleMs / 6e4);
    const utilizationRate = availableMinutes > 0 ? Math.min(100, Math.round(totalTreatmentMinutes / availableMinutes * 100)) : 0;
    return {
      machineId: m.id,
      label: m.label,
      location: m.location,
      floorId: m.floorId,
      floorName: m.floorId ? floorMap.get(m.floorId) ?? `Floor ${m.floorId}` : "Unassigned",
      status: m.status,
      totalSessions: mSessions.length,
      totalTreatmentMinutes,
      totalPausedMinutes,
      totalIdleMinutes,
      availableMinutes,
      utilizationRate,
      sessions: formattedSessions,
      repairs: formattedRepairs
    };
  });
  const result = {
    startDate: opts.startDate,
    endDate: opts.endDate,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    canSeePhi: viewer.canSeePhi,
    floorId: opts.floorId,
    floorName: opts.floorId ? floorMap.get(opts.floorId) : void 0,
    machines: machineReports
  };
  cacheReport(cacheKey2, result);
  return result;
}
async function logMachineRepair(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const inserted = await db.insert(machineRepairs).values({
    machineId: input.machineId,
    reportedBy: input.reportedBy,
    issue: input.issue.trim(),
    technician: input.technician?.trim() || null,
    actionTaken: input.actionTaken?.trim() || null,
    partsReplaced: input.partsReplaced?.trim() || null,
    status: input.status ?? "pending",
    resolvedAt: input.status === "resolved" ? /* @__PURE__ */ new Date() : null
  }).returning();
  invalidateMachineMetricsCache(input.machineId);
  return inserted[0];
}
async function listMachineRepairs(machineId, viewer = { canSeePhi: false }) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(machineRepairs).where(eq3(machineRepairs.machineId, machineId)).orderBy(desc(machineRepairs.reportedAt));
  if (viewer.canSeePhi) return rows;
  return rows.map((r) => ({ ...r, reportedBy: MASKED_NAME, technician: r.technician ? MASKED_NAME : null }));
}
async function generateMachineMetricsExcel(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dialysis Occupancy Board";
  workbook.created = /* @__PURE__ */ new Date();
  const tableHeaderFill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" }
    // Slate 800
  };
  const whiteBoldText = {
    color: { argb: "FFFFFFFF" },
    bold: true,
    name: "Segoe UI",
    size: 10
  };
  const regularText = {
    name: "Segoe UI",
    size: 9
  };
  const thinBorder = {
    top: { style: "thin", color: { argb: "FFE2E8F0" } },
    bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
    left: { style: "thin", color: { argb: "FFE2E8F0" } },
    right: { style: "thin", color: { argb: "FFE2E8F0" } }
  };
  const summarySheet = workbook.addWorksheet("Machine Overview", {
    views: [{ showGridLines: true }]
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
    { header: "Period Elapsed (Hrs)", key: "periodHours", width: 22 },
    { header: "Utilization (% of Period)", key: "utilization", width: 24 },
    { header: "Total Repairs", key: "repairs", width: 14 }
  ];
  const summaryHeader = summarySheet.getRow(1);
  summaryHeader.height = 26;
  summaryHeader.eachCell((cell) => {
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
      periodHours: Number((m.availableMinutes / 60).toFixed(1)),
      utilization: `${m.utilizationRate}%`,
      repairs: m.repairs.length
    });
    row.height = 20;
    row.eachCell((cell) => {
      cell.font = regularText;
      cell.border = thinBorder;
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
  }
  const sessionsSheet = workbook.addWorksheet("Treatment Sessions", {
    views: [{ showGridLines: true }]
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
    { header: "Status", key: "status", width: 14 }
  ];
  const sessionsHeader = sessionsSheet.getRow(1);
  sessionsHeader.height = 26;
  sessionsHeader.eachCell((cell) => {
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
        status: s.status.toUpperCase()
      });
      row.height = 20;
      row.eachCell((cell) => {
        cell.font = regularText;
        cell.border = thinBorder;
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });
    }
  }
  const repairsSheet = workbook.addWorksheet("Maintenance & Repairs", {
    views: [{ showGridLines: true }]
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
    { header: "Status", key: "status", width: 16 }
  ];
  const repairsHeader = repairsSheet.getRow(1);
  repairsHeader.height = 26;
  repairsHeader.eachCell((cell) => {
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
        technician: r.technician ?? "\u2014",
        issue: r.issue,
        actionTaken: r.actionTaken ?? "\u2014",
        partsReplaced: r.partsReplaced ?? "\u2014",
        resolvedAt: r.resolvedAt ? r.resolvedAt.toLocaleString([], { timeZone: "Asia/Manila" }) : "Unresolved",
        status: r.status.toUpperCase()
      });
      row.height = 20;
      row.eachCell((cell) => {
        cell.font = regularText;
        cell.border = thinBorder;
        cell.alignment = { vertical: "middle", horizontal: "left" };
      });
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// server/machines.ts
var BOARD_CACHE_TTL_MS = 2e3;
var boardCache = /* @__PURE__ */ new Map();
function invalidateBoardCache() {
  boardCache.clear();
  invalidateMachineMetricsCache();
}
async function listMachines(viewer = { canSeePhi: false }) {
  const key = viewer.canSeePhi ? "phi" : "masked";
  const hit = boardCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const db = await getDb();
  if (!db) return [];
  const [allMachines, rows] = await Promise.all([
    db.select().from(machines).orderBy(machines.floorId, machines.sortOrder, machines.id),
    // Floor boards only show machines with status 'active'. Backup/repair
    // machines live on the dedicated Backup & Repair board instead.
    db.select().from(sessions).where(eq4(sessions.status, "active"))
  ]);
  const byMachine = /* @__PURE__ */ new Map();
  for (const row of rows) byMachine.set(row.machineId, row);
  const result = allMachines.map((m) => ({
    machine: { id: m.id, label: m.label, location: m.location, floorId: m.floorId, sortOrder: m.sortOrder, status: m.status, statusNote: m.statusNote },
    session: (() => {
      const s = byMachine.get(m.id);
      if (!s) return null;
      return {
        id: s.id,
        machineId: s.machineId,
        // PHI gate: identifiers and staff names only reach staff sessions.
        patientId: viewer.canSeePhi ? s.patientId : null,
        ticket: patientTicket(s.patientId),
        durationMinutes: s.durationMinutes,
        startedAt: s.startedAt,
        endsAt: s.endsAt,
        isolationTag: s.isolationTag,
        urgent: s.urgent,
        startedBy: viewer.canSeePhi ? s.startedBy : null,
        displayLabel: viewer.canSeePhi ? s.displayLabel : null,
        assignedNurse: viewer.canSeePhi ? s.assignedNurse : null,
        needsRepairAfterSession: s.needsRepairAfterSession,
        pausedAt: s.pausedAt,
        pausedSeconds: s.pausedSeconds
      };
    })()
  })).filter((r) => r.machine.status === "active");
  boardCache.set(key, { value: result, expiresAt: Date.now() + BOARD_CACHE_TTL_MS });
  return result;
}
async function assignSession(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(async (tx) => {
    const conflict = await tx.select({ id: sessions.id }).from(sessions).where(and2(eq4(sessions.machineId, input.machineId), eq4(sessions.status, "active"))).limit(1).for("update");
    if (conflict.length > 0) {
      throw new Error("MACHINE_OCCUPIED");
    }
    const now = /* @__PURE__ */ new Date();
    const endsAt = new Date(now.getTime() + input.durationMinutes * 60 * 1e3);
    const result = await tx.insert(sessions).values({
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
      needsRepairAfterSession: input.needsRepairAfterSession === true
    }).returning({ id: sessions.id });
    return result[0];
  });
}
async function endSession(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = /* @__PURE__ */ new Date();
  const session = await db.select({
    needsRepairAfterSession: sessions.needsRepairAfterSession,
    machineId: sessions.machineId,
    pausedAt: sessions.pausedAt,
    pausedSeconds: sessions.pausedSeconds,
    endsAt: sessions.endsAt
  }).from(sessions).where(eq4(sessions.id, input.sessionId)).limit(1);
  const row = session[0];
  if (row) {
    const elapsedPausedSeconds = row.pausedAt ? Math.round((now.getTime() - row.pausedAt.getTime()) / 1e3) : 0;
    const totalPausedSeconds = row.pausedSeconds + elapsedPausedSeconds;
    const shiftedEndsAt = new Date(row.endsAt.getTime() + elapsedPausedSeconds * 1e3);
    await db.update(sessions).set({
      pausedAt: null,
      pausedSeconds: row.pausedAt ? Math.max(0, totalPausedSeconds) : row.pausedSeconds,
      endsAt: shiftedEndsAt,
      status: "ended",
      endedAt: now,
      endedBy: input.endedBy
    }).where(and2(eq4(sessions.id, input.sessionId), eq4(sessions.status, "active")));
  } else {
    await db.update(sessions).set({ status: "ended", endedAt: now, endedBy: input.endedBy }).where(and2(eq4(sessions.id, input.sessionId), eq4(sessions.status, "active")));
  }
  if (session[0]?.needsRepairAfterSession) {
    await setMachineStatus({ machineId: session[0].machineId, status: "repair" }).catch(() => {
    });
  }
}
async function toggleUrgent(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sessions).set({ urgent: sql3`NOT urgent` }).where(eq4(sessions.id, input.sessionId));
}
async function togglePause(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = /* @__PURE__ */ new Date();
  const rows = await db.select({ pausedAt: sessions.pausedAt, pausedSeconds: sessions.pausedSeconds, endsAt: sessions.endsAt }).from(sessions).where(and2(eq4(sessions.id, input.sessionId), eq4(sessions.status, "active"))).limit(1);
  const row = rows[0];
  if (!row) throw new Error("NO_ACTIVE_SESSION");
  if (input.paused) {
    if (row.pausedAt) return;
    await db.update(sessions).set({ pausedAt: now }).where(eq4(sessions.id, input.sessionId));
  } else {
    if (!row.pausedAt) return;
    const pausedMs = now.getTime() - row.pausedAt.getTime();
    const addedSeconds = Math.round(pausedMs / 1e3);
    const newEndsAt = new Date(row.endsAt.getTime() + addedSeconds * 1e3);
    await db.update(sessions).set({
      pausedAt: null,
      pausedSeconds: Math.max(0, row.pausedSeconds + addedSeconds),
      endsAt: newEndsAt
    }).where(eq4(sessions.id, input.sessionId));
  }
}
async function setRepairFlag(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sessions).set({ needsRepairAfterSession: input.flag }).where(eq4(sessions.id, input.sessionId));
}
async function updateIsolationTag(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sessions).set({ isolationTag: input.isolationTag }).where(eq4(sessions.id, input.sessionId));
}
async function updateDisplayLabel(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const label = input.displayLabel ? input.displayLabel.trim() || null : null;
  if (label !== null && label.length > 64) throw new Error("LABEL_TOO_LONG");
  await db.update(sessions).set({ displayLabel: label }).where(eq4(sessions.id, input.sessionId));
}
async function getSessionFloorId(sessionId) {
  const db = await getDb();
  if (!db) return void 0;
  const rows = await db.select({ machineId: sessions.machineId }).from(sessions).where(eq4(sessions.id, sessionId)).limit(1);
  if (!rows[0]) return void 0;
  const machine = await getMachineById(rows[0].machineId);
  return machine?.floorId ?? null;
}
async function getMachineById(machineId) {
  const db = await getDb();
  if (!db) return void 0;
  const rows = await db.select().from(machines).where(eq4(machines.id, machineId)).limit(1);
  return rows[0];
}
async function listFloors() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(floors).orderBy(floors.sortOrder, floors.id);
}
async function addMachine(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select({ id: machines.id }).from(machines).where(eq4(machines.label, input.label.trim())).limit(1);
  if (existing.length > 0) {
    throw new Error("MACHINE_LABEL_EXISTS");
  }
  const maxOrder = await db.select({ sortOrder: machines.sortOrder }).from(machines).where(input.floorId ? eq4(machines.floorId, input.floorId) : isNull2(machines.floorId)).orderBy(desc2(machines.sortOrder)).limit(1);
  const nextOrder = (maxOrder[0]?.sortOrder ?? 0) + 1;
  const result = await db.insert(machines).values({
    label: input.label.trim(),
    location: input.location.trim() || "\u2014",
    floorId: input.floorId,
    sortOrder: nextOrder
  }).returning({ id: machines.id });
  return result[0];
}
async function updateMachineLabel(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const newLabel = input.label.trim();
  if (!newLabel) throw new Error("LABEL_REQUIRED");
  const existing = await db.select({ id: machines.id }).from(machines).where(and2(eq4(machines.label, newLabel), sql3`${machines.id} <> ${input.machineId}`)).limit(1);
  if (existing.length > 0) {
    throw new Error("MACHINE_LABEL_EXISTS");
  }
  await db.update(machines).set({ label: newLabel }).where(eq4(machines.id, input.machineId));
}
async function listOffboardedMachines() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: machines.id,
    label: machines.label,
    location: machines.location,
    status: machines.status,
    statusNote: machines.statusNote,
    floorId: machines.floorId,
    createdAt: machines.createdAt
  }).from(machines).where(sql3`${machines.status} <> 'active'`).orderBy(machines.status, machines.sortOrder, machines.id);
  return rows;
}
async function setMachineStatus(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const machine = await getMachineById(input.machineId);
  if (!machine) throw new Error("MACHINE_NOT_FOUND");
  const active = await db.select({ id: sessions.id }).from(sessions).where(and2(eq4(sessions.machineId, input.machineId), eq4(sessions.status, "active"))).limit(1);
  if (active.length > 0) {
    throw new Error("MACHINE_IN_TREATMENT");
  }
  if (input.status === "active") {
    if (input.floorId === void 0 || input.floorId === null) {
      throw new Error("FLOOR_REQUIRED");
    }
    const floor = await db.select({ id: floors.id }).from(floors).where(eq4(floors.id, input.floorId)).limit(1);
    if (floor.length === 0) throw new Error("FLOOR_NOT_FOUND");
  }
  const note = input.statusNote?.trim() || null;
  await db.update(machines).set({
    status: input.status,
    statusNote: note,
    floorId: input.status === "active" ? input.floorId : machine.floorId
  }).where(eq4(machines.id, input.machineId));
}
async function swapMachines(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const a = await getMachineById(input.machineAId);
  const b = await getMachineById(input.machineBId);
  if (!a || !b) throw new Error("MACHINE_NOT_FOUND");
  if (a.id === b.id) throw new Error("SAME_MACHINE");
  if (!a.floorId || !b.floorId) throw new Error("FLOOR_REQUIRED");
  if (a.status !== "active" || b.status !== "active") throw new Error("MACHINE_OFFBOARD");
  const active = await db.select({ id: sessions.id }).from(sessions).where(
    and2(sql3`${sessions.machineId} IN (${input.machineAId}, ${input.machineBId})`, eq4(sessions.status, "active"))
  ).limit(1);
  if (active.length > 0) throw new Error("MACHINE_IN_TREATMENT");
  if (a.floorId === b.floorId) {
    await reorderMachines(input.machineAId, input.machineBId);
    return;
  }
  await db.update(machines).set({ floorId: b.floorId }).where(eq4(machines.id, a.id));
  await db.update(machines).set({ floorId: a.floorId }).where(eq4(machines.id, b.id));
}
async function reorderMachines(machineAId, machineBId) {
  const db = await getDb();
  if (!db) return;
  const a = await getMachineById(machineAId);
  const b = await getMachineById(machineBId);
  if (!a || !b || a.floorId !== b.floorId) return;
  await db.update(machines).set({ sortOrder: b.sortOrder }).where(eq4(machines.id, a.id));
  await db.update(machines).set({ sortOrder: a.sortOrder }).where(eq4(machines.id, b.id));
}
var SUPERVISOR_PERIODS = [
  { key: "supShift1", label: "Supervisor Shift \xB7 7:00 AM \u2013 3:00 PM", hours: [7, 15] },
  { key: "supShift2", label: "Supervisor Shift \xB7 3:00 \u2013 11:00 PM", hours: [15, 23] },
  { key: "supShift3", label: "Supervisor Shift \xB7 11:00 PM \u2013 7:00 AM", hours: [23, 7] }
];
var REPORT_PERIODS = [
  { key: "session1", label: "Session 1 (5:00 AM \u2013 10:00 AM)", hours: [5, 10] },
  { key: "transition1", label: "Transition 1 \xB7 Hooking & Terminating (9:00 \u2013 11:00 AM)", hours: [9, 11] },
  { key: "session2", label: "Session 2 (10:00 AM \u2013 2:00 PM)", hours: [10, 14] },
  { key: "transition2", label: "Transition 2 \xB7 Hooking & Terminating (1:00 \u2013 3:00 PM)", hours: [13, 15] },
  { key: "session3", label: "Session 3 (2:00 \u2013 6:00 PM)", hours: [14, 18] },
  { key: "transition3", label: "Transition 3 \xB7 Hooking & Terminating (5:00 \u2013 8:00 PM)", hours: [17, 20] },
  { key: "session4", label: "Session 4 (6:00 \u2013 10:00 PM)", hours: [18, 22] }
];
var REPORT_SHIFTS = [
  { key: "05-13", label: "5:00 AM \u2013 1:00 PM" },
  { key: "13-21", label: "1:00 \u2013 9:00 PM" },
  { key: "21-05", label: "9:00 PM \u2013 5:00 AM" },
  { key: "07-15", label: "7:00 AM \u2013 3:00 PM" },
  { key: "15-23", label: "3:00 \u2013 11:00 PM" },
  { key: "23-07", label: "11:00 PM \u2013 7:00 AM" }
];
var ALL_REPORT_PERIODS = [
  ...REPORT_PERIODS,
  ...SUPERVISOR_PERIODS
];
function periodOverlapsShift(periodKey, shiftKey) {
  const period = ALL_REPORT_PERIODS.find((p) => p.key === periodKey);
  if (!period) return false;
  const shift = REPORT_SHIFTS.find((s) => s.key === shiftKey);
  if (!shift) return true;
  const [pStart, pEnd] = period.hours;
  const sParts = shift.key.split(/[^0-9]+/);
  const [sStart, sEnd] = [Number(sParts[0]), Number(sParts[1])];
  const norm = (start, end) => end > start ? [[start, end]] : [[start, start + 24], [0, end]];
  const pRanges = norm(pStart, pEnd);
  const sRanges = norm(sStart, sEnd);
  const result = pRanges.some(([pa, pb]) => sRanges.some(([sa, sb]) => pa < sb && sa < pb));
  return result;
}
var BOARD_PERIOD_KEYS = new Set(REPORT_PERIODS.map((p) => p.key));
var SUPERVISOR_PERIOD_KEYS = new Set(SUPERVISOR_PERIODS.map((p) => p.key));
async function createNarrative(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const isSupervisorPeriod = SUPERVISOR_PERIOD_KEYS.has(input.periodKey);
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
  const result = await db.insert(narrativeReports).values({
    floorId: input.floorId,
    reportDate: input.reportDate,
    periodKey: input.periodKey,
    shiftKey: input.shiftKey?.trim() || null,
    author: input.author,
    body
  }).returning({ id: narrativeReports.id });
  await db.insert(narrativeHistory).values({
    narrativeId: result[0].id,
    floorId: input.floorId,
    reportDate: input.reportDate,
    periodKey: input.periodKey,
    action: "create",
    actor: input.author,
    actorRole: input.authorRole ?? null,
    bodySnapshot: body
  });
  reportCacheInvalidate(input.reportDate, input.floorId);
  return result[0];
}
async function getNarrativeById(id, floorId) {
  const db = await getDb();
  if (!db) return void 0;
  const rows = await db.select().from(narrativeReports).where(and2(eq4(narrativeReports.id, id), eq4(narrativeReports.floorId, floorId))).limit(1);
  return rows[0];
}
async function updateNarrativeBody(id, body) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(narrativeReports).set({ body }).where(eq4(narrativeReports.id, id));
  const rows = await db.select({ reportDate: narrativeReports.reportDate, floorId: narrativeReports.floorId }).from(narrativeReports).where(eq4(narrativeReports.id, id));
  if (rows[0]) reportCacheInvalidate(rows[0].reportDate, rows[0].floorId);
}
async function listNarratives(input) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(narrativeReports).where(and2(eq4(narrativeReports.floorId, input.floorId), eq4(narrativeReports.reportDate, input.reportDate))).orderBy(narrativeReports.updatedAt);
}
async function deleteNarrative(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(narrativeReports).where(and2(eq4(narrativeReports.id, input.id), eq4(narrativeReports.floorId, input.floorId)));
  await db.delete(narrativeReports).where(and2(eq4(narrativeReports.id, input.id), eq4(narrativeReports.floorId, input.floorId)));
  const row = rows[0];
  if (row) {
    reportCacheInvalidate(row.reportDate, row.floorId);
    await db.insert(narrativeHistory).values({
      narrativeId: row.id,
      floorId: row.floorId,
      reportDate: row.reportDate,
      periodKey: row.periodKey,
      action: "delete",
      actor: input.actor ?? "(unknown)",
      actorRole: input.actorRole ?? null,
      bodySnapshot: row.body
    });
  }
}
async function logNarrativeUpdate(input) {
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
    bodySnapshot: input.body
  });
}
async function listNarrativeHistory(input) {
  const db = await getDb();
  if (!db) return [];
  if (input.floorId !== void 0 && input.reportDate) {
    return db.select().from(narrativeHistory).where(
      and2(eq4(narrativeHistory.floorId, input.floorId), eq4(narrativeHistory.reportDate, input.reportDate))
    ).orderBy(narrativeHistory.createdAt);
  }
  return db.select().from(narrativeHistory).orderBy(narrativeHistory.createdAt);
}
async function machineDayMetrics(input) {
  const db = await getDb();
  const out = {};
  if (!db) return out;
  const dateStart = /* @__PURE__ */ new Date(`${input.date}T00:00:00Z`);
  const dateEnd = /* @__PURE__ */ new Date(`${input.date}T23:59:59Z`);
  const rows = await db.select().from(sessions).where(
    and2(
      eq4(sessions.status, "ended"),
      sql3`${sessions.endedAt} >= ${dateStart}`,
      sql3`${sessions.endedAt} <= ${dateEnd}`
    )
  );
  const activeToday = await db.select().from(sessions).where(
    and2(eq4(sessions.status, "active"), sql3`${sessions.startedAt} >= ${dateStart}`, sql3`${sessions.startedAt} <= ${dateEnd}`)
  );
  const floorMachines = await db.select({ id: machines.id, machineId: machines.id }).from(machines).where(and2(eq4(machines.floorId, input.floorId), eq4(machines.status, "active")));
  const onFloor = new Set(floorMachines.map((m) => m.id));
  const byMachine = /* @__PURE__ */ new Map();
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
      const sStarted = new Date(s.startedAt);
      const sEnded = s.endedAt ? new Date(s.endedAt) : new Date(now);
      const start = Math.max(sStarted.getTime(), dateStart.getTime());
      const end = Math.min(sEnded.getTime(), dateEnd.getTime());
      if (end > start) occupiedMs += end - start;
      pausedMs += Math.max(0, s.pausedSeconds) * 1e3;
    }
    const floorStart = dateStart.getTime();
    const floorEnd = dateEnd.getTime();
    const idleMs = Math.max(0, floorEnd - floorStart - occupiedMs);
    out[String(machineId)] = {
      pausedMinutes: Math.round(pausedMs / 6e4),
      idleMinutes: Math.round(idleMs / 6e4),
      occupiedMinutes: Math.round(occupiedMs / 6e4)
    };
  }
  return out;
}
async function removeMachine(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const active = await db.select({ id: sessions.id }).from(sessions).where(and2(eq4(sessions.machineId, input.machineId), eq4(sessions.status, "active"))).limit(1);
  if (active.length > 0) {
    throw new Error("MACHINE_IN_TREATMENT");
  }
  const machine = await db.select({ status: machines.status }).from(machines).where(eq4(machines.id, input.machineId)).limit(1);
  if (machine.length === 0) throw new Error("MACHINE_NOT_FOUND");
  if (machine[0].status !== "active") {
    throw new Error("MACHINE_OFFBOARD");
  }
  await db.delete(sessions).where(eq4(sessions.machineId, input.machineId));
  await db.delete(machines).where(eq4(machines.id, input.machineId));
}
async function addRoom(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select({ id: floors.id }).from(floors).where(eq4(floors.name, input.name.trim())).limit(1);
  if (existing.length > 0) {
    throw new Error("ROOM_EXISTS");
  }
  const maxOrder = await db.select({ sortOrder: floors.sortOrder }).from(floors).orderBy(desc2(floors.sortOrder)).limit(1);
  const code = `F${(maxOrder[0]?.sortOrder ?? 0) + 1}`;
  const result = await db.insert(floors).values({
    code,
    name: input.name.trim(),
    sortOrder: (maxOrder[0]?.sortOrder ?? 0) + 1
  }).returning({ id: floors.id });
  return result[0];
}
async function renameRoom(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const newName = input.name.trim();
  if (!newName) throw new Error("ROOM_NAME_REQUIRED");
  if (newName.length > 64) throw new Error("ROOM_NAME_TOO_LONG");
  const existing = await db.select({ id: floors.id }).from(floors).where(and2(eq4(floors.name, newName), sql3`${floors.id} <> ${input.roomId}`)).limit(1);
  if (existing.length > 0) {
    throw new Error("ROOM_EXISTS");
  }
  await db.update(floors).set({ name: newName }).where(eq4(floors.id, input.roomId));
}
async function removeRoom(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const active = await db.select({ id: sessions.id }).from(sessions).innerJoin(machines, eq4(machines.id, sessions.machineId)).where(and2(eq4(machines.floorId, input.roomId), eq4(sessions.status, "active"))).limit(1);
  if (active.length > 0) {
    throw new Error("ROOM_HAS_ACTIVE_SESSIONS");
  }
  const machineCount = await db.select({ id: machines.id }).from(machines).where(eq4(machines.floorId, input.roomId)).limit(1);
  if (machineCount.length > 0) {
    throw new Error("ROOM_HAS_MACHINES");
  }
  await db.delete(floors).where(eq4(floors.id, input.roomId));
}
function toWaitingView(r, viewer = { canSeePhi: false }) {
  return {
    id: r.id,
    patientId: viewer.canSeePhi ? r.patientId : null,
    ticket: patientTicket(r.patientId),
    floorId: r.floorId,
    priority: r.priority,
    durationMinutes: r.durationMinutes,
    isolationTag: r.isolationTag,
    assignedNurse: viewer.canSeePhi ? r.assignedNurse : null,
    addedBy: viewer.canSeePhi ? r.addedBy : null,
    joinedAt: r.joinedAt,
    calledAt: r.calledAt ?? null,
    calledBy: viewer.canSeePhi ? r.calledBy ?? null : null
  };
}
var waitingCallSupport = null;
async function waitingCallColumnsReady() {
  const db = await getDb();
  if (!db) return false;
  waitingCallSupport ??= (async () => {
    const probe = sql3`select 1 from information_schema.columns
      where table_name = 'waiting_list' and column_name = 'calledAt' limit 1`;
    if ((await db.execute(probe)).rows.length > 0) return true;
    try {
      await db.execute(sql3`alter table "waiting_list" add column if not exists "calledAt" timestamp`);
      await db.execute(sql3`alter table "waiting_list" add column if not exists "calledBy" varchar(64)`);
      return true;
    } catch {
      return false;
    }
  })();
  return waitingCallSupport;
}
var waitingBaseColumns = {
  id: waitingList.id,
  patientId: waitingList.patientId,
  floorId: waitingList.floorId,
  priority: waitingList.priority,
  durationMinutes: waitingList.durationMinutes,
  isolationTag: waitingList.isolationTag,
  assignedNurse: waitingList.assignedNurse,
  addedBy: waitingList.addedBy,
  joinedAt: waitingList.joinedAt,
  admittedAt: waitingList.admittedAt,
  status: waitingList.status,
  createdAt: waitingList.createdAt
};
var waitingCallColumns = { calledAt: waitingList.calledAt, calledBy: waitingList.calledBy };
async function listWaitingAll(viewer = { canSeePhi: false }) {
  const db = await getDb();
  if (!db) return [];
  const columns = await waitingCallColumnsReady() ? { ...waitingBaseColumns, ...waitingCallColumns } : waitingBaseColumns;
  const rows = await db.select(columns).from(waitingList).where(eq4(waitingList.status, "waiting")).orderBy(desc2(waitingList.priority), waitingList.joinedAt, waitingList.id);
  return rows.map((r) => toWaitingView(r, viewer));
}
async function listWaiting(input, viewer = { canSeePhi: false }) {
  const db = await getDb();
  if (!db) return [];
  const columns = await waitingCallColumnsReady() ? { ...waitingBaseColumns, ...waitingCallColumns } : waitingBaseColumns;
  const rows = await db.select(columns).from(waitingList).where(and2(eq4(waitingList.floorId, input.floorId), eq4(waitingList.status, "waiting"))).orderBy(desc2(waitingList.priority), waitingList.joinedAt, waitingList.id);
  return rows.map((r) => toWaitingView(r, viewer));
}
async function addWaiting(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const trimmed = input.patientId.trim();
  if (!trimmed) throw new Error("PATIENT_ID_REQUIRED");
  if (trimmed.length > 64) throw new Error("PATIENT_ID_TOO_LONG");
  if (input.durationMinutes < 15 || input.durationMinutes > 1440) {
    throw new Error("DURATION_OUT_OF_RANGE");
  }
  const result = await db.insert(waitingList).values({
    floorId: input.floorId,
    patientId: trimmed,
    priority: input.priority,
    durationMinutes: input.durationMinutes,
    isolationTag: input.isolationTag,
    assignedNurse: input.assignedNurse?.trim() || null,
    addedBy: input.addedBy
  }).returning({ id: waitingList.id });
  return result[0];
}
async function removeWaiting(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(waitingList).where(
    and2(eq4(waitingList.id, input.entryId), eq4(waitingList.floorId, input.floorId), eq4(waitingList.status, "waiting"))
  );
}
async function markWaitingUrgent(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(waitingList).set({ priority: input.priority }).where(and2(eq4(waitingList.id, input.entryId), eq4(waitingList.floorId, input.floorId), eq4(waitingList.status, "waiting")));
}
async function setWaitingCall(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!await waitingCallColumnsReady()) throw new Error("WAITING_CALL_UNAVAILABLE");
  await db.update(waitingList).set(
    input.called ? { calledAt: /* @__PURE__ */ new Date(), calledBy: input.calledBy.slice(0, 64) } : { calledAt: null, calledBy: null }
  ).where(
    and2(eq4(waitingList.id, input.entryId), eq4(waitingList.floorId, input.floorId), eq4(waitingList.status, "waiting"))
  );
}
async function countVacantMachines(input) {
  const db = await getDb();
  if (!db) return 0;
  const floorMachines = await db.select({ id: machines.id }).from(machines).where(eq4(machines.floorId, input.floorId));
  const occupiedIds = await db.select({ machineId: sessions.machineId }).from(sessions).where(eq4(sessions.status, "active"));
  const occupied = new Set(occupiedIds.map((o) => o.machineId));
  return floorMachines.filter((m) => !occupied.has(m.id)).length;
}
async function admitWaiting(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const entry = await db.select().from(waitingList).where(and2(eq4(waitingList.id, input.entryId), eq4(waitingList.floorId, input.floorId), eq4(waitingList.status, "waiting"))).limit(1);
  if (entry.length === 0) {
    throw new Error("NO_WAITING_PATIENT");
  }
  const entryRow = entry[0];
  const durationMinutes = input.durationMinutes ?? entryRow.durationMinutes;
  const isolationTag = input.isolationTag ?? entryRow.isolationTag;
  const assignedNurse = input.assignedNurse?.trim() || entryRow.assignedNurse;
  return await db.transaction(async (tx) => {
    const locked = await tx.select({ id: waitingList.id, patientId: waitingList.patientId }).from(waitingList).where(and2(eq4(waitingList.id, input.entryId), eq4(waitingList.status, "waiting"))).limit(1).for("update", { skipLocked: true });
    if (locked.length === 0) {
      throw new Error("NO_WAITING_PATIENT");
    }
    const floorMachines = await tx.select({ id: machines.id, label: machines.label }).from(machines).where(eq4(machines.floorId, input.floorId)).orderBy(machines.sortOrder, machines.id);
    const occupiedIds = await tx.select({ machineId: sessions.machineId }).from(sessions).where(eq4(sessions.status, "active"));
    const occupied = new Set(occupiedIds.map((o) => o.machineId));
    const vacant = floorMachines.find((m) => !occupied.has(m.id));
    if (!vacant) {
      throw new Error("NO_VACANT_MACHINE");
    }
    const now = /* @__PURE__ */ new Date();
    const endsAt = new Date(now.getTime() + durationMinutes * 60 * 1e3);
    const [inserted] = await tx.insert(sessions).values({
      machineId: vacant.id,
      patientId: locked[0].patientId,
      durationMinutes,
      startedAt: now,
      endsAt,
      isolationTag,
      urgent: input.urgent || entryRow.priority === "veryUrgent",
      startedBy: input.startedBy,
      displayLabel: input.displayLabel ? input.displayLabel.trim() || null : null,
      assignedNurse: assignedNurse || null
    }).returning({ id: sessions.id });
    await tx.update(waitingList).set({ status: "admitted", admittedAt: now }).where(eq4(waitingList.id, input.entryId));
    return {
      sessionId: inserted?.id,
      machineId: vacant.id,
      machineLabel: vacant.label,
      patientId: locked[0].patientId,
      ticket: patientTicket(locked[0].patientId)
    };
  });
}
var UNASSIGNED_NURSE = "Unassigned";
async function listNurseAssignments(input) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    sessionId: sessions.id,
    machineId: sessions.machineId,
    patientId: sessions.patientId,
    durationMinutes: sessions.durationMinutes,
    startedAt: sessions.startedAt,
    endsAt: sessions.endsAt,
    urgent: sessions.urgent,
    isolationTag: sessions.isolationTag,
    displayLabel: sessions.displayLabel,
    assignedNurse: sessions.assignedNurse
  }).from(sessions).innerJoin(machines, eq4(sessions.machineId, machines.id)).where(and2(eq4(sessions.status, "active"), eq4(machines.floorId, input.floorId)));
  const machineLabels = await db.select({ id: machines.id, label: machines.label }).from(machines);
  const labelById = /* @__PURE__ */ new Map();
  for (const m of machineLabels) labelById.set(m.id, m.label);
  const waiting = await listWaiting({ floorId: input.floorId }, { canSeePhi: true });
  const sessionRows = rows.map((r) => ({
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
    isolationTag: r.isolationTag
  }));
  const waitingRows = waiting.map((w) => ({
    nurse: w.assignedNurse?.trim() || UNASSIGNED_NURSE,
    kind: "waiting",
    id: w.id,
    machineId: null,
    machineLabel: null,
    patientId: w.patientId ?? patientTicket(""),
    displayLabel: null,
    endsAt: null,
    durationMinutes: w.durationMinutes,
    startedAt: null,
    joinedAt: w.joinedAt,
    urgent: w.priority !== "normal",
    isolationTag: w.isolationTag
  }));
  return [...sessionRows, ...waitingRows].sort((a, b) => {
    const nurseOrder = a.nurse === UNASSIGNED_NURSE ? b.nurse === UNASSIGNED_NURSE ? 0 : 1 : b.nurse === UNASSIGNED_NURSE ? -1 : a.nurse.localeCompare(b.nurse);
    if (nurseOrder !== 0) return nurseOrder;
    if (a.kind !== b.kind) return a.kind === "session" ? -1 : 1;
    if (a.endsAt && b.endsAt) return a.endsAt.getTime() - b.endsAt.getTime();
    if (a.joinedAt && b.joinedAt) return a.joinedAt.getTime() - b.joinedAt.getTime();
    return 0;
  });
}
async function endOfDayReport(opts) {
  const cached = reportCacheGet(
    "eod",
    { date: opts?.date ?? "", floorId: String(opts?.floorId ?? "") }
  );
  if (cached) return cached;
  const db = await getDb();
  if (!db) return baseEmptyReport(opts?.floorId, opts?.date);
  const reportDate = opts?.date ?? manilaToday();
  const range = dayRangeUtc(reportDate);
  const floorName = opts?.floorId ? await floorNameFor(db, opts.floorId) : null;
  const floorMachines = await db.select().from(machines).where(opts?.floorId ? eq4(machines.floorId, opts.floorId) : void 0);
  const totalMachinesOnFloor = floorMachines.length;
  const floorMachineIds = new Set(floorMachines.map((m) => m.id));
  const machineLabels = new Map(floorMachines.map((m) => [m.id, m.label]));
  const rows = await db.select().from(sessions).where(
    and2(
      eq4(sessions.status, "ended"),
      sql3`${sessions.endedAt} >= ${range.from} AND ${sessions.endedAt} < ${range.to}`
    )
  );
  const filtered = floorMachineIds.size > 0 ? rows.filter((r) => floorMachineIds.has(r.machineId)) : rows;
  const urgency = { normal: 0, urgent: 0, veryUrgent: 0 };
  const isolation = { clean: 0, dirty: 0 };
  const patients = /* @__PURE__ */ new Set();
  const usedMachines = /* @__PURE__ */ new Set();
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
  const waitingRows = await db.select().from(waitingList).where(
    opts?.floorId ? and2(
      eq4(waitingList.floorId, opts.floorId),
      sql3`${waitingList.joinedAt} >= ${range.from} AND ${waitingList.joinedAt} < ${range.to}`
    ) : sql3`${waitingList.joinedAt} >= ${range.from} AND ${waitingList.joinedAt} < ${range.to}`
  );
  const waitingAdds = { normal: 0, urgent: 0, veryUrgent: 0, total: waitingRows.length };
  for (const w of waitingRows) {
    if (w.priority === "veryUrgent") waitingAdds.veryUrgent++;
    else if (w.priority === "urgent") waitingAdds.urgent++;
    else waitingAdds.normal++;
  }
  const machineMetrics = opts?.floorId ? await machineDayMetrics({ floorId: opts.floorId, date: reportDate }) : {};
  const metricsWithLabels = {};
  for (const key of Object.keys(machineMetrics)) {
    const id = Number(key);
    metricsWithLabels[machineLabels.get(id) ?? key] = {
      machineLabel: machineLabels.get(id) ?? key,
      ...machineMetrics[key]
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
  const out = {
    reportDate,
    floorName,
    totalMachinesOnFloor,
    sessionsEnded: filtered.length,
    machinesUtilized: { used: usedMachines.size, total: totalMachinesOnFloor },
    patientsCatered: patients.size,
    urgency,
    isolation,
    totalTreatmentHours: Math.round(totalMinutes / 60 * 10) / 10,
    waitingAdds,
    sessions: filtered.map((s) => ({
      patientId: s.patientId,
      machineLabel: machineLabels.get(s.machineId) ?? String(s.machineId),
      durationMinutes: s.durationMinutes,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      urgent: s.urgent,
      isolationTag: s.isolationTag,
      nurse: s.assignedNurse
    })),
    machineMetrics: metricsWithLabels,
    pauseSummary: { totalPausedMinutes, machinesPaused }
  };
  reportCacheSet("eod", { date: opts?.date ?? "", floorId: String(opts?.floorId ?? "") }, out);
  return out;
}
function manilaToday() {
  return (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}
function dayRangeUtc(isoDate) {
  const from = /* @__PURE__ */ new Date(`${isoDate}T00:00:00.000+08:00`);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1e3) };
}
async function floorNameFor(db, floorId) {
  if (!db) return null;
  const rows = await db.select().from(floors).where(eq4(floors.id, floorId)).limit(1);
  return rows[0]?.name ?? null;
}
function baseEmptyReport(floorId, date) {
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
    pauseSummary: { totalPausedMinutes: 0, machinesPaused: 0 }
  };
}
function manilaMonth() {
  return (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit"
  });
}
async function monthReport(opts) {
  const cached = reportCacheGet(
    "eom",
    { floorId: String(opts?.floorId ?? ""), month: opts?.month ?? "" }
  );
  if (cached) return cached;
  const db = await getDb();
  if (!db) return [];
  const month = opts?.month ?? manilaMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("Month must be YYYY-MM.");
  }
  const [year, monthNum] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const dayRanges = Array.from({ length: daysInMonth }, (_, i) => {
    const iso = `${year}-${String(monthNum).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
    return { iso, ...dayRangeUtc(iso) };
  });
  const rangeStart = dayRanges[0].from;
  const rangeEnd = dayRanges[dayRanges.length - 1].to;
  const [floorRows, allMachines, monthSessions, allWaiting, activeRows] = await Promise.all([
    db.select().from(floors).where(opts?.floorId ? eq4(floors.id, opts.floorId) : void 0),
    db.select().from(machines),
    db.execute(sql3`
      SELECT * FROM ${sessions}
      WHERE "status" = 'ended' AND "endedAt" >= ${rangeStart} AND "endedAt" < ${rangeEnd}
    `),
    db.execute(sql3`
      SELECT * FROM ${waitingList}
      WHERE "joinedAt" >= ${rangeStart} AND "joinedAt" < ${rangeEnd}
    `),
    db.execute(sql3`
      SELECT "machineId","startedAt","endedAt","pausedSeconds","status" FROM ${sessions}
      WHERE "status" = 'active' AND "startedAt" >= ${rangeStart} AND "startedAt" < ${rangeEnd}
    `)
  ]);
  const monthEnded = (monthSessions?.rows ?? []).map((r) => r);
  const waitingRows = allWaiting?.rows ?? [];
  const activeSessionRows = (activeRows?.rows ?? []).map((raw) => {
    const r = raw;
    return {
      machineId: Number(r.machineId ?? 0),
      startedAt: r.startedAt instanceof Date ? r.startedAt : new Date(String(r.startedAt ?? 0)),
      endedAt: r.endedAt instanceof Date ? r.endedAt : r.endedAt ? new Date(String(r.endedAt)) : null,
      pausedSeconds: Number(r.pausedSeconds ?? 0)
    };
  });
  const out = [];
  for (const floor of floorRows) {
    const floorMachines = allMachines.filter((m) => m.floorId === floor.id);
    const machineIds = new Set(floorMachines.map((m) => m.id));
    const machineLabels = new Map(floorMachines.map((m) => [m.id, m.label]));
    const sOfFloor = monthEnded.filter((s) => machineIds.has(s.machineId));
    const waiting = waitingRows.filter((w) => w.floorId === floor.id);
    const perDay = /* @__PURE__ */ new Map();
    for (const dr of dayRanges) {
      perDay.set(dr.iso, {
        sessionsEnded: 0,
        patientsCatered: 0,
        machinesUtilized: 0,
        urgency: { normal: 0, urgent: 0, veryUrgent: 0 },
        isolation: { clean: 0, dirty: 0 },
        totalMinutes: 0,
        waitingAdds: 0,
        pausedMinutes: 0,
        sessionKeys: /* @__PURE__ */ new Set(),
        machineKeys: /* @__PURE__ */ new Set()
      });
    }
    const allPatients = /* @__PURE__ */ new Set();
    for (const s of sOfFloor) {
      const d = new Date(s.endedAt);
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
    for (const w of waiting) {
      const iso = w.joinedAt ? new Date(w.joinedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) : null;
      if (iso && perDay.has(iso)) perDay.get(iso).waitingAdds++;
    }
    const onFloor = new Set(floorMachines.map((m) => m.id));
    const floorSessionSpans = [
      ...sOfFloor.map((s) => ({ machineId: s.machineId, startedAt: s.startedAt, endedAt: s.endedAt ?? null, pausedSeconds: s.pausedSeconds })),
      ...activeSessionRows.filter((a) => onFloor.has(a.machineId))
    ];
    let floorStart = null;
    let floorEnd = null;
    const now = Date.now();
    for (const s of floorSessionSpans) {
      if (!(s.startedAt instanceof Date)) s.startedAt = new Date(s.startedAt);
      if (s.endedAt && !(s.endedAt instanceof Date)) s.endedAt = new Date(s.endedAt);
      const start = Math.max(s.startedAt.getTime(), rangeStart.getTime());
      const end = Math.min(s.endedAt ? s.endedAt.getTime() : now, rangeEnd.getTime());
      if (end <= start) continue;
      if (floorStart === null) {
        floorStart = start;
        floorEnd = end;
      } else {
        floorStart = Math.min(floorStart, start);
        floorEnd = Math.max(floorEnd, end);
      }
    }
    const pausedByMachine = /* @__PURE__ */ new Map();
    if (floorStart !== null) {
      for (const s of sOfFloor) {
        const pausedMin = Math.round((s.pausedSeconds ?? 0) * 1e3 / 6e4);
        if (pausedMin > 0) pausedByMachine.set(s.machineId, (pausedByMachine.get(s.machineId) ?? 0) + pausedMin);
      }
    }
    for (const s of sOfFloor) {
      const pausedMin = pausedByMachine.get(s.machineId) ?? 0;
      if (pausedMin > 0) {
        const d = new Date(s.endedAt);
        const iso = d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
        const bucket = perDay.get(iso);
        if (bucket) {
          bucket.pausedMinutes += pausedMin;
          pausedByMachine.set(s.machineId, 0);
        }
      }
    }
    const days = dayRanges.map((dr) => {
      const b = perDay.get(dr.iso);
      b.sessionsEnded = b.sessionKeys.size;
      b.machinesUtilized = b.machineKeys.size;
      b.patientsCatered = b.sessionKeys.size;
      return {
        date: dr.iso,
        sessionsEnded: b.sessionsEnded,
        patientsCatered: b.patientsCatered,
        machinesUtilized: b.machinesUtilized,
        totalMachinesOnFloor: floorMachines.length,
        urgency: { ...b.urgency },
        isolation: { ...b.isolation },
        totalTreatmentHours: Math.round(b.totalMinutes / 60 * 10) / 10,
        waitingAdds: b.waitingAdds,
        totalPausedMinutes: b.pausedMinutes
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
        peakMachinesUtilized: Math.max(...days.map((d) => d.machinesUtilized), 0),
        totalMachinesOnFloor: floorMachines.length,
        patientsCatered: allPatients.size,
        urgency: {
          normal: days.reduce((a, d) => a + d.urgency.normal, 0),
          urgent: days.reduce((a, d) => a + d.urgency.urgent, 0),
          veryUrgent: days.reduce((a, d) => a + d.urgency.veryUrgent, 0)
        },
        isolation: {
          clean: days.reduce((a, d) => a + d.isolation.clean, 0),
          dirty: days.reduce((a, d) => a + d.isolation.dirty, 0)
        },
        totalTreatmentHours: Math.round(days.reduce((a, d) => a + d.totalTreatmentHours, 0) * 10) / 10,
        waitingAdds: { ...waitingPriority, total: waiting.length },
        totalPausedMinutes: totalPaused,
        daysWithActivity: days.filter((d) => d.sessionsEnded > 0).length
      }
    });
  }
  return out;
}
async function endOfDayReportBulk(opts) {
  const reportDate = opts?.date ?? manilaToday();
  const cached = reportCacheGet(
    "eodBulk",
    { date: opts?.date ?? "" }
  );
  if (cached) return cached;
  const db = await getDb();
  if (!db) {
    return {
      reportDate,
      floors: [],
      summaries: {},
      narratives: {}
    };
  }
  const t0 = Date.now();
  const floorList = await db.select().from(floors).orderBy(floors.sortOrder, floors.id);
  const narrativeEntries = await listNarrativesBulk(db, { reportDate });
  const range = dayRangeUtc(reportDate);
  const t1 = Date.now();
  const [allMachines, waitingRows, daySessions] = await Promise.all([
    db.select().from(machines),
    db.select().from(waitingList).where(sql3`${waitingList.joinedAt} >= ${range.from} AND ${waitingList.joinedAt} < ${range.to}`),
    // Both ended and active-today sessions in ONE round trip: the remote
    // Supabase pooler runs in transaction mode with a single connection,
    // so "parallel" queries actually serialize (~1.3s each). One UNION
    // all halves the session round trips.
    db.execute(sql3`
      SELECT "machineId", "patientId", "startedAt", "endedAt", "pausedSeconds", "durationMinutes",
             "assignedNurse", "status", "urgent", "isolationTag"
      FROM ${sessions}
      WHERE ("status" = 'ended' AND "endedAt" >= ${range.from} AND "endedAt" < ${range.to})
         OR ("status" = 'active' AND "startedAt" >= ${range.from} AND "startedAt" <= ${range.to})
    `)
  ]);
  const dayRows = (daySessions?.rows ?? []).map((r) => ({
    ...r,
    startedAt: new Date(r.startedAt),
    endedAt: r.endedAt ? new Date(r.endedAt) : null,
    pausedSeconds: Number(r.pausedSeconds),
    durationMinutes: Number(r.durationMinutes),
    urgent: Boolean(r.urgent)
  }));
  const ended = dayRows.filter((r) => r.status === "ended");
  const activeToday = dayRows.filter((r) => r.status === "active").map((r) => ({
    machineId: r.machineId,
    startedAt: r.startedAt,
    pausedSeconds: r.pausedSeconds,
    endedAt: r.endedAt
  }));
  const byFloor = /* @__PURE__ */ new Map();
  for (const m of allMachines) {
    const arr = byFloor.get(m.floorId ?? 0);
    if (arr) arr.push(m);
    else byFloor.set(m.floorId ?? 0, [m]);
  }
  const summaries = {};
  for (const f of floorList) {
    const floorMachines = byFloor.get(f.id) ?? [];
    const floorMachineIds = new Set(floorMachines.map((m) => m.id));
    const machineLabels = new Map(floorMachines.map((m) => [m.id, m.label]));
    const filtered = ended.filter((r) => floorMachineIds.has(r.machineId));
    const urgency = { normal: 0, urgent: 0, veryUrgent: 0 };
    const isolation = { clean: 0, dirty: 0 };
    const patients = /* @__PURE__ */ new Set();
    const usedMachines = /* @__PURE__ */ new Set();
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
    const floorWaiting = waitingRows.filter((w) => w.floorId === f.id);
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
      machines: floorMachines
    });
    const metricsWithLabels = {};
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
      totalTreatmentHours: Math.round(totalMinutes / 60 * 10) / 10,
      waitingAdds,
      sessions: filtered.map((s) => ({
        patientId: s.patientId ?? String(s.machineId),
        machineLabel: machineLabels.get(s.machineId) ?? String(s.machineId),
        durationMinutes: s.durationMinutes,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        urgent: s.urgent,
        isolationTag: s.isolationTag ?? "clean",
        nurse: s.assignedNurse
      })),
      machineMetrics: metricsWithLabels,
      pauseSummary: { totalPausedMinutes, machinesPaused }
    };
  }
  const narratives = {};
  for (const f of floorList) {
    narratives[String(f.id)] = narrativeEntries.filter((e) => e.floorId === f.id);
  }
  const out = { reportDate, floors: floorList, summaries, narratives };
  reportCacheSet("eodBulk", { date: opts?.date ?? "" }, out);
  reportCacheSet("eom", { floorId: "", month: manilaMonth() }, void 0);
  return out;
}
var reportCache = /* @__PURE__ */ new Map();
var REPORT_CACHE_TTL_MS = 3e4;
var REPORT_CACHE_MAX_ENTRIES = 200;
function cacheKey(prefix, input) {
  return `${prefix}:${Object.keys(input).sort().map((k) => `${k}=${String(input[k] ?? "")}`).join("|")}`;
}
function reportCacheGet(prefix, input) {
  const hit = reportCache.get(cacheKey(prefix, input));
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  if (hit) reportCache.delete(cacheKey(prefix, input));
  return null;
}
function reportCacheSet(prefix, input, value) {
  const now = Date.now();
  for (const [key, entry] of Array.from(reportCache.entries())) {
    if (entry.expiresAt <= now) reportCache.delete(key);
  }
  while (reportCache.size >= REPORT_CACHE_MAX_ENTRIES) {
    const oldest = reportCache.keys().next();
    if (oldest.done) break;
    reportCache.delete(oldest.value);
  }
  reportCache.set(cacheKey(prefix, input), { value, expiresAt: now + REPORT_CACHE_TTL_MS });
}
function reportCacheInvalidate(reportDate, floorId) {
  for (const key of Array.from(reportCache.keys())) {
    if (key.includes(reportDate) && (floorId === void 0 || key.includes(String(floorId)))) {
      reportCache.delete(key);
    }
  }
}
async function listNarrativesBulk(db, opts) {
  if (!db) return [];
  return db.select({
    id: narrativeReports.id,
    floorId: narrativeReports.floorId,
    reportDate: narrativeReports.reportDate,
    periodKey: narrativeReports.periodKey,
    shiftKey: narrativeReports.shiftKey,
    author: narrativeReports.author,
    body: narrativeReports.body,
    createdAt: narrativeReports.createdAt,
    updatedAt: narrativeReports.updatedAt
  }).from(narrativeReports).where(eq4(narrativeReports.reportDate, opts.reportDate)).orderBy(narrativeReports.floorId, narrativeReports.periodKey);
}
function machineDayMetricsInline(input) {
  const { ended, activeToday, machines: machines2 } = input;
  const out = {};
  const dateStart = /* @__PURE__ */ new Date(`${input.date}T00:00:00Z`);
  const dateEnd = /* @__PURE__ */ new Date(`${input.date}T23:59:59Z`);
  const onFloor = new Set(machines2.map((m) => m.id));
  const byMachine = /* @__PURE__ */ new Map();
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
      pausedMs += Math.max(0, s.pausedSeconds) * 1e3;
    }
    const idleMs = Math.max(0, dateEnd.getTime() - dateStart.getTime() - occupiedMs);
    out[String(machineId)] = {
      pausedMinutes: Math.round(pausedMs / 6e4),
      idleMinutes: Math.round(idleMs / 6e4),
      occupiedMinutes: Math.round(occupiedMs / 6e4)
    };
  }
  return out;
}
async function listShiftEndorsements(input) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (input?.floorId !== void 0) conditions.push(eq4(shiftEndorsements.floorId, input.floorId));
  if (input?.date !== void 0) conditions.push(eq4(shiftEndorsements.date, input.date));
  if (conditions.length > 0) {
    return db.select().from(shiftEndorsements).where(and2(...conditions)).orderBy(desc2(shiftEndorsements.createdAt));
  }
  return db.select().from(shiftEndorsements).orderBy(desc2(shiftEndorsements.createdAt));
}
async function getShiftEndorsementById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const rows = await db.select().from(shiftEndorsements).where(eq4(shiftEndorsements.id, id)).limit(1);
  return rows[0];
}
var trimmedOrNull = (v) => v ? v.trim() || null : null;
async function createShiftEndorsement(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const status = input.status?.trim() || "DRAFT";
  const result = await db.insert(shiftEndorsements).values({
    shift: input.shift.trim(),
    floorId: input.floorId,
    date: input.date.trim(),
    incomingNurse: input.incomingNurse.trim(),
    outgoingNurse: input.outgoingNurse.trim(),
    patientNotes: trimmedOrNull(input.patientNotes),
    accessIssues: trimmedOrNull(input.accessIssues),
    equipmentNotes: trimmedOrNull(input.equipmentNotes),
    floorName: trimmedOrNull(input.floorName),
    situation: trimmedOrNull(input.situation),
    background: trimmedOrNull(input.background),
    assessment: trimmedOrNull(input.assessment),
    recommendations: trimmedOrNull(input.recommendations),
    censusJson: input.censusJson ?? null,
    checklistJson: input.checklistJson ?? null,
    specialWatchJson: input.specialWatchJson ?? null,
    status,
    // A locked endorsement records when the handover was signed off. A draft
    // has not been handed over yet, so it carries no timestamp.
    endorsedAt: status === "ENDORSED_AND_LOCKED" ? /* @__PURE__ */ new Date() : null
  }).returning({ id: shiftEndorsements.id });
  return result[0];
}
async function updateShiftEndorsement(id, input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updates = { updatedAt: /* @__PURE__ */ new Date() };
  if (input.shift !== void 0) updates.shift = input.shift.trim();
  if (input.incomingNurse !== void 0) updates.incomingNurse = input.incomingNurse.trim();
  if (input.outgoingNurse !== void 0) updates.outgoingNurse = input.outgoingNurse.trim();
  if (input.patientNotes !== void 0) updates.patientNotes = trimmedOrNull(input.patientNotes);
  if (input.accessIssues !== void 0) updates.accessIssues = trimmedOrNull(input.accessIssues);
  if (input.equipmentNotes !== void 0) updates.equipmentNotes = trimmedOrNull(input.equipmentNotes);
  if (input.floorName !== void 0) updates.floorName = trimmedOrNull(input.floorName);
  if (input.situation !== void 0) updates.situation = trimmedOrNull(input.situation);
  if (input.background !== void 0) updates.background = trimmedOrNull(input.background);
  if (input.assessment !== void 0) updates.assessment = trimmedOrNull(input.assessment);
  if (input.recommendations !== void 0) updates.recommendations = trimmedOrNull(input.recommendations);
  if (input.censusJson !== void 0) updates.censusJson = input.censusJson ?? null;
  if (input.checklistJson !== void 0) updates.checklistJson = input.checklistJson ?? null;
  if (input.specialWatchJson !== void 0) updates.specialWatchJson = input.specialWatchJson ?? null;
  if (input.status !== void 0) {
    updates.status = input.status.trim();
    if (input.status.trim() === "ENDORSED_AND_LOCKED") updates.endorsedAt = /* @__PURE__ */ new Date();
  }
  await db.update(shiftEndorsements).set(updates).where(eq4(shiftEndorsements.id, id));
}
async function deleteShiftEndorsement(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(shiftEndorsements).where(eq4(shiftEndorsements.id, id));
}
function parseInterventions(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}
async function listSessionComplications(input) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (input?.sessionId !== void 0) conditions.push(eq4(sessionComplications.sessionId, input.sessionId));
  if (input?.floorId !== void 0) conditions.push(eq4(sessionComplications.floorId, input.floorId));
  const query = db.select().from(sessionComplications);
  const rows = conditions.length > 0 ? await query.where(and2(...conditions)).orderBy(desc2(sessionComplications.createdAt)) : await query.orderBy(desc2(sessionComplications.createdAt));
  return rows.map((r) => ({ ...r, interventions: parseInterventions(r.interventionsJson) }));
}
async function createSessionComplication(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(sessionComplications).values({
    sessionId: input.sessionId,
    complicationType: input.complicationType.trim(),
    onsetMinutes: input.onsetMinutes ?? null,
    intervention: trimmedOrNull(input.intervention),
    resolved: input.resolved ?? false,
    machineId: input.machineId ?? null,
    machineLabel: trimmedOrNull(input.machineLabel),
    floorId: input.floorId ?? null,
    patientId: trimmedOrNull(input.patientId),
    patientDisplayAlias: trimmedOrNull(input.patientDisplayAlias),
    date: trimmedOrNull(input.date),
    timeOfDay: trimmedOrNull(input.timeOfDay),
    nurseName: trimmedOrNull(input.nurseName),
    severity: trimmedOrNull(input.severity),
    preEventBp: trimmedOrNull(input.preEventBp),
    eventBp: trimmedOrNull(input.eventBp),
    heartRate: input.heartRate ?? null,
    spo2: input.spo2 ?? null,
    bfr: input.bfr ?? null,
    ufr: input.ufr ?? null,
    interventionsJson: input.interventions ? JSON.stringify(input.interventions) : null,
    salineBolusVolumeMl: input.salineBolusVolumeMl ?? null,
    physicianNotified: trimmedOrNull(input.physicianNotified),
    outcome: trimmedOrNull(input.outcome),
    notes: trimmedOrNull(input.notes)
  }).returning({ id: sessionComplications.id });
  return result[0];
}
async function updateSessionComplication(id, input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updates = {};
  if (input.complicationType !== void 0) updates.complicationType = input.complicationType.trim();
  if (input.onsetMinutes !== void 0) updates.onsetMinutes = input.onsetMinutes ?? null;
  if (input.intervention !== void 0) updates.intervention = input.intervention ? input.intervention.trim() || null : null;
  if (input.resolved !== void 0) updates.resolved = input.resolved;
  await db.update(sessionComplications).set(updates).where(eq4(sessionComplications.id, id));
}
async function deleteSessionComplication(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(sessionComplications).where(eq4(sessionComplications.id, id));
}
async function listWaterQualityLogs(input) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (input?.floorId !== void 0) conditions.push(eq4(waterQualityLogs.floorId, input.floorId));
  if (input?.date !== void 0) conditions.push(eq4(waterQualityLogs.date, input.date));
  if (conditions.length > 0) {
    return db.select().from(waterQualityLogs).where(and2(...conditions)).orderBy(desc2(waterQualityLogs.createdAt));
  }
  return db.select().from(waterQualityLogs).orderBy(desc2(waterQualityLogs.createdAt));
}
async function getWaterQualityLogById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const rows = await db.select().from(waterQualityLogs).where(eq4(waterQualityLogs.id, id)).limit(1);
  return rows[0];
}
function computeRejectionRate(feedTds, productTds) {
  if (!feedTds || feedTds <= 0 || productTds === null || productTds === void 0) return null;
  return Number(((1 - productTds / feedTds) * 100).toFixed(1));
}
async function createWaterQualityLog(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(waterQualityLogs).values({
    date: input.date.trim(),
    floorId: input.floorId,
    tdsIn: input.tdsIn ?? null,
    tdsOut: input.tdsOut ?? null,
    chlorineLevel: trimmedOrNull(input.chlorineLevel),
    hardness: trimmedOrNull(input.hardness),
    waterTemp: trimmedOrNull(input.waterTemp),
    technician: input.technician.trim(),
    status: input.status?.trim() || "pass",
    timeOfDay: trimmedOrNull(input.timeOfDay),
    shift: trimmedOrNull(input.shift),
    inspectorRole: trimmedOrNull(input.inspectorRole),
    feedTds: input.feedTds ?? null,
    productTds: input.productTds ?? null,
    rejectionRate: computeRejectionRate(input.feedTds, input.productTds),
    productConductivity: input.productConductivity ?? null,
    waterHardnessPpm: input.waterHardnessPpm ?? null,
    loopFeedPressure: input.loopFeedPressure ?? null,
    loopReturnPressure: input.loopReturnPressure ?? null,
    waterTemperatureC: input.waterTemperatureC ?? null,
    totalChlorine: input.totalChlorine ?? null,
    chloramineBreakthrough: input.chloramineBreakthrough ?? false,
    heatDisinfectionCompleted: input.heatDisinfectionCompleted ?? false,
    heatPeakTemp: input.heatPeakTemp ?? null,
    heatHoldMinutes: input.heatHoldMinutes ?? null,
    chemicalAgentUsed: trimmedOrNull(input.chemicalAgentUsed),
    residualChemicalTestNegative: input.residualChemicalTestNegative ?? false,
    endotoxinLevel: input.endotoxinLevel ?? null,
    colonyCount: input.colonyCount ?? null,
    correctiveAction: trimmedOrNull(input.correctiveAction),
    notes: trimmedOrNull(input.notes)
  }).returning({ id: waterQualityLogs.id });
  return result[0];
}
async function updateWaterQualityLog(id, input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updates = {};
  if (input.tdsIn !== void 0) updates.tdsIn = input.tdsIn ?? null;
  if (input.tdsOut !== void 0) updates.tdsOut = input.tdsOut ?? null;
  if (input.chlorineLevel !== void 0) updates.chlorineLevel = input.chlorineLevel ? input.chlorineLevel.trim() || null : null;
  if (input.hardness !== void 0) updates.hardness = input.hardness ? input.hardness.trim() || null : null;
  if (input.waterTemp !== void 0) updates.waterTemp = input.waterTemp ? input.waterTemp.trim() || null : null;
  if (input.technician !== void 0) updates.technician = input.technician.trim();
  if (input.status !== void 0) updates.status = input.status.trim();
  await db.update(waterQualityLogs).set(updates).where(eq4(waterQualityLogs.id, id));
}
async function deleteWaterQualityLog(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(waterQualityLogs).where(eq4(waterQualityLogs.id, id));
}
async function listInfectionSurveillance(input) {
  const db = await getDb();
  if (!db) return [];
  if (input?.patientId !== void 0) {
    return db.select().from(infectionSurveillance).where(eq4(infectionSurveillance.patientId, input.patientId)).orderBy(desc2(infectionSurveillance.updatedAt));
  }
  return db.select().from(infectionSurveillance).orderBy(desc2(infectionSurveillance.updatedAt));
}
async function getInfectionSurveillanceByPatientId(patientId) {
  const db = await getDb();
  if (!db) return void 0;
  const rows = await db.select().from(infectionSurveillance).where(eq4(infectionSurveillance.patientId, patientId)).limit(1);
  return rows[0];
}
async function upsertInfectionSurveillance(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getInfectionSurveillanceByPatientId(input.patientId);
  if (existing) {
    await db.update(infectionSurveillance).set({
      hbsagStatus: input.hbsagStatus?.trim() || existing.hbsagStatus,
      hcvStatus: input.hcvStatus?.trim() || existing.hcvStatus,
      hivStatus: input.hivStatus?.trim() || existing.hivStatus,
      mdrStatus: input.mdrStatus?.trim() || existing.mdrStatus,
      lastTestedDate: input.lastTestedDate !== void 0 ? input.lastTestedDate ? input.lastTestedDate.trim() || null : null : existing.lastTestedDate,
      assignedIsolationRoom: input.assignedIsolationRoom !== void 0 ? input.assignedIsolationRoom ? input.assignedIsolationRoom.trim() || null : null : existing.assignedIsolationRoom,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq4(infectionSurveillance.id, existing.id));
    return { id: existing.id };
  }
  const result = await db.insert(infectionSurveillance).values({
    patientId: input.patientId.trim(),
    hbsagStatus: input.hbsagStatus?.trim() || "negative",
    hcvStatus: input.hcvStatus?.trim() || "negative",
    hivStatus: input.hivStatus?.trim() || "negative",
    mdrStatus: input.mdrStatus?.trim() || "negative",
    lastTestedDate: input.lastTestedDate ? input.lastTestedDate.trim() || null : null,
    assignedIsolationRoom: input.assignedIsolationRoom ? input.assignedIsolationRoom.trim() || null : null
  }).returning({ id: infectionSurveillance.id });
  return result[0];
}
async function deleteInfectionSurveillance(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(infectionSurveillance).where(eq4(infectionSurveillance.id, id));
}
async function listInventorySupplies(input) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (input?.category) conditions.push(eq4(inventorySupplies.category, input.category));
  if (input?.lowStockOnly) {
    conditions.push(sql3`${inventorySupplies.currentStock} <= ${inventorySupplies.reorderLevel}`);
  }
  if (conditions.length > 0) {
    return db.select().from(inventorySupplies).where(and2(...conditions)).orderBy(inventorySupplies.category, inventorySupplies.itemName);
  }
  return db.select().from(inventorySupplies).orderBy(inventorySupplies.category, inventorySupplies.itemName);
}
async function getInventorySupplyByItemCode(itemCode) {
  const db = await getDb();
  if (!db) return void 0;
  const rows = await db.select().from(inventorySupplies).where(eq4(inventorySupplies.itemCode, itemCode)).limit(1);
  return rows[0];
}
async function addInventorySupply(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getInventorySupplyByItemCode(input.itemCode);
  if (existing) {
    throw new Error("ITEM_CODE_EXISTS");
  }
  const result = await db.insert(inventorySupplies).values({
    itemCode: input.itemCode.trim(),
    itemName: input.itemName.trim(),
    unit: input.unit.trim(),
    currentStock: input.currentStock ?? 0,
    reorderLevel: input.reorderLevel ?? 10,
    category: input.category?.trim() || "general"
  }).returning({ id: inventorySupplies.id });
  return result[0];
}
async function updateInventorySupply(id, input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updates = { updatedAt: /* @__PURE__ */ new Date() };
  if (input.itemName !== void 0) updates.itemName = input.itemName.trim();
  if (input.unit !== void 0) updates.unit = input.unit.trim();
  if (input.currentStock !== void 0) updates.currentStock = input.currentStock;
  if (input.reorderLevel !== void 0) updates.reorderLevel = input.reorderLevel;
  if (input.category !== void 0) updates.category = input.category.trim();
  await db.update(inventorySupplies).set(updates).where(eq4(inventorySupplies.id, id));
}
async function adjustInventoryStock(id, delta) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(inventorySupplies).set({
    currentStock: sql3`GREATEST(0, ${inventorySupplies.currentStock} + ${delta})`,
    updatedAt: /* @__PURE__ */ new Date()
  }).where(eq4(inventorySupplies.id, id));
}
async function deleteInventorySupply(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(inventorySupplies).where(eq4(inventorySupplies.id, id));
}

// server/_core/trpc.ts
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);
var staffReadProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    const staff = await resolveStaffSession(ctx.req);
    const oauthUser = ctx.user;
    if (!staff.fromCookie && !oauthUser) {
      return next({
        ctx: { ...ctx, user: null, staff, isStaff: false }
      });
    }
    if ((staff.role === "guest" || staff.role === "patient") && staff.fromCookie) {
      return next({
        ctx: { ...ctx, user: null, staff, isStaff: false }
      });
    }
    if (oauthUser) {
      return next({
        ctx: { ...ctx, user: oauthUser, staff, isStaff: true }
      });
    }
    if (staff.role === "nurse" || staff.role === "supervisor" || staff.role === "auditor") {
      return next({
        ctx: { ...ctx, user: null, staff, isStaff: true }
      });
    }
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  })
);
var clinicalReadProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    const staff = await resolveStaffSession(ctx.req);
    const oauthUser = ctx.user;
    if (oauthUser) {
      return next({
        ctx: { ...ctx, user: oauthUser, staff, isStaff: true }
      });
    }
    if (staff.fromCookie && (staff.role === "nurse" || staff.role === "supervisor" || staff.role === "auditor")) {
      return next({
        ctx: { ...ctx, user: null, staff, isStaff: true }
      });
    }
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  })
);
var supervisorProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    const staff = await resolveStaffSession(ctx.req);
    const oauthUser = ctx.user;
    if (oauthUser && oauthUser.role === "admin") {
      return next({
        ctx: { ...ctx, user: oauthUser, staff, isStaff: true }
      });
    }
    if (staff.role === "supervisor") {
      return next({
        ctx: { ...ctx, user: oauthUser ?? null, staff, isStaff: true }
      });
    }
    throw new TRPCError2({ code: "FORBIDDEN", message: "This action is reserved for the supervisor." });
  })
);
var invalidateBoardAfterWrite = t.middleware(async (opts) => {
  const result = await opts.next();
  if (opts.type === "mutation") invalidateBoardCache();
  return result;
});
var staffOrAdminProcedure = t.procedure.use(invalidateBoardAfterWrite).use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    const staff = await resolveStaffSession(ctx.req);
    const oauthUser = ctx.user;
    if ((staff.role === "guest" || staff.role === "patient") && staff.fromCookie) {
      throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    if (oauthUser) {
      return next({
        ctx: { ...ctx, user: oauthUser, staff, isStaff: true }
      });
    }
    if (staff.role === "nurse" || staff.role === "supervisor" || staff.role === "auditor") {
      return next({
        ctx: { ...ctx, user: null, staff, isStaff: true }
      });
    }
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/errors.ts
import { TRPCError as TRPCError3 } from "@trpc/server";
function mapBackendError(error) {
  if (error instanceof TRPCError3) throw error;
  const msg = error?.message ?? "";
  switch (msg) {
    case "MACHINE_OCCUPIED":
      throw new TRPCError3({ code: "CONFLICT", message: "This machine already has an active session." });
    case "DURATION_OUT_OF_RANGE":
      throw new TRPCError3({ code: "BAD_REQUEST", message: "Duration must be between 15 minutes and 24 hours." });
    case "NO_WAITING_PATIENT":
      throw new TRPCError3({ code: "CONFLICT", message: "This patient is no longer waiting \u2014 they may already have been admitted." });
    case "NO_VACANT_MACHINE":
      throw new TRPCError3({ code: "CONFLICT", message: "No vacant machine on this board \u2014 end or release a session first." });
    case "INVALID_PERIOD":
      throw new TRPCError3({ code: "BAD_REQUEST", message: "Unknown reporting period." });
    case "EMPTY_BODY":
      throw new TRPCError3({ code: "BAD_REQUEST", message: "The narrative cannot be empty." });
    case "FORBIDDEN_PERIOD":
      throw new TRPCError3({ code: "FORBIDDEN", message: "This period is not part of your reporting scope." });
    case "ROOM_EXISTS":
      throw new TRPCError3({ code: "CONFLICT", message: "A board with this name already exists." });
    case "ROOM_NAME_REQUIRED":
      throw new TRPCError3({ code: "BAD_REQUEST", message: "Board name cannot be empty." });
    case "ROOM_NAME_TOO_LONG":
      throw new TRPCError3({ code: "BAD_REQUEST", message: "Board name is too long (max 64 characters)." });
    case "ROOM_HAS_ACTIVE_SESSIONS":
      throw new TRPCError3({ code: "CONFLICT", message: "Cannot remove a board with machines currently in treatment. End those sessions first." });
    case "ROOM_HAS_MACHINES":
      throw new TRPCError3({ code: "CONFLICT", message: "Cannot remove a board that still has machines. Remove its machines first." });
    case "MACHINE_LABEL_EXISTS":
      throw new TRPCError3({ code: "CONFLICT", message: "A machine with this label already exists on the board." });
    case "LABEL_REQUIRED":
      throw new TRPCError3({ code: "BAD_REQUEST", message: "Machine label cannot be empty." });
    case "MACHINE_NOT_FOUND":
      throw new TRPCError3({ code: "NOT_FOUND", message: "Machine not found." });
    case "MACHINE_IN_TREATMENT":
      throw new TRPCError3({ code: "CONFLICT", message: "Cannot move a machine that is currently in treatment. End the session first." });
    case "MACHINE_OFFBOARD":
      throw new TRPCError3({ code: "CONFLICT", message: "This machine is in Backup or Repair storage. Return it to a board first, then remove it." });
    case "NO_ACTIVE_SESSION":
      throw new TRPCError3({ code: "CONFLICT", message: "This machine has no active session." });
    case "FLOOR_NOT_FOUND":
      throw new TRPCError3({ code: "BAD_REQUEST", message: "The selected board no longer exists." });
    case "FLOOR_REQUIRED":
      throw new TRPCError3({ code: "BAD_REQUEST", message: "Choose the board this machine returns to." });
    case "SAME_MACHINE":
      throw new TRPCError3({ code: "BAD_REQUEST", message: "A machine cannot be swapped with itself." });
    default:
      throw new TRPCError3({
        code: "INTERNAL_SERVER_ERROR",
        message: msg === "Database not available" ? "The database is temporarily unavailable. Please try again in a moment." : "Something went wrong on the server. Please try again."
      });
  }
}

// server/routers.ts
import { eq as eq5 } from "drizzle-orm";
function requireFloorAccess(staff, floorId, oauthUser) {
  if (oauthUser) return;
  if (staff.role === "guest") return;
  const allowed = staffAccessedFloors(staff);
  if (allowed !== null && !allowed.includes(floorId)) {
    throw new TRPCError4({ code: "FORBIDDEN", message: "You do not have access to this board" });
  }
}
var METRICS_MAX_RANGE_DAYS = 92;
var machineMetricsRangeSchema = z2.object({
  machineId: z2.number().int().positive().optional(),
  floorId: z2.number().int().positive().optional(),
  startDate: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD"),
  endDate: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD")
}).refine((v) => v.startDate <= v.endDate, {
  message: "Start date must be on or before the end date",
  path: ["startDate"]
}).refine(
  (v) => (Date.parse(`${v.endDate}T00:00:00Z`) - Date.parse(`${v.startDate}T00:00:00Z`)) / 864e5 < METRICS_MAX_RANGE_DAYS,
  { message: `Date range cannot exceed ${METRICS_MAX_RANGE_DAYS} days`, path: ["endDate"] }
);
async function requireMachineFloorAccess(ctx, machineId) {
  const machine = await getMachineById(machineId);
  if (machine?.floorId) requireFloorAccess(ctx.staff, machine.floorId, ctx.user);
}
async function requireMetricsScope(ctx, input) {
  if (input.machineId !== void 0) {
    await requireMachineFloorAccess(ctx, input.machineId);
    return;
  }
  if (input.floorId !== void 0) {
    requireFloorAccess(ctx.staff, input.floorId, ctx.user);
    return;
  }
  if (ctx.user) return;
  const allowed = staffAccessedFloors(ctx.staff);
  if (allowed !== null) {
    throw new TRPCError4({
      code: "FORBIDDEN",
      message: "Select one of your assigned boards to export metrics"
    });
  }
}
var durationMinutesSchema = z2.union([z2.enum(["180", "240", "360", "480", "custom"]), z2.number().int().min(15).max(1440)]).transform((v) => typeof v === "string" ? v === "custom" ? null : Number(v) : v);
var isolationTagSchema = z2.enum(["clean", "dirty"]);
var waitingPrioritySchema = z2.enum(["normal", "urgent", "veryUrgent"]);
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true
      };
    })
  }),
  machines: router({
    /** All machines with their active session (if any). Auto-polling on the
     *  client provides cross-device real-time sync.
     *
     *  Open to anonymous viewers (kiosk, guest board) but PHI is masked
     *  server-side: only a staff session receives the real patientId and
     *  staff names. Everyone else gets the public ticket code. */
    list: staffReadProcedure.query(
      ({ ctx }) => listMachines({ canSeePhi: ctx.isStaff })
    ),
    /** Rename a machine (staff only). */
    updateLabel: staffOrAdminProcedure.input(
      z2.object({
        machineId: z2.number().int().positive(),
        label: z2.string().trim().min(1, "Machine label is required").max(32)
      })
    ).mutation(async ({ ctx, input }) => {
      try {
        const machine = await getMachineById(input.machineId);
        if (machine?.floorId) requireFloorAccess(ctx.staff, machine.floorId, ctx.user);
        await updateMachineLabel({ machineId: input.machineId, label: input.label });
        return { success: true };
      } catch (error) {
        if (error?.message === "MACHINE_LABEL_EXISTS") {
          throw new TRPCError4({
            code: "CONFLICT",
            message: "A machine with this label already exists on the board."
          });
        }
        if (error?.message === "LABEL_REQUIRED") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "Machine label cannot be empty." });
        }
        mapBackendError(error);
      }
    }),
    /** Floors machines are grouped into on the board. */
    listFloors: publicProcedure.query(() => listFloors()),
    /** Add a new machine to the inventory (staff only). */
    add: staffOrAdminProcedure.input(
      z2.object({
        label: z2.string().trim().min(1, "Machine label is required").max(32),
        floorId: z2.number().int().positive().nullable().default(null),
        location: z2.string().trim().max(64).default("\u2014")
      })
    ).mutation(async ({ ctx, input }) => {
      if (input.floorId !== null) requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      try {
        const result = await addMachine(input);
        return { success: true, machineId: result.id };
      } catch (error) {
        if (error?.message === "MACHINE_LABEL_EXISTS") {
          throw new TRPCError4({
            code: "CONFLICT",
            message: "A machine with this label already exists on the board."
          });
        }
        mapBackendError(error);
      }
    }),
    /** Remove a machine from the inventory (staff only). Vacant machines only. */
    remove: staffOrAdminProcedure.input(z2.object({ machineId: z2.number().int().positive() })).mutation(async ({ ctx, input }) => {
      try {
        const machine = await getMachineById(input.machineId);
        if (machine?.floorId) requireFloorAccess(ctx.staff, machine.floorId, ctx.user);
        await removeMachine({ machineId: input.machineId });
        return { success: true };
      } catch (error) {
        if (error?.message === "MACHINE_IN_TREATMENT") {
          throw new TRPCError4({
            code: "CONFLICT",
            message: "Cannot remove a machine that is currently in treatment. End the session first."
          });
        }
        if (error?.message === "MACHINE_OFFBOARD") {
          throw new TRPCError4({
            code: "CONFLICT",
            message: "This machine is in Backup or Repair storage. Return it to a board first, then remove it."
          });
        }
        if (error?.message === "MACHINE_NOT_FOUND") {
          throw new TRPCError4({ code: "NOT_FOUND", message: "Machine not found." });
        }
        mapBackendError(error);
      }
    }),
    /**
     * Send a floor machine to Backup or Repair (off the floor), or return a
     * backup/repair machine to a floor. Nurses may move machines of their own
     * board only; supervisors and OAuth users may move anything.
     */
    setStatus: staffOrAdminProcedure.input(
      z2.object({
        machineId: z2.number().int().positive(),
        status: z2.enum(["active", "backup", "repair"]),
        /** Required when status === "active": floor to return the machine to. */
        floorId: z2.number().int().positive().nullable().default(null),
        statusNote: z2.string().trim().max(120).nullable().default(null)
      })
    ).mutation(async ({ ctx, input }) => {
      const machine = await getMachineById(input.machineId);
      if (!machine) {
        throw new TRPCError4({ code: "NOT_FOUND", message: "Machine not found." });
      }
      if (input.status !== "active" && machine.floorId) {
        requireFloorAccess(ctx.staff, machine.floorId, ctx.user);
      }
      if (input.status === "active" && input.floorId) {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      }
      try {
        await setMachineStatus({
          machineId: input.machineId,
          status: input.status,
          floorId: input.status === "active" ? input.floorId : void 0,
          statusNote: input.statusNote
        });
        return { success: true };
      } catch (error) {
        const msg = error?.message;
        if (msg === "MACHINE_IN_TREATMENT") {
          throw new TRPCError4({
            code: "CONFLICT",
            message: "Cannot move a machine that is currently in treatment. End the session first."
          });
        }
        if (msg === "FLOOR_NOT_FOUND") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "The selected board no longer exists." });
        }
        if (msg === "MACHINE_NOT_FOUND") {
          throw new TRPCError4({ code: "NOT_FOUND", message: "Machine not found." });
        }
        if (msg === "FLOOR_REQUIRED") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "Choose the board this machine returns to." });
        }
        mapBackendError(error);
      }
    }),
    /**
     * Drag-and-drop swap: exchange two machines between different boards.
     * Both machines must be vacant. Nurses may swap only within their own
     * board (effectively a no-op), so cross-board swaps are supervisor-only.
     */
    swap: staffOrAdminProcedure.input(
      z2.object({
        machineAId: z2.number().int().positive(),
        machineBId: z2.number().int().positive()
      })
    ).mutation(async ({ ctx, input }) => {
      const a = await getMachineById(input.machineAId);
      const b = await getMachineById(input.machineBId);
      if (a?.floorId) requireFloorAccess(ctx.staff, a.floorId, ctx.user);
      if (b?.floorId) requireFloorAccess(ctx.staff, b.floorId, ctx.user);
      try {
        await swapMachines(input);
        return { success: true };
      } catch (error) {
        const msg = error?.message;
        if (msg === "MACHINE_IN_TREATMENT") {
          throw new TRPCError4({
            code: "CONFLICT",
            message: "One of the machines is in treatment. End the session first."
          });
        }
        if (msg === "SAME_FLOOR") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "Both machines are on the same board." });
        }
        if (msg === "SAME_MACHINE") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "A machine cannot be swapped with itself." });
        }
        if (msg === "MACHINE_OFFBOARD") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "Only machines on the floor boards can be swapped." });
        }
        mapBackendError(error);
      }
    }),
    /** Backup & Repair inventory: machines off the floors, with their status. */
    offboarded: router({
      list: publicProcedure.query(() => listOffboardedMachines())
    }),
    /** Aggregated metrics for a machine or floor over a date range. */
    metrics: clinicalReadProcedure.input(machineMetricsRangeSchema).query(async ({ ctx, input }) => {
      await requireMetricsScope(ctx, input);
      return getMachineMetricsReport(input, { canSeePhi: ctx.isStaff });
    }),
    /** Download an Excel (.xlsx) file containing machine overview, sessions, and repairs. */
    exportExcel: clinicalReadProcedure.input(machineMetricsRangeSchema).mutation(async ({ ctx, input }) => {
      await requireMetricsScope(ctx, input);
      const report = await getMachineMetricsReport(input, { canSeePhi: ctx.isStaff });
      const buffer = await generateMachineMetricsExcel(report);
      const prefix = input.machineId ? `machine-${input.machineId}` : input.floorId ? `floor-${input.floorId}` : "all-machines";
      const filename = `${prefix}-metrics-${input.startDate}-to-${input.endDate}.xlsx`;
      return {
        filename,
        base64: buffer.toString("base64")
      };
    }),
    /** Machine maintenance & repair log. */
    repairs: router({
      list: clinicalReadProcedure.input(z2.object({ machineId: z2.number().int().positive() })).query(async ({ ctx, input }) => {
        await requireMachineFloorAccess(ctx, input.machineId);
        return listMachineRepairs(input.machineId, { canSeePhi: ctx.isStaff });
      }),
      log: staffOrAdminProcedure.input(
        z2.object({
          machineId: z2.number().int().positive(),
          issue: z2.string().trim().min(1, "Issue description is required").max(1e3),
          technician: z2.string().trim().max(64).optional(),
          actionTaken: z2.string().trim().max(1e3).optional(),
          partsReplaced: z2.string().trim().max(500).optional(),
          status: z2.enum(["pending", "in_progress", "resolved"]).default("pending")
        })
      ).mutation(async ({ ctx, input }) => {
        await requireMachineFloorAccess(ctx, input.machineId);
        const reporter = ctx.user?.name || ctx.staff?.displayName || ctx.staff?.username || "Staff";
        return logMachineRepair({
          ...input,
          reportedBy: reporter
        });
      })
    })
  }),
  rooms: router({
    /** All rooms (floors) visible on the board. Public so every staff device sees them. */
    list: publicProcedure.query(() => listFloors()),
    /** Add a new room (supervisor/admin only — global resource, not floor-scoped). */
    add: staffOrAdminProcedure.input(z2.object({ name: z2.string().trim().min(1, "Room name is required").max(64) })).mutation(async ({ ctx, input }) => {
      if (!ctx.user && ctx.staff.role !== "supervisor") {
        throw new TRPCError4({ code: "FORBIDDEN", message: "Only the supervisor may manage rooms." });
      }
      try {
        const result = await addRoom(input);
        return { success: true, roomId: result.id };
      } catch (error) {
        if (error?.message === "ROOM_EXISTS") {
          throw new TRPCError4({
            code: "CONFLICT",
            message: "A room with this name already exists."
          });
        }
        mapBackendError(error);
      }
    }),
    /** Rename a room (supervisor/admin only — global resource, not floor-scoped). */
    rename: staffOrAdminProcedure.input(z2.object({ roomId: z2.number().int().positive(), name: z2.string().trim().min(1, "Room name is required").max(64) })).mutation(async ({ ctx, input }) => {
      if (!ctx.user && ctx.staff.role !== "supervisor") {
        throw new TRPCError4({ code: "FORBIDDEN", message: "Only the supervisor may manage rooms." });
      }
      try {
        await renameRoom({ roomId: input.roomId, name: input.name });
        return { success: true };
      } catch (error) {
        const msg = error?.message;
        if (msg === "ROOM_EXISTS") {
          throw new TRPCError4({
            code: "CONFLICT",
            message: "A room with this name already exists."
          });
        }
        if (msg === "ROOM_NAME_REQUIRED") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "Room name cannot be empty." });
        }
        if (msg === "ROOM_NAME_TOO_LONG") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "Room name is too long (max 64 characters)." });
        }
        mapBackendError(error);
      }
    }),
    /** Remove a room (supervisor/admin only — global resource, not floor-scoped). */
    remove: staffOrAdminProcedure.input(z2.object({ roomId: z2.number().int().positive() })).mutation(async ({ ctx, input }) => {
      if (!ctx.user && ctx.staff.role !== "supervisor") {
        throw new TRPCError4({ code: "FORBIDDEN", message: "Only the supervisor may manage rooms." });
      }
      try {
        await removeRoom({ roomId: input.roomId });
        return { success: true };
      } catch (error) {
        const msg = error?.message;
        if (msg === "ROOM_HAS_ACTIVE_SESSIONS") {
          throw new TRPCError4({
            code: "CONFLICT",
            message: "Cannot remove a room with machines currently in treatment. End those sessions first."
          });
        }
        if (msg === "ROOM_HAS_MACHINES") {
          throw new TRPCError4({
            code: "CONFLICT",
            message: "Cannot remove a room that still has machines. Remove its machines first."
          });
        }
        mapBackendError(error);
      }
    })
  }),
  sessions: router({
    assign: staffOrAdminProcedure.input(
      z2.object({
        machineId: z2.number().int().positive(),
        patientId: z2.string().trim().min(1, "Patient identifier is required").max(64),
        durationMinutes: durationMinutesSchema,
        customMinutes: z2.number().int().min(15, "Minimum duration is 15 minutes").max(1440, "Maximum duration is 24 hours").nullable().default(null),
        isolationTag: isolationTagSchema,
        urgent: z2.boolean().default(false),
        /** Optional staff-set alias shown on the machine tile instead of the patient id. */
        displayLabel: z2.string().trim().max(64).nullable().default(null),
        /** Nurse responsible for this patient during the session, shown in the floor nurse roster. */
        assignedNurse: z2.string().trim().max(64).nullable().default(null),
        /** When true, ending this session automatically parks the machine in repair storage. */
        needsRepairAfterSession: z2.boolean().default(false)
      }).superRefine((data, ctxx) => {
        if (data.durationMinutes === null && (data.customMinutes === null || data.customMinutes < 15)) {
          ctxx.addIssue({
            code: z2.ZodIssueCode.custom,
            message: "Please enter a custom duration (15 minutes to 24 hours)",
            path: ["customMinutes"]
          });
        }
      })
    ).mutation(async ({ ctx, input }) => {
      try {
        if (ctx.staff && ctx.staff.role === "nurse") {
          const machine = await getMachineById(input.machineId);
          if (machine?.floorId) requireFloorAccess(ctx.staff, machine.floorId, ctx.user);
        }
        const { customMinutes, ...rest } = input;
        const durationMinutes = rest.durationMinutes ?? customMinutes;
        const result = await assignSession({
          ...rest,
          durationMinutes,
          startedBy: ctx.user?.name ?? ctx.user?.email ?? ctx.staff?.displayName ?? "staff"
        });
        return { success: true, sessionId: result.id };
      } catch (error) {
        mapBackendError(error);
      }
    }),
    end: staffOrAdminProcedure.input(z2.object({ sessionId: z2.number().int().positive() })).mutation(async ({ ctx, input }) => {
      if (ctx.staff && ctx.staff.role === "nurse") {
        const floorId = await getSessionFloorId(input.sessionId);
        if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
      }
      try {
        await endSession({
          sessionId: input.sessionId,
          endedBy: ctx.user?.name ?? ctx.user?.email ?? ctx.staff?.displayName ?? "staff"
        });
      } catch (error) {
        mapBackendError(error);
      }
      return { success: true };
    }),
    toggleUrgent: staffOrAdminProcedure.input(z2.object({ sessionId: z2.number().int().positive() })).mutation(async ({ ctx, input }) => {
      if (ctx.staff && ctx.staff.role === "nurse") {
        const floorId = await getSessionFloorId(input.sessionId);
        if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
      }
      try {
        await toggleUrgent({ sessionId: input.sessionId });
      } catch (error) {
        mapBackendError(error);
      }
      return { success: true };
    }),
    /** Flag an active session for repair: ending it parks the machine in repair storage. */
    setRepairFlag: staffOrAdminProcedure.input(
      z2.object({ sessionId: z2.number().int().positive(), flag: z2.boolean() })
    ).mutation(async ({ ctx, input }) => {
      if (ctx.staff && ctx.staff.role === "nurse") {
        const floorId = await getSessionFloorId(input.sessionId);
        if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
      }
      try {
        await setRepairFlag({ sessionId: input.sessionId, flag: input.flag });
      } catch (error) {
        mapBackendError(error);
      }
      return { success: true };
    }),
    /** Pause or resume an active session's countdown (treatment break window). */
    togglePause: staffOrAdminProcedure.input(
      z2.object({ sessionId: z2.number().int().positive(), paused: z2.boolean() })
    ).mutation(async ({ ctx, input }) => {
      if (ctx.staff && ctx.staff.role === "nurse") {
        const floorId = await getSessionFloorId(input.sessionId);
        if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
      }
      try {
        await togglePause({ sessionId: input.sessionId, paused: input.paused });
        return { success: true };
      } catch (error) {
        const msg = error?.message;
        if (msg === "NO_ACTIVE_SESSION") {
          throw new TRPCError4({
            code: "CONFLICT",
            message: "This machine has no active session."
          });
        }
        mapBackendError(error);
      }
    }),
    updateTag: staffOrAdminProcedure.input(
      z2.object({
        sessionId: z2.number().int().positive(),
        isolationTag: isolationTagSchema
      })
    ).mutation(async ({ ctx, input }) => {
      if (ctx.staff && ctx.staff.role === "nurse") {
        const floorId = await getSessionFloorId(input.sessionId);
        if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
      }
      try {
        await updateIsolationTag({
          sessionId: input.sessionId,
          isolationTag: input.isolationTag
        });
      } catch (error) {
        mapBackendError(error);
      }
      return { success: true };
    }),
    updateLabel: staffOrAdminProcedure.input(
      z2.object({
        sessionId: z2.number().int().positive(),
        displayLabel: z2.string().trim().max(64).nullable()
      })
    ).mutation(async ({ ctx, input }) => {
      try {
        if (ctx.staff && ctx.staff.role === "nurse") {
          const floorId = await getSessionFloorId(input.sessionId);
          if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
        }
        await updateDisplayLabel({
          sessionId: input.sessionId,
          displayLabel: input.displayLabel
        });
        return { success: true };
      } catch (error) {
        if (error?.message === "LABEL_TOO_LONG") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "The display label is too long (max 64 characters)." });
        }
        mapBackendError(error);
      }
    })
  }),
  waiting: router({
    /** Waiting patients per floor. Public so every staff device sees the same queue,
     *  but guest viewers never receive clinical queue data. */
    list: staffReadProcedure.input(z2.object({ floorId: z2.number().int().positive() })).query(
      ({ ctx, input }) => (
        // The kiosk shows this queue in a public waiting room, so the rows
        // stay readable but carry only the ticket code unless the caller
        // holds a staff session.
        listWaiting({ floorId: input.floorId }, { canSeePhi: ctx.isStaff })
      )
    ),
    /**
     * Cross-board urgent register: urgent-flagged active sessions from every
     * floor plus very-urgent patients still waiting anywhere. Public so all
     * staff devices see the same consolidated register.
     */
    urgentRegister: staffReadProcedure.query(async ({ ctx }) => {
      if (!ctx.isStaff) {
        return { urgentSessions: [], veryUrgentWaiting: [] };
      }
      const [sessions2, waiting, floors2] = await Promise.all([
        listMachines({ canSeePhi: true }),
        listWaitingAll({ canSeePhi: true }),
        listFloors()
      ]);
      const floorNames = new Map(
        floors2.map((f) => [f.id, f.name])
      );
      const urgentSessions = sessions2.filter((r) => r.session?.urgent).map((r) => {
        const s = r.session;
        return {
          kind: "session",
          machineId: r.machine.id,
          sessionId: s.id,
          machineLabel: r.machine.label,
          location: r.machine.location,
          floorId: r.machine.floorId,
          floorName: r.machine.floorId ? floorNames.get(r.machine.floorId) ?? null : null,
          patientId: s.patientId ?? s.ticket,
          durationMinutes: s.durationMinutes,
          endsAt: s.endsAt,
          isolationTag: s.isolationTag
        };
      }).sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());
      const veryUrgentWaiting = waiting.filter((e) => e.priority === "veryUrgent").map((e) => ({
        kind: "waiting",
        waitingId: e.id,
        patientId: e.patientId ?? e.ticket,
        floorId: e.floorId,
        floorName: floorNames.get(e.floorId) ?? null,
        priority: e.priority,
        joinedAt: e.joinedAt
      })).sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime());
      return { urgentSessions, veryUrgentWaiting };
    }),
    /** Add a patient to the waiting list (staff only). */
    add: staffOrAdminProcedure.input(
      z2.object({
        floorId: z2.number().int().positive(),
        patientId: z2.string().trim().min(1, "Patient identifier is required").max(64),
        priority: waitingPrioritySchema.default("normal"),
        /** Planned treatment length, carried onto the session at admit time. */
        durationMinutes: z2.number().int().min(15, "Minimum duration is 15 minutes").max(1440, "Maximum duration is 24 hours").default(240),
        isolationTag: isolationTagSchema.default("clean"),
        assignedNurse: z2.string().trim().max(64).nullable().default(null)
      })
    ).mutation(async ({ ctx, input }) => {
      requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      try {
        const result = await addWaiting({
          floorId: input.floorId,
          patientId: input.patientId,
          priority: input.priority,
          durationMinutes: input.durationMinutes,
          isolationTag: input.isolationTag,
          assignedNurse: input.assignedNurse,
          addedBy: ctx.user?.name ?? ctx.user?.email ?? ctx.staff?.displayName ?? "staff"
        });
        return { success: true, entryId: result.id };
      } catch (error) {
        const msg = error?.message;
        if (msg === "PATIENT_ID_REQUIRED") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "Patient identifier cannot be empty." });
        }
        if (msg === "PATIENT_ID_TOO_LONG") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "Patient identifier is too long (max 64 characters)." });
        }
        mapBackendError(error);
      }
    }),
    /** Remove a patient from the waiting list (staff only). */
    remove: staffOrAdminProcedure.input(
      z2.object({
        entryId: z2.number().int().positive(),
        floorId: z2.number().int().positive()
      })
    ).mutation(async ({ ctx, input }) => {
      requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      try {
        await removeWaiting({ entryId: input.entryId, floorId: input.floorId });
      } catch (error) {
        mapBackendError(error);
      }
      return { success: true };
    }),
    /** Change a waiting patient's priority (staff only), e.g. escalate to very urgent. */
    setPriority: staffOrAdminProcedure.input(
      z2.object({
        entryId: z2.number().int().positive(),
        floorId: z2.number().int().positive(),
        priority: waitingPrioritySchema
      })
    ).mutation(async ({ ctx, input }) => {
      requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      try {
        await markWaitingUrgent({
          entryId: input.entryId,
          floorId: input.floorId,
          priority: input.priority
        });
      } catch (error) {
        mapBackendError(error);
      }
      return { success: true };
    }),
    /**
     * Call a waiting patient to the treatment area (staff only). The stored
     * call state is what the lounge kiosk reads, so the announcement survives
     * a kiosk reload and reaches every screen, not only the nurse's device.
     */
    callIn: staffOrAdminProcedure.input(
      z2.object({
        entryId: z2.number().int().positive(),
        floorId: z2.number().int().positive(),
        /** false cancels a call made by mistake. */
        called: z2.boolean().default(true)
      })
    ).mutation(async ({ ctx, input }) => {
      requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      try {
        await setWaitingCall({
          entryId: input.entryId,
          floorId: input.floorId,
          called: input.called,
          calledBy: ctx.user?.name ?? ctx.user?.email ?? ctx.staff?.displayName ?? "staff"
        });
      } catch (error) {
        if (error?.message === "WAITING_CALL_UNAVAILABLE") {
          throw new TRPCError4({
            code: "PRECONDITION_FAILED",
            message: "Calling patients in is not enabled on this database yet."
          });
        }
        mapBackendError(error);
      }
      return { success: true };
    }),
    /** Number of vacant machines on a floor (for enabling the admit control). */
    vacantCount: publicProcedure.input(z2.object({ floorId: z2.number().int().positive() })).query(({ input }) => countVacantMachines({ floorId: input.floorId })),
    /**
     * Admit a waiting patient onto the first vacant machine of the floor.
     * Starts the treatment session and marks the waiting entry as admitted.
     */
    admit: staffOrAdminProcedure.input(
      z2.object({
        entryId: z2.number().int().positive(),
        floorId: z2.number().int().positive(),
        /** Omitted → the details captured when the patient joined the queue. */
        durationMinutes: z2.number().int().min(15).max(1440).optional(),
        isolationTag: isolationTagSchema.optional(),
        urgent: z2.boolean().default(false),
        displayLabel: z2.string().trim().max(64).nullable().default(null),
        assignedNurse: z2.string().trim().max(64).nullable().default(null)
      })
    ).mutation(async ({ ctx, input }) => {
      requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      const entry = await listWaiting({ floorId: input.floorId });
      const patient = entry.find((e) => e.id === input.entryId);
      try {
        const admitRes = await admitWaiting({
          entryId: input.entryId,
          floorId: input.floorId,
          durationMinutes: input.durationMinutes,
          isolationTag: input.isolationTag,
          urgent: input.urgent,
          startedBy: ctx.user?.name ?? ctx.user?.email ?? ctx.staff?.displayName ?? "staff",
          displayLabel: input.displayLabel,
          assignedNurse: input.assignedNurse
        });
        const ticket = admitRes?.ticket || (patient?.patientId ? patientTicket(patient.patientId) : "");
        return {
          success: true,
          patientId: patient?.patientId ?? "",
          ticket,
          machineLabel: admitRes?.machineLabel ?? ""
        };
      } catch (error) {
        const msg = error?.message;
        if (msg === "NO_WAITING_PATIENT") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "This patient is no longer waiting \u2014 they may already have been admitted." });
        }
        if (msg === "NO_VACANT_MACHINE") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "No vacant machine on this floor \u2014 end or release a session first." });
        }
        mapBackendError(error);
      }
    }),
    /** Active sessions on a floor grouped for the "Nurse Patient Assignments" list. */
    nurseAssignments: staffReadProcedure.input(z2.object({ floorId: z2.number().int().positive() })).query(async ({ ctx, input }) => {
      if (!ctx.isStaff) return [];
      return listNurseAssignments({ floorId: input.floorId });
    })
  }),
  /**
   * End of Day report: machines utilized, patients catered, priority and
   * isolation breakdowns for completed sessions on the chosen day, plus the
   * waiting-list adds of that day grouped by priority.
   */
  endOfDay: router({
    summary: staffReadProcedure.input(
      z2.object({
        floorId: z2.number().int().positive().optional(),
        /** Report date in ISO format (YYYY-MM-DD); defaults to today in Asia/Manila time. */
        date: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
      }).optional()
    ).query(async ({ ctx, input }) => {
      const staff = ctx.staff;
      let floorId = input?.floorId;
      if (floorId === void 0 && staff.role === "nurse") {
        floorId = staff.assignedFloorId ?? void 0;
      }
      if (floorId !== void 0) {
        requireFloorAccess(staff, floorId, ctx.user);
      }
      return endOfDayReport({ floorId, date: input?.date });
    }),
    /**
     * All-boards End of Day report in a SINGLE call: summaries, per-machine
     * pause/idle metrics and day narratives for every floor. Used by the
     * supervisor's /report page to avoid one DB round trip (~1.3s) per
     * per-floor procedure — supervisors see all boards, everyone else is
     * rejected so a nurse/guest never pays for boards they can't read.
     */
    bulkSummary: supervisorProcedure.input(
      z2.object({
        /** Report date in ISO format (YYYY-MM-DD); defaults to today in Asia/Manila time. */
        date: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
      }).optional()
    ).query(async ({ input }) => endOfDayReportBulk({ date: input?.date })),
    /**
     * Entire supervisor /report page in ONE call: staff session info, floor
     * list, per-floor summaries, narratives and the end-of-month aggregate.
     * The production path pays a fixed ~3s overhead per HTTP request
     * (serverless cold path + network), so collapsing the page's 4-5
     * requests into a single request roughly halves the perceived load time.
     */
    reportPage: supervisorProcedure.input(
      z2.object({
        /** Report date in ISO format (YYYY-MM-DD); defaults to today in Asia/Manila time. */
        date: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        /** Report month in ISO format (YYYY-MM); defaults to the current month in Asia/Manila time. */
        month: z2.string().regex(/^\d{4}-\d{2}$/).optional(),
        /** Shift filter for narrative tables; "all" or a REPORT_SHIFTS key (empty string = all). */
        shiftKey: z2.string().optional()
      }).optional()
    ).query(async ({ ctx, input }) => {
      const [daily, monthly] = await Promise.all([
        endOfDayReportBulk({ date: input?.date }),
        monthReport({ floorId: void 0, month: input?.month })
      ]);
      const shiftKey = input?.shiftKey ?? "";
      const narratives = shiftKey && shiftKey !== "all" ? Object.fromEntries(
        Object.entries(daily.narratives).map(([floorId, entries]) => [
          floorId,
          entries.filter((e) => periodOverlapsShift(e.periodKey, shiftKey))
        ])
      ) : daily.narratives;
      return {
        // Staff session carried inline so the /report page needs no
        // separate staff.me round trip (each request costs ~3s overhead).
        staff: ctx.staff,
        daily: { ...daily, narratives },
        monthly
      };
    }),
    /**
     * End of Month report: aggregates the end-of-day data across every day of
     * the given month (Asia/Manila) per floor — sessions ended, machines
     * utilized, distinct patients catered, urgency/isolation breakdowns,
     * treatment hours, waiting-list additions and pause time.
     */
    monthly: supervisorProcedure.input(
      z2.object({
        floorId: z2.number().int().positive().optional(),
        /** Report month in ISO format (YYYY-MM); defaults to the current month in Asia/Manila time. */
        month: z2.string().regex(/^\d{4}-\d{2}$/).optional()
      }).optional()
    ).query(async ({ ctx, input }) => {
      const staff = ctx.staff;
      let floorId = input?.floorId;
      if (floorId === void 0 && staff.role === "nurse") {
        floorId = staff.assignedFloorId ?? void 0;
      }
      if (floorId !== void 0) {
        requireFloorAccess(staff, floorId, ctx.user);
      }
      return monthReport({ floorId, month: input?.month });
    })
  }),
  /**
   * Charge-nurse narrative reports. One board's day is split into four
   * treatment sessions plus three hooking/terminating transitions; the nurse
   * on duty writes a narrative per period they cover, optionally tagging the
   * shift window they worked. Floor-scoped: nurses write only for their own
   * board; supervisors see everything.
   */
  narratives: router({
    /** All narratives for a board on a given day (staff only). */
    list: staffReadProcedure.input(
      z2.object({
        floorId: z2.number().int().positive(),
        /** Report date in ISO format (YYYY-MM-DD). */
        reportDate: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      })
    ).query(async ({ ctx, input }) => {
      requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      if (ctx.staff.role === "guest" && ctx.staff.fromCookie) return [];
      return listNarratives({ floorId: input.floorId, reportDate: input.reportDate });
    }),
    /** Rewrite an existing narrative in place (staff only, floor-scoped). */
    update: staffOrAdminProcedure.input(
      z2.object({
        id: z2.number().int().positive(),
        floorId: z2.number().int().positive(),
        body: z2.string().trim().min(1, "The narrative cannot be empty").max(4e3)
      })
    ).mutation(async ({ ctx, input }) => {
      requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      const staffSession = ctx.staff;
      const row = await getNarrativeById(input.id, input.floorId);
      if (!row) throw new TRPCError4({ code: "NOT_FOUND", message: "Narrative not found." });
      try {
        await updateNarrativeBody(input.id, input.body);
        await logNarrativeUpdate({
          narrativeId: row.id,
          floorId: row.floorId,
          reportDate: row.reportDate,
          periodKey: row.periodKey,
          actor: staffSession?.displayName ?? "(unknown)",
          actorRole: staffSession?.role === "supervisor" ? "supervisor" : staffSession?.role === "auditor" ? "auditor" : "nurse",
          body: input.body
        });
      } catch (error) {
        mapBackendError(error);
      }
      return { success: true };
    }),
    /** Write or update a period narrative (staff only, floor-scoped). */
    create: staffOrAdminProcedure.input(
      z2.object({
        floorId: z2.number().int().positive(),
        reportDate: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodKey: z2.string().max(16),
        shiftKey: z2.string().max(16).nullable().default(null),
        author: z2.string().trim().min(1, "Author name is required").max(64),
        body: z2.string().trim().min(1, "The narrative cannot be empty").max(4e3),
        authorRole: z2.enum(["supervisor", "nurse"]).default("nurse")
      })
    ).mutation(async ({ ctx, input }) => {
      requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      const writerRole = ctx.staff?.role === "supervisor" ? "supervisor" : "nurse";
      try {
        const result = await createNarrative({ ...input, authorRole: writerRole });
        return { success: true, id: result.id };
      } catch (error) {
        const msg = error?.message;
        if (msg === "INVALID_PERIOD") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "Unknown reporting period." });
        }
        if (msg === "EMPTY_BODY") {
          throw new TRPCError4({ code: "BAD_REQUEST", message: "The narrative cannot be empty." });
        }
        if (msg === "FORBIDDEN_PERIOD") {
          throw new TRPCError4({ code: "FORBIDDEN", message: "This period is not part of your reporting scope." });
        }
        mapBackendError(error);
      }
    }),
    /** Remove a narrative (staff only, floor-scoped). */
    remove: staffOrAdminProcedure.input(z2.object({ id: z2.number().int().positive(), floorId: z2.number().int().positive() })).mutation(async ({ ctx, input }) => {
      requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      try {
        await deleteNarrative({
          id: input.id,
          floorId: input.floorId,
          actor: ctx.staff?.displayName ?? "(unknown)",
          actorRole: ctx.staff?.role === "supervisor" ? "supervisor" : ctx.staff?.role === "auditor" ? "auditor" : "nurse"
        });
      } catch (error) {
        mapBackendError(error);
      }
      return { success: true };
    }),
    /** Edit-history audit trail for narratives (auditor only). */
    history: staffOrAdminProcedure.input(
      z2.object({
        reportDate: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        floorId: z2.number().int().positive().optional()
      }).default({})
    ).query(async ({ ctx, input }) => {
      const staffSession = ctx.staff;
      if (staffSession?.role !== "auditor") {
        throw new TRPCError4({ code: "FORBIDDEN", message: "Only the auditor account may read the narrative edit history." });
      }
      return listNarrativeHistory({ reportDate: input.reportDate, floorId: input.floorId });
    })
  }),
  /**
   * Local board staff authentication (RDU nurses + SKTI supervisor).
   * Independent of the Manus OAuth login used by the owner/admin.
   */
  staff: router({
    me: publicProcedure.query(async ({ ctx }) => {
      return resolveStaffSession(ctx.req);
    }),
    /**
     * Enter explicit guest mode. Issues a signed JWT (role "guest") so the
     * cookie survives the same proxy handling as nurse/supervisor sessions —
     * resolveStaffSession then reports a guest session with fromCookie=true,
     * which locks writes server-side even for an OAuth-signed-in owner.
     */
    guest: publicProcedure.mutation(async ({ ctx }) => {
      await setStaffSessionCookieSync(
        ctx.req,
        ctx.res,
        {
          accountId: 0,
          username: "guest",
          displayName: "Guest",
          role: "guest",
          assignedFloorId: null
        },
        1
      );
      return { success: true };
    }),
    /**
     * Patient login by ticket number or patient ID.
     * Issues a role="patient" session restricted exclusively to the kiosk display.
     */
    patientLogin: publicProcedure.input(
      z2.object({
        ticketOrId: z2.string().trim().min(1).max(64)
      })
    ).mutation(async ({ ctx, input }) => {
      const raw = input.ticketOrId.trim();
      let ticket = raw.toUpperCase();
      let patientId = raw;
      let activeBay = null;
      let activeStatus = "unregistered";
      const db = await getDb();
      if (db) {
        const activeSessions = await db.select({
          machineId: sessions.machineId,
          patientId: sessions.patientId
        }).from(sessions).where(eq5(sessions.status, "active"));
        const match = activeSessions.find(
          (s) => s.patientId.toLowerCase() === raw.toLowerCase() || patientTicket(s.patientId).toLowerCase() === raw.toLowerCase()
        );
        if (match) {
          activeStatus = "in_treatment";
          ticket = patientTicket(match.patientId);
          patientId = match.patientId;
          const m = await db.select({ label: machines.label }).from(machines).where(eq5(machines.id, match.machineId)).limit(1);
          if (m[0]) activeBay = m[0].label;
        } else {
          const waiting = await db.select({ id: waitingList.id, patientId: waitingList.patientId }).from(waitingList).where(eq5(waitingList.status, "waiting"));
          const waitMatch = waiting.find(
            (w) => w.patientId.toLowerCase() === raw.toLowerCase() || patientTicket(w.patientId).toLowerCase() === raw.toLowerCase()
          );
          if (waitMatch) {
            activeStatus = "waiting";
            ticket = patientTicket(waitMatch.patientId);
            patientId = waitMatch.patientId;
          } else {
            if (/^tk-\d+$/i.test(raw)) {
              ticket = raw.toUpperCase();
            } else {
              ticket = patientTicket(raw);
            }
          }
        }
      } else {
        if (/^tk-\d+$/i.test(raw)) {
          ticket = raw.toUpperCase();
        } else {
          ticket = patientTicket(raw);
        }
      }
      const displayName = `Patient ${ticket}`;
      await setStaffSessionCookieSync(
        ctx.req,
        ctx.res,
        {
          accountId: 0,
          username: ticket,
          displayName,
          role: "patient",
          assignedFloorId: null
        },
        1
      );
      return {
        success: true,
        displayName,
        role: "patient",
        ticket,
        activeBay,
        activeStatus
      };
    }),
    /**
     * Patient guest mode: allows entering the kiosk without entering a specific ticket slip.
     */
    patientGuest: publicProcedure.mutation(async ({ ctx }) => {
      await setStaffSessionCookieSync(
        ctx.req,
        ctx.res,
        {
          accountId: 0,
          username: "patient.guest",
          displayName: "Lounge Patient",
          role: "patient",
          assignedFloorId: null
        },
        1
      );
      return { success: true, role: "patient" };
    }),
    login: publicProcedure.input(
      z2.object({
        username: z2.string().trim().min(1).max(64),
        password: z2.string().min(1)
      })
    ).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError4({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
      const rows = await db.select().from(staffAccounts).where(eq5(staffAccounts.username, input.username)).limit(1);
      const account = rows[0];
      if (!account || !account.active || !verifyPassword(input.password, account.passwordSalt, account.passwordHash)) {
        throw new TRPCError4({ code: "UNAUTHORIZED", message: "Invalid username or password." });
      }
      await db.update(staffAccounts).set({ lastSignedIn: /* @__PURE__ */ new Date() }).where(eq5(staffAccounts.id, account.id));
      await bumpTokenVersion(account.id);
      const accountNow = await db.select({ tokenVersion: staffAccounts.tokenVersion }).from(staffAccounts).where(eq5(staffAccounts.id, account.id)).limit(1);
      await setStaffSessionCookieSync(
        ctx.req,
        ctx.res,
        {
          accountId: account.id,
          username: account.username,
          displayName: account.displayName,
          role: account.role,
          assignedFloorId: account.assignedFloorId
        },
        accountNow[0]?.tokenVersion
      );
      return {
        success: true,
        displayName: account.displayName,
        role: account.role,
        assignedFloorId: account.assignedFloorId
      };
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const current = await resolveStaffSession(ctx.req);
      if (current.role === "nurse" || current.role === "supervisor") {
        await bumpTokenVersion(current.accountId);
      }
      await setStaffSessionCookieSync(ctx.req, ctx.res, null);
      return { success: true };
    })
  }),
  /**
   * Shift Handover Endorsements between dialysis charge nurses.
   */
  shiftEndorsements: router({
    list: clinicalReadProcedure.input(
      z2.object({
        floorId: z2.number().int().positive(),
        date: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
      })
    ).query(async ({ ctx, input }) => {
      requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      return listShiftEndorsements(input);
    }),
    byId: clinicalReadProcedure.input(z2.object({ id: z2.number().int().positive() })).query(async ({ ctx, input }) => {
      const item = await getShiftEndorsementById(input.id);
      if (!item) throw new TRPCError4({ code: "NOT_FOUND", message: "Shift endorsement not found." });
      if (item.floorId) requireFloorAccess(ctx.staff, item.floorId, ctx.user);
      return item;
    }),
    create: staffOrAdminProcedure.input(
      z2.object({
        shift: z2.string().trim().min(1, "Shift identifier is required").max(32),
        floorId: z2.number().int().positive(),
        date: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
        incomingNurse: z2.string().trim().min(1, "Incoming nurse is required").max(64),
        outgoingNurse: z2.string().trim().min(1, "Outgoing nurse is required").max(64),
        patientNotes: z2.string().trim().max(4e3).nullable().default(null),
        accessIssues: z2.string().trim().max(4e3).nullable().default(null),
        equipmentNotes: z2.string().trim().max(4e3).nullable().default(null),
        floorName: z2.string().trim().max(64).nullable().default(null),
        situation: z2.string().trim().max(4e3).nullable().default(null),
        background: z2.string().trim().max(4e3).nullable().default(null),
        assessment: z2.string().trim().max(4e3).nullable().default(null),
        recommendations: z2.string().trim().max(4e3).nullable().default(null),
        censusJson: z2.string().max(4e3).nullable().default(null),
        checklistJson: z2.string().max(4e3).nullable().default(null),
        specialWatchJson: z2.string().max(8e3).nullable().default(null),
        status: z2.enum(["DRAFT", "ENDORSED_AND_LOCKED"]).default("DRAFT")
      })
    ).mutation(async ({ ctx, input }) => {
      requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      try {
        const result = await createShiftEndorsement(input);
        return { success: true, id: result.id };
      } catch (error) {
        mapBackendError(error);
      }
    }),
    update: staffOrAdminProcedure.input(
      z2.object({
        id: z2.number().int().positive(),
        shift: z2.string().trim().min(1).max(32).optional(),
        incomingNurse: z2.string().trim().min(1).max(64).optional(),
        outgoingNurse: z2.string().trim().min(1).max(64).optional(),
        patientNotes: z2.string().trim().max(4e3).nullable().optional(),
        accessIssues: z2.string().trim().max(4e3).nullable().optional(),
        equipmentNotes: z2.string().trim().max(4e3).nullable().optional(),
        floorName: z2.string().trim().max(64).nullable().optional(),
        situation: z2.string().trim().max(4e3).nullable().optional(),
        background: z2.string().trim().max(4e3).nullable().optional(),
        assessment: z2.string().trim().max(4e3).nullable().optional(),
        recommendations: z2.string().trim().max(4e3).nullable().optional(),
        censusJson: z2.string().max(4e3).nullable().optional(),
        checklistJson: z2.string().max(4e3).nullable().optional(),
        specialWatchJson: z2.string().max(8e3).nullable().optional(),
        status: z2.enum(["DRAFT", "ENDORSED_AND_LOCKED"]).optional()
      })
    ).mutation(async ({ ctx, input }) => {
      const item = await getShiftEndorsementById(input.id);
      if (!item) throw new TRPCError4({ code: "NOT_FOUND", message: "Shift endorsement not found." });
      if (item.floorId) requireFloorAccess(ctx.staff, item.floorId, ctx.user);
      try {
        const { id, ...updates } = input;
        await updateShiftEndorsement(id, updates);
        return { success: true };
      } catch (error) {
        mapBackendError(error);
      }
    }),
    remove: staffOrAdminProcedure.input(z2.object({ id: z2.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const item = await getShiftEndorsementById(input.id);
      if (!item) throw new TRPCError4({ code: "NOT_FOUND", message: "Shift endorsement not found." });
      if (item.floorId) requireFloorAccess(ctx.staff, item.floorId, ctx.user);
      try {
        await deleteShiftEndorsement(input.id);
        return { success: true };
      } catch (error) {
        mapBackendError(error);
      }
    })
  }),
  /**
   * Intra-dialytic session complications and adverse clinical events.
   */
  sessionComplications: router({
    list: staffReadProcedure.input(
      z2.object({
        sessionId: z2.number().int().positive().optional(),
        floorId: z2.number().int().positive().optional()
      }).optional()
    ).query(async ({ ctx, input }) => {
      if (input?.floorId) requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      return listSessionComplications(input);
    }),
    create: staffOrAdminProcedure.input(
      z2.object({
        sessionId: z2.number().int().positive(),
        complicationType: z2.string().trim().min(1, "Complication type is required").max(64),
        onsetMinutes: z2.number().int().min(0).max(1440).nullable().default(null),
        intervention: z2.string().trim().max(2e3).nullable().default(null),
        resolved: z2.boolean().default(false),
        machineId: z2.number().int().positive().nullable().default(null),
        machineLabel: z2.string().trim().max(32).nullable().default(null),
        floorId: z2.number().int().positive().nullable().default(null),
        patientId: z2.string().trim().max(64).nullable().default(null),
        patientDisplayAlias: z2.string().trim().max(64).nullable().default(null),
        date: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
        timeOfDay: z2.string().trim().max(8).nullable().default(null),
        nurseName: z2.string().trim().max(96).nullable().default(null),
        severity: z2.string().trim().max(32).nullable().default(null),
        preEventBp: z2.string().trim().max(16).nullable().default(null),
        eventBp: z2.string().trim().max(16).nullable().default(null),
        heartRate: z2.number().int().min(0).max(300).nullable().default(null),
        spo2: z2.number().int().min(0).max(100).nullable().default(null),
        bfr: z2.number().int().min(0).max(1e3).nullable().default(null),
        ufr: z2.number().int().min(0).max(1e4).nullable().default(null),
        interventions: z2.array(z2.string().trim().max(200)).max(20).nullable().default(null),
        salineBolusVolumeMl: z2.number().int().min(0).max(5e3).nullable().default(null),
        physicianNotified: z2.string().trim().max(96).nullable().default(null),
        outcome: z2.string().trim().max(64).nullable().default(null),
        notes: z2.string().trim().max(4e3).nullable().default(null)
      })
    ).mutation(async ({ ctx, input }) => {
      const floorId = await getSessionFloorId(input.sessionId);
      if (floorId) requireFloorAccess(ctx.staff, floorId, ctx.user);
      try {
        const result = await createSessionComplication(input);
        return { success: true, id: result.id };
      } catch (error) {
        mapBackendError(error);
      }
    }),
    update: staffOrAdminProcedure.input(
      z2.object({
        id: z2.number().int().positive(),
        complicationType: z2.string().trim().min(1).max(64).optional(),
        onsetMinutes: z2.number().int().min(0).max(1440).nullable().optional(),
        intervention: z2.string().trim().max(2e3).nullable().optional(),
        resolved: z2.boolean().optional()
      })
    ).mutation(async ({ input }) => {
      try {
        const { id, ...updates } = input;
        await updateSessionComplication(id, updates);
        return { success: true };
      } catch (error) {
        mapBackendError(error);
      }
    }),
    remove: staffOrAdminProcedure.input(z2.object({ id: z2.number().int().positive() })).mutation(async ({ input }) => {
      try {
        await deleteSessionComplication(input.id);
        return { success: true };
      } catch (error) {
        mapBackendError(error);
      }
    })
  }),
  /**
   * Water Treatment & RO quality surveillance logs.
   */
  waterQualityLogs: router({
    list: clinicalReadProcedure.input(
      z2.object({
        floorId: z2.number().int().positive().optional(),
        date: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
      }).optional()
    ).query(async ({ ctx, input }) => {
      if (input?.floorId) {
        requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      }
      return listWaterQualityLogs(input);
    }),
    byId: clinicalReadProcedure.input(z2.object({ id: z2.number().int().positive() })).query(async ({ ctx, input }) => {
      const item = await getWaterQualityLogById(input.id);
      if (!item) throw new TRPCError4({ code: "NOT_FOUND", message: "Water quality log not found." });
      if (item.floorId) requireFloorAccess(ctx.staff, item.floorId, ctx.user);
      return item;
    }),
    create: staffOrAdminProcedure.input(
      z2.object({
        date: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
        floorId: z2.number().int().positive(),
        tdsIn: z2.number().int().nullable().default(null),
        tdsOut: z2.number().int().nullable().default(null),
        chlorineLevel: z2.string().trim().max(32).nullable().default(null),
        hardness: z2.string().trim().max(32).nullable().default(null),
        waterTemp: z2.string().trim().max(32).nullable().default(null),
        technician: z2.string().trim().min(1, "Technician name is required").max(64),
        status: z2.string().trim().max(32).default("pass"),
        timeOfDay: z2.string().trim().max(8).nullable().default(null),
        shift: z2.string().trim().max(48).nullable().default(null),
        inspectorRole: z2.string().trim().max(32).nullable().default(null),
        feedTds: z2.number().min(0).max(1e5).nullable().default(null),
        productTds: z2.number().min(0).max(1e5).nullable().default(null),
        productConductivity: z2.number().min(0).max(1e5).nullable().default(null),
        waterHardnessPpm: z2.number().min(0).max(1e4).nullable().default(null),
        loopFeedPressure: z2.number().min(0).max(500).nullable().default(null),
        loopReturnPressure: z2.number().min(0).max(500).nullable().default(null),
        waterTemperatureC: z2.number().min(0).max(120).nullable().default(null),
        totalChlorine: z2.number().min(0).max(100).nullable().default(null),
        chloramineBreakthrough: z2.boolean().default(false),
        heatDisinfectionCompleted: z2.boolean().default(false),
        heatPeakTemp: z2.number().min(0).max(150).nullable().default(null),
        heatHoldMinutes: z2.number().int().min(0).max(600).nullable().default(null),
        chemicalAgentUsed: z2.string().trim().max(48).nullable().default(null),
        residualChemicalTestNegative: z2.boolean().default(false),
        endotoxinLevel: z2.number().min(0).max(1e3).nullable().default(null),
        colonyCount: z2.number().int().min(0).max(1e6).nullable().default(null),
        correctiveAction: z2.string().trim().max(4e3).nullable().default(null),
        notes: z2.string().trim().max(4e3).nullable().default(null)
      })
    ).mutation(async ({ ctx, input }) => {
      requireFloorAccess(ctx.staff, input.floorId, ctx.user);
      try {
        const result = await createWaterQualityLog(input);
        return { success: true, id: result.id };
      } catch (error) {
        mapBackendError(error);
      }
    }),
    update: staffOrAdminProcedure.input(
      z2.object({
        id: z2.number().int().positive(),
        tdsIn: z2.number().int().nullable().optional(),
        tdsOut: z2.number().int().nullable().optional(),
        chlorineLevel: z2.string().trim().max(32).nullable().optional(),
        hardness: z2.string().trim().max(32).nullable().optional(),
        waterTemp: z2.string().trim().max(32).nullable().optional(),
        technician: z2.string().trim().min(1).max(64).optional(),
        status: z2.string().trim().max(32).optional()
      })
    ).mutation(async ({ ctx, input }) => {
      const item = await getWaterQualityLogById(input.id);
      if (!item) throw new TRPCError4({ code: "NOT_FOUND", message: "Water quality log not found." });
      if (item.floorId) requireFloorAccess(ctx.staff, item.floorId, ctx.user);
      try {
        const { id, ...updates } = input;
        await updateWaterQualityLog(id, updates);
        return { success: true };
      } catch (error) {
        mapBackendError(error);
      }
    }),
    remove: staffOrAdminProcedure.input(z2.object({ id: z2.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const item = await getWaterQualityLogById(input.id);
      if (!item) throw new TRPCError4({ code: "NOT_FOUND", message: "Water quality log not found." });
      if (item.floorId) requireFloorAccess(ctx.staff, item.floorId, ctx.user);
      try {
        await deleteWaterQualityLog(input.id);
        return { success: true };
      } catch (error) {
        mapBackendError(error);
      }
    })
  }),
  /**
   * Infection surveillance and bloodborne viral hepatitis/HIV/MDR screening.
   */
  infectionSurveillance: router({
    list: staffReadProcedure.input(z2.object({ patientId: z2.string().trim().optional() }).optional()).query(async ({ input }) => listInfectionSurveillance(input)),
    byPatientId: staffReadProcedure.input(z2.object({ patientId: z2.string().trim().min(1) })).query(async ({ input }) => {
      const row = await getInfectionSurveillanceByPatientId(input.patientId);
      if (!row) throw new TRPCError4({ code: "NOT_FOUND", message: "Infection surveillance record not found." });
      return row;
    }),
    upsert: staffOrAdminProcedure.input(
      z2.object({
        patientId: z2.string().trim().min(1, "Patient ID is required").max(64),
        hbsagStatus: z2.string().trim().max(32).default("negative"),
        hcvStatus: z2.string().trim().max(32).default("negative"),
        hivStatus: z2.string().trim().max(32).default("negative"),
        mdrStatus: z2.string().trim().max(32).default("negative"),
        lastTestedDate: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format").nullable().optional(),
        assignedIsolationRoom: z2.string().trim().max(64).nullable().optional()
      })
    ).mutation(async ({ input }) => {
      try {
        const result = await upsertInfectionSurveillance(input);
        return { success: true, id: result.id };
      } catch (error) {
        mapBackendError(error);
      }
    }),
    remove: staffOrAdminProcedure.input(z2.object({ id: z2.number().int().positive() })).mutation(async ({ input }) => {
      try {
        await deleteInfectionSurveillance(input.id);
        return { success: true };
      } catch (error) {
        mapBackendError(error);
      }
    })
  }),
  /**
   * Hemodialysis medical supplies and consumable inventory.
   */
  inventorySupplies: router({
    list: staffReadProcedure.input(
      z2.object({
        category: z2.string().trim().optional(),
        lowStockOnly: z2.boolean().optional()
      }).optional()
    ).query(async ({ input }) => listInventorySupplies(input)),
    byItemCode: staffReadProcedure.input(z2.object({ itemCode: z2.string().trim().min(1) })).query(async ({ input }) => {
      const item = await getInventorySupplyByItemCode(input.itemCode);
      if (!item) throw new TRPCError4({ code: "NOT_FOUND", message: "Item not found in inventory." });
      return item;
    }),
    add: staffOrAdminProcedure.input(
      z2.object({
        itemCode: z2.string().trim().min(1, "Item code is required").max(64),
        itemName: z2.string().trim().min(1, "Item name is required").max(128),
        unit: z2.string().trim().min(1, "Unit is required").max(32),
        currentStock: z2.number().int().min(0).default(0),
        reorderLevel: z2.number().int().min(0).default(10),
        category: z2.string().trim().max(64).default("general")
      })
    ).mutation(async ({ input }) => {
      try {
        const result = await addInventorySupply(input);
        return { success: true, id: result.id };
      } catch (error) {
        if (error?.message === "ITEM_CODE_EXISTS") {
          throw new TRPCError4({ code: "CONFLICT", message: "An item with this item code already exists." });
        }
        mapBackendError(error);
      }
    }),
    update: staffOrAdminProcedure.input(
      z2.object({
        id: z2.number().int().positive(),
        itemName: z2.string().trim().min(1).max(128).optional(),
        unit: z2.string().trim().min(1).max(32).optional(),
        currentStock: z2.number().int().min(0).optional(),
        reorderLevel: z2.number().int().min(0).optional(),
        category: z2.string().trim().max(64).optional()
      })
    ).mutation(async ({ input }) => {
      try {
        const { id, ...updates } = input;
        await updateInventorySupply(id, updates);
        return { success: true };
      } catch (error) {
        mapBackendError(error);
      }
    }),
    adjustStock: staffOrAdminProcedure.input(
      z2.object({
        id: z2.number().int().positive(),
        delta: z2.number().int()
      })
    ).mutation(async ({ input }) => {
      try {
        await adjustInventoryStock(input.id, input.delta);
        return { success: true };
      } catch (error) {
        mapBackendError(error);
      }
    }),
    remove: staffOrAdminProcedure.input(z2.object({ id: z2.number().int().positive() })).mutation(async ({ input }) => {
      try {
        await deleteInventorySupply(input.id);
        return { success: true };
      } catch (error) {
        mapBackendError(error);
      }
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/vercel.ts
var appPromise = null;
async function getApp() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  return app;
}
async function handler(req, res) {
  try {
    if (!appPromise) {
      appPromise = getApp();
    }
    const app = await appPromise;
    return app(req, res);
  } catch (error) {
    console.error("[Vercel Serverless Error]:", error);
    appPromise = null;
    res.status(500).json({ error: "Internal Server Error" });
  }
}
export {
  handler as default
};
