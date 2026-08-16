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
for (const t of ["sessions", "narrative_reports", "waiting_list", "machines"]) {
  const r = await c.query(`SELECT indexname FROM pg_indexes WHERE tablename=$1`, [t]);
  console.log(t, "indexes:", r.rows.map(x => x.indexname).join(", ") || "NONE");
}
await c.end();
