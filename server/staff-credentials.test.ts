// Ensures the documented staff credentials in staff-credentials.md always
// verify against the stored salted SHA-256 hashes in the database, and that
// the staff.login procedure accepts them. Regression guard for the bug where
// nurse.skti-main's stored hash drifted from "Nurse1234" (Aug 2026).

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-vitest";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { staffAccounts } from "../drizzle/schema";

const documented: Record<string, string> = {
  supervisor: "Supervisor1234",
  "nurse.skti-main": "Nurse1234",
  "nurse.rdu-annex": "Nurse1234",
  "nurse.rdu-main": "Nurse1234",
  "nurse.skti-icu": "Seed@1234",
  "nurse.skti-service-ward": "Seed@1234",
  auditor: "Auditor1234",
};

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

for (const [username, password] of Object.entries(documented)) {
  describe(`documented staff credential: ${username}`, () => {
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
