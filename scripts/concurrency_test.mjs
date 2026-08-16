// Compare sequential vs parallel DB queries on the production pooler using
// the same Pool config the app uses. Shows whether the pooler serializes
// queries (1 connection) so concurrent queries don't overlap.
import { Pool } from "pg";

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const envFile = "";
  let url = process.env.SUPABASE_DATABASE_URL_B64
    ? Buffer.from(process.env.SUPABASE_DATABASE_URL_B64, "base64").toString("utf8")
    : process.env.DATABASE_URL || "";
  if (false) {
    const m = envFile.match(/SUPABASE_DATABASE_URL_B64=(.+)/);
    if (m) url = Buffer.from(m[1], "base64").toString("utf8");
  }
  if (!url) {
    console.log("no db url");
    return;
  }
  const pool = new Pool({
    connectionString: url,
    max: 8,
    min: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    ssl: url.startsWith("postgres") ? { rejectUnauthorized: false } : undefined,
  });
  // warm
  await pool.query("SELECT 1");

  const query = () => pool.query("SELECT count(*) FROM sessions").then(r => r.rows[0].count);

  // Sequential
  const t0 = Date.now();
  const seq = [];
  for (let i = 0; i < 4; i++) seq.push(await query());
  const seqMs = Date.now() - t0;

  // Parallel
  const t1 = Date.now();
  const par = await Promise.all([query(), query(), query(), query()]);
  const parMs = Date.now() - t1;

  console.log(`sequential 4 queries: ${seqMs}ms`);
  console.log(`parallel 4 queries:   ${parMs}ms`);
  console.log("counts:", seq, par);
  await pool.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
