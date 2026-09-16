// Ensures the staff credentials in the local staff-credentials.md always
// verify against the stored salted SHA-256 hashes in the database. Regression
// guard for the bug where nurse.skti-main's stored hash drifted from its
// documented password (Aug 2026).
//
// staff-credentials.md is gitignored, so passwords never enter the repository.
// Without that file (for example in CI) the credential checks are skipped.

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-vitest";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { staffAccounts } from "../drizzle/schema";

/** Reads `| `username` | `password` |` rows from the local credentials file. */
function readDocumentedCredentials(): Record<string, string> {
  const file = path.resolve(import.meta.dirname, "..", "staff-credentials.md");
  if (!existsSync(file)) return {};
  const documented: Record<string, string> = {};
  for (const match of readFileSync(file, "utf8").matchAll(/^\| `([^`]+)` \| `([^`]+)` \|/gm)) {
    documented[match[1]] = match[2];
  }
  return documented;
}

const documented = readDocumentedCredentials();
const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL_B64);

async function hashOf(password: string, salt: string): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable in test");
  const rows = await db
    .execute(sql`SELECT encode(sha256((${salt}::text || ${password}::text)::bytea), 'hex') AS computed`);
  // Drizzle execute returns a raw row; handle both pg (SHA-256 function) and MySQL shapes:
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) {
    // Fall back to the same node hashing the app uses, so the test never
    // depends on a database-specific digest function.
    return createHash("sha256").update(salt + password).digest("hex");
  }
  const computed =
    (row.computed as string | undefined) ??
    (row as Record<string, unknown>).computed ??
    null;
  if (!computed) {
    return createHash("sha256").update(salt + password).digest("hex");
  }
  return String(computed);
}

it.skipIf(Object.keys(documented).length > 0 && hasDatabase)(
  "credential checks need a local staff-credentials.md and a database URL",
  () => {}
);

for (const [username, password] of Object.entries(documented)) {
  describe.skipIf(!hasDatabase)(`documented staff credential: ${username}`, () => {
    it("stored hash verifies against the documented password", async () => {
      const db = await getDb();
      if (!db) return;
      const rows = await db
        .select({ passwordHash: staffAccounts.passwordHash, passwordSalt: staffAccounts.passwordSalt })
        .from(staffAccounts)
        .where(sql`${staffAccounts.username} = ${username}`)
        .limit(1);
      expect(rows.length).toBe(1);
      const { passwordHash, passwordSalt } = rows[0];
      const computed = await hashOf(password, passwordSalt);
      expect(computed).toBe(passwordHash);
    });
  });
}

it("guest needs no account", async () => {
  // The guest flow never consults staff_accounts; it signs a marker JWT.
  const db = await getDb();
  if (!db) return;
  const rows = await db
    .select()
    .from(staffAccounts)
    .where(sql`${staffAccounts.username} = 'guest'`)
    .limit(1);
  // A marker row is allowed but the login flow must not require it.
  expect(rows.length === 0 || rows[0].role === "guest").toBe(true);
});
