import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { InsertUser, users } from "../drizzle/schema";
import { resolveDatabaseUrl } from './_core/database-url';
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

/** Warn once per process; getDb() runs on every request and would otherwise flood the log. */
let _urlDiagnosticLogged = false;

function resolveUrl(): string | null {
  const resolved = resolveDatabaseUrl();
  if (!_urlDiagnosticLogged) {
    if (resolved.url === null) console.error(`[Database] No usable connection string: ${resolved.reason}`);
    else if (resolved.warning) console.warn(`[Database] ${resolved.warning}`);
    _urlDiagnosticLogged = resolved.url === null || resolved.warning !== null;
  }
  return resolved.url;
}

// Lazily create the drizzle instance so local tooling can run without a DB.
//
// Production cold starts: the remote Supabase pooler occasionally drops the
// first connection attempt ("Connection terminated due to connection timeout").
// A single blocking attempt would make every first request on a cold instance
// stall for up to 15s while the pool times out and retries. Instead:
//  - pool creation does not force an initial connection (min: 0) — cheap to create,
//    connections are opened on demand;
//  - the SELECT 1 probe + every getDb() call retry up to 3 times with backoff,
//    so a transient drop costs ~1-2s total instead of the full timeout; and
//  - warmDb() fires at boot and keeps retrying in the background until the DB
//    responds, so warmed requests skip the handshake entirely.
let _pool: Pool | null = null;

/**
 * Serverless instances each hold their own pool, so a high per-instance cap
 * multiplies across concurrent lambdas and exhausts the Supabase connection
 * limit. A long-running node process is the opposite case and wants headroom.
 */
const POOL_MAX = process.env.VERCEL ? 2 : 8;

function buildPool(url: string): Pool {
  const pool = new Pool({
    connectionString: url,
    max: POOL_MAX,
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    // Always negotiate TLS. Supabase pooler connections (including those
    // routed through the platform proxy) present a certificate chain that
    // node-postgres does not trust by default, so self-signed intermediates
    // must be accepted to avoid SELF_SIGNED_CERT_IN_CHAIN.
    ssl: url.startsWith("postgresql") || url.startsWith("postgres")
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // node-postgres emits "error" on the pool when an IDLE client dies — which
  // the Supabase pooler does routinely. With no listener this is an
  // uncaughtException and the process exits, taking the whole site down.
  // Handle it and drop the pool so the next getDb() rebuilds a healthy one.
  pool.on("error", err => {
    console.error("[Database] Idle client error, resetting pool:", err);
    void resetPool();
  });

  return pool;
}

/**
 * Discard the cached pool and drizzle handle.
 *
 * getDb() short-circuits on the cached handle, so without this a pool that
 * died stays cached and every later request fails until the process restarts.
 */
export async function resetPool(): Promise<void> {
  const dying = _pool;
  _pool = null;
  _db = null;
  if (dying) {
    try { await dying.end(); } catch { /* already gone */ }
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function getDb(): Promise<ReturnType<typeof drizzle> | null> {
  const url = resolveUrl();
  if (!url) return null;
  // If a warmed pool exists and is healthy, reuse it straight away.
  if (_db) return _db;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!_pool) _pool = buildPool(url);
      await _pool.query("SELECT 1");
      _db = drizzle(_pool);
      return _db;
    } catch (error) {
      lastError = error;
      // Transient pooler drops deserve a retry; persistent config errors should not.
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("terminated") && !message.includes("timeout") && !message.includes("unexpectedly")) break;
      await sleep(500 * (attempt + 1));
      // A dropped pool cannot be reused — rebuild it for the next attempt.
      await resetPool();
    }
  }
  console.warn("[Database] Failed to connect after retries:", lastError);
  return null;
}

/**
 * Warm up the connection pool eagerly at boot so requests don't stall behind
 * a fresh TLS handshake to the remote database (~1s per connection).
 *
 * On cold production instances the pooler may drop the very first connection
 * attempt, so this keeps retrying in the background (with backoff) until the
 * database responds — never blocking server startup.
 */
export function warmDb() {
  void (async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const db = await getDb();
      if (db) return;
      await sleep(2000 * (attempt + 1));
    }
  })();
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: [users.openId],
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// TODO: add feature queries here as your schema grows.
