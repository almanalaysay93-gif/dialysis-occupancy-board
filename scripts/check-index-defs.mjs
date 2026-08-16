import fs from "fs";
import pg from "pg";
const pid = parseInt(process.env.PARENT_PID, 10);
const env = {};
fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").forEach(line => {
  const i = line.indexOf("=");
  if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
});
const url = env.SUPABASE_DATABASE_URL_B64 ? Buffer.from(env.SUPABASE_DATABASE_URL_B64, "base64").toString() : env.SUPABASE_DATABASE_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
const r = await c.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='sessions' AND indexname IN ('idx_sessions_machine_active','idx_sessions_status')`);
for (const row of r.rows) console.log(row.indexname, "->", row.indexdef);
const s = await c.query(`SELECT count(*) FROM sessions`);
console.log("sessions rows:", s.rows[0].count);
await c.end();
