import fs from "fs";
import pg from "pg";
const pid = parseInt(process.env.PARENT_PID, 10);
const env = {};
fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").forEach(line => {
  const i = line.indexOf("=");
  if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
});
const url = env.SUPABASE_DATABASE_URL_B64 ? Buffer.from(env.SUPABASE_DATABASE_URL_B64, "base64").toString() : env.SUPABASE_DATABASE_URL;
console.log("host:", new URL(url).host);
for (let i = 0; i < 5; i++) {
  const t0 = Date.now();
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("SELECT 1");
  const connMs = Date.now() - t0;
  const t1 = Date.now();
  await c.query("SELECT count(*) FROM machines");
  const qMs = Date.now() - t1;
  await c.end();
  console.log(`conn=${connMs}ms query=${qMs}ms`);
}
