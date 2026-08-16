import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

function resolveUrl(): string | null {
  // Supabase Postgres URL is stored base64-encoded (SUPABASE_DATABASE_URL_B64)
  // so that the platform's secret storage cannot mangle the "postgresql://" URI.
  const raw = process.env.SUPABASE_DATABASE_URL_B64;
  if (raw) {
    try {
      return Buffer.from(raw, "base64").toString("utf-8");
    } catch {
      // fall through to DATABASE_URL below
    }
  }
  return process.env.DATABASE_URL ?? null;
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db) {
    const url = resolveUrl();
    if (url) {
      try {
        const pool = new Pool({
          connectionString: url,
          max: 8,
          min: 1,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 15_000,
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
        await pool.query("SELECT 1");
        _db = drizzle(pool);
      } catch (error) {
        console.warn("[Database] Failed to connect:", error);
        _db = null;
      }
    }
  }
  return _db;
}

/**
 * Warm up the connection pool eagerly: establish the minimum pool of
 * connections at boot so the first report-page requests don't each stall
 * behind a fresh TLS handshake to the remote database (~1s per connection).
 */
export async function warmDb() {
  try {
    await getDb();
  } catch {
    // getDb already logs and returns null when unavailable.
  }
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
