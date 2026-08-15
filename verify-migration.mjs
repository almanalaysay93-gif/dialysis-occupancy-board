import { Pool } from "pg";
const raw = Buffer.from(process.env.SUPABASE_DATABASE_URL_B64, "base64").toString("utf-8");
const pool = new Pool({ connectionString: raw, ssl: { rejectUnauthorized: false } });
const c = await pool.query(
  "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'staff_accounts'::regclass AND conname = 'staff_accounts_role_check'"
);
const a = await pool.query(
  "SELECT \"username\", \"displayName\", role FROM staff_accounts WHERE \"username\" = 'auditor'"
);
const t = await pool.query(
  "SELECT column_name FROM information_schema.columns WHERE table_name = 'narrative_history' ORDER BY ordinal_position"
);
console.log(JSON.stringify({ constraint: c.rows, auditor: a.rows, historyColumns: t.rows.map(r => r.column_name) }));
process.exit(0);
