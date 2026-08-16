import { Pool } from "pg";
const url = process.env.SUPABASE_DATABASE_URL_B64 ? Buffer.from(process.env.SUPABASE_DATABASE_URL_B64, "base64").toString() : process.env.DATABASE_URL;
const pool = new Pool({ connectionString: url, max: 8, min: 1, idleTimeoutMillis: 30000, keepAlive: true, keepAliveInitialDelayMillis: 10000, ssl: url.startsWith("postgres") ? { rejectUnauthorized: false } : undefined });
await pool.query("SELECT 1");
const t0 = Date.now();
const Q = (q) => pool.query(q);
const tasks = [
  ["floors", Q(`SELECT * FROM floors ORDER BY "sortOrder", id`)],
  ["ended sessions", Q(`SELECT * FROM sessions WHERE status='ended' AND "endedAt" >= NOW() - INTERVAL '1 day'`)],
  ["active today", Q(`SELECT "machineId","startedAt","pausedSeconds","endedAt" FROM sessions WHERE status='active' AND "startedAt" >= NOW() - INTERVAL '1 day'`)],
  ["machines", Q(`SELECT * FROM machines`)],
  ["waiting", Q(`SELECT * FROM waiting_list WHERE "joinedAt" >= NOW() - INTERVAL '1 day'`)],
];
const results = await Promise.all(tasks.map(([name, p]) => p.then(r => [name, r.rows.length, Date.now() - t0])));
console.log("ALL DONE at", Date.now() - t0, "ms");
for (const [name, n, at] of results) console.log(`${name}: ${n} rows @ ${at}ms`);
await pool.end();
