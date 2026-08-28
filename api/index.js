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
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
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
});
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
});
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
  /** When the patient was admitted onto a machine (leaves the list). */
  admittedAt: timestamp("admittedAt", { mode: "date" }),
  status: waitingStatusEnum("status").notNull().default("waiting"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull()
});
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
});
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
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
function resolveUrl() {
  const raw = process.env.SUPABASE_DATABASE_URL_B64;
  if (raw) {
    try {
      return Buffer.from(raw, "base64").toString("utf-8");
    } catch {
    }
  }
  return process.env.DATABASE_URL ?? null;
}
var _pool = null;
function buildPool(url) {
  return new Pool({
    connectionString: url,
    max: 8,
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
      try {
        await _pool?.end();
      } catch {
      }
      _pool = null;
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
    if (!staff || typeof staff.accountId !== "number" || typeof staff.username !== "string" || typeof staff.displayName !== "string" || !["nurse", "supervisor", "guest", "auditor"].includes(String(staff.role))) {
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
  if (staff.role !== "nurse" && staff.role !== "supervisor" && staff.role !== "guest" && staff.role !== "auditor") return;
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
    if (staff.role === "guest" && staff.fromCookie) {
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
var staffOrAdminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    const staff = await resolveStaffSession(ctx.req);
    const oauthUser = ctx.user;
    if (staff.role === "guest" && staff.fromCookie) {
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

// server/machines.ts
import { and, desc, eq as eq3, isNull, sql } from "drizzle-orm";
async function listMachines() {
  const db = await getDb();
  if (!db) return [];
  const [allMachines, rows] = await Promise.all([
    db.select().from(machines).orderBy(machines.floorId, machines.sortOrder, machines.id),
    // Floor boards only show machines with status 'active'. Backup/repair
    // machines live on the dedicated Backup & Repair board instead.
    db.select().from(sessions).where(eq3(sessions.status, "active"))
  ]);
  const byMachine = /* @__PURE__ */ new Map();
  for (const row of rows) byMachine.set(row.machineId, row);
  return allMachines.map((m) => ({
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
        pausedSeconds: s.pausedSeconds
      };
    })()
  })).filter((r) => r.machine.status === "active");
}
async function assignSession(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(async (tx) => {
    const conflict = await tx.select({ id: sessions.id }).from(sessions).where(and(eq3(sessions.machineId, input.machineId), eq3(sessions.status, "active"))).limit(1).for("update");
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
  }).from(sessions).where(eq3(sessions.id, input.sessionId)).limit(1);
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
    }).where(and(eq3(sessions.id, input.sessionId), eq3(sessions.status, "active")));
  } else {
    await db.update(sessions).set({ status: "ended", endedAt: now, endedBy: input.endedBy }).where(and(eq3(sessions.id, input.sessionId), eq3(sessions.status, "active")));
  }
  if (session[0]?.needsRepairAfterSession) {
    await setMachineStatus({ machineId: session[0].machineId, status: "repair" }).catch(() => {
    });
  }
}
async function toggleUrgent(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sessions).set({ urgent: sql`NOT urgent` }).where(eq3(sessions.id, input.sessionId));
}
async function togglePause(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = /* @__PURE__ */ new Date();
  const rows = await db.select({ pausedAt: sessions.pausedAt, pausedSeconds: sessions.pausedSeconds, endsAt: sessions.endsAt }).from(sessions).where(and(eq3(sessions.id, input.sessionId), eq3(sessions.status, "active"))).limit(1);
  const row = rows[0];
  if (!row) throw new Error("NO_ACTIVE_SESSION");
  if (input.paused) {
    if (row.pausedAt) return;
    await db.update(sessions).set({ pausedAt: now }).where(eq3(sessions.id, input.sessionId));
  } else {
    if (!row.pausedAt) return;
    const pausedMs = now.getTime() - row.pausedAt.getTime();
    const addedSeconds = Math.round(pausedMs / 1e3);
    const newEndsAt = new Date(row.endsAt.getTime() + addedSeconds * 1e3);
    await db.update(sessions).set({
      pausedAt: null,
      pausedSeconds: Math.max(0, row.pausedSeconds + addedSeconds),
      endsAt: newEndsAt
    }).where(eq3(sessions.id, input.sessionId));
  }
}
async function setRepairFlag(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sessions).set({ needsRepairAfterSession: input.flag }).where(eq3(sessions.id, input.sessionId));
}
async function updateIsolationTag(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sessions).set({ isolationTag: input.isolationTag }).where(eq3(sessions.id, input.sessionId));
}
async function updateDisplayLabel(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const label = input.displayLabel ? input.displayLabel.trim() || null : null;
  if (label !== null && label.length > 64) throw new Error("LABEL_TOO_LONG");
  await db.update(sessions).set({ displayLabel: label }).where(eq3(sessions.id, input.sessionId));
}
async function getSessionFloorId(sessionId) {
  const db = await getDb();
  if (!db) return void 0;
  const rows = await db.select({ machineId: sessions.machineId }).from(sessions).where(eq3(sessions.id, sessionId)).limit(1);
  if (!rows[0]) return void 0;
  const machine = await getMachineById(rows[0].machineId);
  return machine?.floorId ?? null;
}
async function getMachineById(machineId) {
  const db = await getDb();
  if (!db) return void 0;
  const rows = await db.select().from(machines).where(eq3(machines.id, machineId)).limit(1);
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
  const existing = await db.select({ id: machines.id }).from(machines).where(eq3(machines.label, input.label.trim())).limit(1);
  if (existing.length > 0) {
    throw new Error("MACHINE_LABEL_EXISTS");
  }
  const maxOrder = await db.select({ sortOrder: machines.sortOrder }).from(machines).where(input.floorId ? eq3(machines.floorId, input.floorId) : isNull(machines.floorId)).orderBy(desc(machines.sortOrder)).limit(1);
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
  const existing = await db.select({ id: machines.id }).from(machines).where(and(eq3(machines.label, newLabel), sql`${machines.id} <> ${input.machineId}`)).limit(1);
  if (existing.length > 0) {
    throw new Error("MACHINE_LABEL_EXISTS");
  }
  await db.update(machines).set({ label: newLabel }).where(eq3(machines.id, input.machineId));
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
  }).from(machines).where(sql`${machines.status} <> 'active'`).orderBy(machines.status, machines.sortOrder, machines.id);
  return rows;
}
async function setMachineStatus(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const machine = await getMachineById(input.machineId);
  if (!machine) throw new Error("MACHINE_NOT_FOUND");
  const active = await db.select({ id: sessions.id }).from(sessions).where(and(eq3(sessions.machineId, input.machineId), eq3(sessions.status, "active"))).limit(1);
  if (active.length > 0) {
    throw new Error("MACHINE_IN_TREATMENT");
  }
  if (input.status === "active") {
    if (input.floorId === void 0 || input.floorId === null) {
      throw new Error("FLOOR_REQUIRED");
    }
    const floor = await db.select({ id: floors.id }).from(floors).where(eq3(floors.id, input.floorId)).limit(1);
    if (floor.length === 0) throw new Error("FLOOR_NOT_FOUND");
  }
  const note = input.statusNote?.trim() || null;
  await db.update(machines).set({
    status: input.status,
    statusNote: note,
    floorId: input.status === "active" ? input.floorId : machine.floorId
  }).where(eq3(machines.id, input.machineId));
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
    and(sql`${sessions.machineId} IN (${input.machineAId}, ${input.machineBId})`, eq3(sessions.status, "active"))
  ).limit(1);
  if (active.length > 0) throw new Error("MACHINE_IN_TREATMENT");
  if (a.floorId === b.floorId) {
    await reorderMachines(input.machineAId, input.machineBId);
    return;
  }
  await db.update(machines).set({ floorId: b.floorId }).where(eq3(machines.id, a.id));
  await db.update(machines).set({ floorId: a.floorId }).where(eq3(machines.id, b.id));
}
async function reorderMachines(machineAId, machineBId) {
  const db = await getDb();
  if (!db) return;
  const a = await getMachineById(machineAId);
  const b = await getMachineById(machineBId);
  if (!a || !b || a.floorId !== b.floorId) return;
  await db.update(machines).set({ sortOrder: b.sortOrder }).where(eq3(machines.id, a.id));
  await db.update(machines).set({ sortOrder: a.sortOrder }).where(eq3(machines.id, b.id));
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
  const rows = await db.select().from(narrativeReports).where(and(eq3(narrativeReports.id, id), eq3(narrativeReports.floorId, floorId))).limit(1);
  return rows[0];
}
async function updateNarrativeBody(id, body) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(narrativeReports).set({ body }).where(eq3(narrativeReports.id, id));
  const rows = await db.select({ reportDate: narrativeReports.reportDate, floorId: narrativeReports.floorId }).from(narrativeReports).where(eq3(narrativeReports.id, id));
  if (rows[0]) reportCacheInvalidate(rows[0].reportDate, rows[0].floorId);
}
async function listNarratives(input) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(narrativeReports).where(and(eq3(narrativeReports.floorId, input.floorId), eq3(narrativeReports.reportDate, input.reportDate))).orderBy(narrativeReports.updatedAt);
}
async function deleteNarrative(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(narrativeReports).where(and(eq3(narrativeReports.id, input.id), eq3(narrativeReports.floorId, input.floorId)));
  await db.delete(narrativeReports).where(and(eq3(narrativeReports.id, input.id), eq3(narrativeReports.floorId, input.floorId)));
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
      and(eq3(narrativeHistory.floorId, input.floorId), eq3(narrativeHistory.reportDate, input.reportDate))
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
    and(
      eq3(sessions.status, "ended"),
      sql`${sessions.endedAt} >= ${dateStart}`,
      sql`${sessions.endedAt} <= ${dateEnd}`
    )
  );
  const activeToday = await db.select().from(sessions).where(
    and(eq3(sessions.status, "active"), sql`${sessions.startedAt} >= ${dateStart}`, sql`${sessions.startedAt} <= ${dateEnd}`)
  );
  const floorMachines = await db.select({ id: machines.id, machineId: machines.id }).from(machines).where(and(eq3(machines.floorId, input.floorId), eq3(machines.status, "active")));
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
  const active = await db.select({ id: sessions.id }).from(sessions).where(and(eq3(sessions.machineId, input.machineId), eq3(sessions.status, "active"))).limit(1);
  if (active.length > 0) {
    throw new Error("MACHINE_IN_TREATMENT");
  }
  const machine = await db.select({ status: machines.status }).from(machines).where(eq3(machines.id, input.machineId)).limit(1);
  if (machine.length === 0) throw new Error("MACHINE_NOT_FOUND");
  if (machine[0].status !== "active") {
    throw new Error("MACHINE_OFFBOARD");
  }
  await db.delete(sessions).where(eq3(sessions.machineId, input.machineId));
  await db.delete(machines).where(eq3(machines.id, input.machineId));
}
async function addRoom(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select({ id: floors.id }).from(floors).where(eq3(floors.name, input.name.trim())).limit(1);
  if (existing.length > 0) {
    throw new Error("ROOM_EXISTS");
  }
  const maxOrder = await db.select({ sortOrder: floors.sortOrder }).from(floors).orderBy(desc(floors.sortOrder)).limit(1);
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
  const existing = await db.select({ id: floors.id }).from(floors).where(and(eq3(floors.name, newName), sql`${floors.id} <> ${input.roomId}`)).limit(1);
  if (existing.length > 0) {
    throw new Error("ROOM_EXISTS");
  }
  await db.update(floors).set({ name: newName }).where(eq3(floors.id, input.roomId));
}
async function removeRoom(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const active = await db.select({ id: sessions.id }).from(sessions).innerJoin(machines, eq3(machines.id, sessions.machineId)).where(and(eq3(machines.floorId, input.roomId), eq3(sessions.status, "active"))).limit(1);
  if (active.length > 0) {
    throw new Error("ROOM_HAS_ACTIVE_SESSIONS");
  }
  const machineCount = await db.select({ id: machines.id }).from(machines).where(eq3(machines.floorId, input.roomId)).limit(1);
  if (machineCount.length > 0) {
    throw new Error("ROOM_HAS_MACHINES");
  }
  await db.delete(floors).where(eq3(floors.id, input.roomId));
}
function toWaitingView(r) {
  return {
    id: r.id,
    patientId: r.patientId,
    floorId: r.floorId,
    priority: r.priority,
    durationMinutes: r.durationMinutes,
    isolationTag: r.isolationTag,
    assignedNurse: r.assignedNurse,
    addedBy: r.addedBy,
    joinedAt: r.joinedAt
  };
}
async function listWaitingAll() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(waitingList).where(eq3(waitingList.status, "waiting")).orderBy(desc(waitingList.priority), waitingList.joinedAt, waitingList.id);
  return rows.map(toWaitingView);
}
async function listWaiting(input) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(waitingList).where(and(eq3(waitingList.floorId, input.floorId), eq3(waitingList.status, "waiting"))).orderBy(desc(waitingList.priority), waitingList.joinedAt, waitingList.id);
  return rows.map(toWaitingView);
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
    and(eq3(waitingList.id, input.entryId), eq3(waitingList.floorId, input.floorId), eq3(waitingList.status, "waiting"))
  );
}
async function markWaitingUrgent(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(waitingList).set({ priority: input.priority }).where(and(eq3(waitingList.id, input.entryId), eq3(waitingList.floorId, input.floorId), eq3(waitingList.status, "waiting")));
}
async function countVacantMachines(input) {
  const db = await getDb();
  if (!db) return 0;
  const floorMachines = await db.select({ id: machines.id }).from(machines).where(eq3(machines.floorId, input.floorId));
  const occupiedIds = await db.select({ machineId: sessions.machineId }).from(sessions).where(eq3(sessions.status, "active"));
  const occupied = new Set(occupiedIds.map((o) => o.machineId));
  return floorMachines.filter((m) => !occupied.has(m.id)).length;
}
async function admitWaiting(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const entry = await db.select().from(waitingList).where(and(eq3(waitingList.id, input.entryId), eq3(waitingList.floorId, input.floorId), eq3(waitingList.status, "waiting"))).limit(1);
  if (entry.length === 0) {
    throw new Error("NO_WAITING_PATIENT");
  }
  const entryRow = entry[0];
  const durationMinutes = input.durationMinutes ?? entryRow.durationMinutes;
  const isolationTag = input.isolationTag ?? entryRow.isolationTag;
  const assignedNurse = input.assignedNurse?.trim() || entryRow.assignedNurse;
  await db.transaction(async (tx) => {
    const locked = await tx.select({ id: waitingList.id, patientId: waitingList.patientId }).from(waitingList).where(and(eq3(waitingList.id, input.entryId), eq3(waitingList.status, "waiting"))).limit(1).for("update", { skipLocked: true });
    if (locked.length === 0) {
      throw new Error("NO_WAITING_PATIENT");
    }
    const floorMachines = await tx.select({ id: machines.id }).from(machines).where(eq3(machines.floorId, input.floorId)).orderBy(machines.sortOrder, machines.id);
    const occupiedIds = await tx.select({ machineId: sessions.machineId }).from(sessions).where(eq3(sessions.status, "active"));
    const occupied = new Set(occupiedIds.map((o) => o.machineId));
    const vacant = floorMachines.find((m) => !occupied.has(m.id));
    if (!vacant) {
      throw new Error("NO_VACANT_MACHINE");
    }
    const now = /* @__PURE__ */ new Date();
    const endsAt = new Date(now.getTime() + durationMinutes * 60 * 1e3);
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
      assignedNurse: assignedNurse || null
    });
    await tx.update(waitingList).set({ status: "admitted", admittedAt: now }).where(eq3(waitingList.id, input.entryId));
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
  }).from(sessions).innerJoin(machines, eq3(sessions.machineId, machines.id)).where(and(eq3(sessions.status, "active"), eq3(machines.floorId, input.floorId)));
  const machineLabels = await db.select({ id: machines.id, label: machines.label }).from(machines);
  const labelById = /* @__PURE__ */ new Map();
  for (const m of machineLabels) labelById.set(m.id, m.label);
  const waiting = await listWaiting({ floorId: input.floorId });
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
    patientId: w.patientId,
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
  const floorMachines = await db.select().from(machines).where(opts?.floorId ? eq3(machines.floorId, opts.floorId) : void 0);
  const totalMachinesOnFloor = floorMachines.length;
  const floorMachineIds = new Set(floorMachines.map((m) => m.id));
  const machineLabels = new Map(floorMachines.map((m) => [m.id, m.label]));
  const rows = await db.select().from(sessions).where(
    and(
      eq3(sessions.status, "ended"),
      sql`${sessions.endedAt} >= ${range.from} AND ${sessions.endedAt} < ${range.to}`
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
    opts?.floorId ? and(
      eq3(waitingList.floorId, opts.floorId),
      sql`${waitingList.joinedAt} >= ${range.from} AND ${waitingList.joinedAt} < ${range.to}`
    ) : sql`${waitingList.joinedAt} >= ${range.from} AND ${waitingList.joinedAt} < ${range.to}`
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
  const rows = await db.select().from(floors).where(eq3(floors.id, floorId)).limit(1);
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
    db.select().from(floors).where(opts?.floorId ? eq3(floors.id, opts.floorId) : void 0),
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
    db.select().from(waitingList).where(sql`${waitingList.joinedAt} >= ${range.from} AND ${waitingList.joinedAt} < ${range.to}`),
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
  reportCache.set(cacheKey(prefix, input), { value, expiresAt: Date.now() + REPORT_CACHE_TTL_MS });
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
  }).from(narrativeReports).where(eq3(narrativeReports.reportDate, opts.reportDate)).orderBy(narrativeReports.floorId, narrativeReports.periodKey);
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
import { eq as eq4 } from "drizzle-orm";
function requireFloorAccess(staff, floorId, oauthUser) {
  if (oauthUser) return;
  if (staff.role === "guest") return;
  const allowed = staffAccessedFloors(staff);
  if (allowed !== null && !allowed.includes(floorId)) {
    throw new TRPCError4({ code: "FORBIDDEN", message: "You do not have access to this board" });
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
     *  client provides cross-device real-time sync. */
    list: publicProcedure.query(() => listMachines()),
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
    list: publicProcedure.input(z2.object({ floorId: z2.number().int().positive() })).query(async ({ ctx, input }) => {
      const staff = await resolveStaffSession(ctx.req);
      if (staff.role === "guest" && staff.fromCookie) return [];
      return listWaiting({ floorId: input.floorId });
    }),
    /**
     * Cross-board urgent register: urgent-flagged active sessions from every
     * floor plus very-urgent patients still waiting anywhere. Public so all
     * staff devices see the same consolidated register.
     */
    urgentRegister: publicProcedure.query(async ({ ctx }) => {
      const staff = await resolveStaffSession(ctx.req);
      if (staff.role === "guest" && staff.fromCookie) {
        return { urgentSessions: [], veryUrgentWaiting: [] };
      }
      const [sessions2, waiting, floors2] = await Promise.all([
        listMachines(),
        listWaitingAll(),
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
          patientId: s.patientId,
          durationMinutes: s.durationMinutes,
          endsAt: s.endsAt,
          isolationTag: s.isolationTag
        };
      }).sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());
      const veryUrgentWaiting = waiting.filter((e) => e.priority === "veryUrgent").map((e) => ({
        kind: "waiting",
        waitingId: e.id,
        patientId: e.patientId,
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
        await admitWaiting({
          entryId: input.entryId,
          floorId: input.floorId,
          durationMinutes: input.durationMinutes,
          isolationTag: input.isolationTag,
          urgent: input.urgent,
          startedBy: ctx.user?.name ?? ctx.user?.email ?? ctx.staff?.displayName ?? "staff",
          displayLabel: input.displayLabel,
          assignedNurse: input.assignedNurse
        });
        return { success: true, patientId: patient?.patientId ?? "" };
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
    nurseAssignments: publicProcedure.input(z2.object({ floorId: z2.number().int().positive() })).query(async ({ ctx, input }) => {
      const staff = await resolveStaffSession(ctx.req);
      if (staff.role === "guest" && staff.fromCookie) return [];
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
    login: publicProcedure.input(
      z2.object({
        username: z2.string().trim().min(1).max(64),
        password: z2.string().min(1)
      })
    ).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError4({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
      const rows = await db.select().from(staffAccounts).where(eq4(staffAccounts.username, input.username)).limit(1);
      const account = rows[0];
      if (!account || !account.active || !verifyPassword(input.password, account.passwordSalt, account.passwordHash)) {
        throw new TRPCError4({ code: "UNAUTHORIZED", message: "Invalid username or password." });
      }
      await db.update(staffAccounts).set({ lastSignedIn: /* @__PURE__ */ new Date() }).where(eq4(staffAccounts.id, account.id));
      await bumpTokenVersion(account.id);
      const accountNow = await db.select({ tokenVersion: staffAccounts.tokenVersion }).from(staffAccounts).where(eq4(staffAccounts.id, account.id)).limit(1);
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
    res.status(500).json({
      error: error?.message || "Internal Server Error",
      stack: error?.stack
    });
  }
}
export {
  handler as default
};
