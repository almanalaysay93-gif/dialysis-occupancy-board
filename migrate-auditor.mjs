import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// This script is run with tsx/esbuild transpile from the local file, but to
// avoid module issues it is written as plain JS for node-postgres only.
// The password hashing matches server/staffAuth.ts (sha256(salt+password)).
import { createHash, randomBytes } from "crypto";

const raw = Buffer.from(process.env.SUPABASE_DATABASE_URL_B64 ?? "", "base64").toString("utf-8");
if (!raw) throw new Error("SUPABASE_DATABASE_URL_B64 not set");
const pool = new Pool({ connectionString: raw, ssl: { rejectUnauthorized: false } });
const db = drizzle(pool);

function hashPassword(password, salt) {
  return createHash("sha256").update(salt + password).digest("hex");
}
function makeCred(password) {
  const salt = randomBytes(16).toString("hex");
  return { passwordHash: hashPassword(password, salt), passwordSalt: salt };
}

// 1. Role is a varchar with a CHECK constraint (no native enum type).
//    Recreate the constraint to include 'auditor'.
await pool.query(`
  ALTER TABLE staff_accounts DROP CONSTRAINT IF EXISTS staff_accounts_role_check;
  ALTER TABLE staff_accounts ADD CONSTRAINT staff_accounts_role_check
    CHECK (role IN ('nurse', 'supervisor', 'guest', 'auditor'));
`);

// 2. Create the narrative_history audit table.
await pool.query(`
  CREATE TABLE IF NOT EXISTS narrative_history (
    id serial PRIMARY KEY,
    narrative_id integer,
    floor_id integer NOT NULL,
    report_date varchar(10) NOT NULL,
    period_key varchar(16) NOT NULL,
    action varchar(10) NOT NULL CHECK (action IN ('create','update','delete')),
    actor varchar(64) NOT NULL,
    actor_role varchar(32),
    body_snapshot text,
    created_at timestamp NOT NULL DEFAULT now()
  );
`);

// 3. Seed the auditor account if absent.
const { rows: existing } = await pool.query(
  `SELECT id FROM staff_accounts WHERE username = 'auditor'`
);
// Keep the serial sequence in sync with existing rows (it was out of sync).
await pool.query(`
  SELECT setval('staff_accounts_id_seq', COALESCE((SELECT MAX("id") FROM staff_accounts), 0) + 1, false)
`);

if (existing.length === 0) {
  const cred = makeCred(process.env.AUDITOR_PASSWORD ?? "Audit1234");
  await pool.query(
    `INSERT INTO staff_accounts ("username", "displayName", "role", "passwordHash", "passwordSalt", "active")
     VALUES ('auditor', 'Audit Viewer', 'auditor', $1, $2, true)`,
    [cred.passwordHash, cred.passwordSalt]
  );
  console.log("Seeded auditor account (auditor / " + (process.env.AUDITOR_PASSWORD ?? "Audit1234") + ")");
} else {
  console.log("Auditor account already exists (id " + existing[0].id + ")");
}

console.log("Migration complete.");
process.exit(0);
