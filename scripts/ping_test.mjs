import pkg from 'pg'; const { Pool } = pkg;
const url = Buffer.from(process.env.SUPABASE_DATABASE_URL_B64, 'base64').toString('utf-8');
const p = new Pool({ connectionString: url, max: 4, min: 0, connectionTimeoutMillis: 8000, keepAlive: true, keepAliveInitialDelayMillis: 5000, ssl: { rejectUnauthorized: false } });
for (let i = 0; i < 8; i++) {
  const t0 = performance.now();
  try { await p.query('SELECT 1'); console.log(`run ${i}: ${(performance.now()-t0).toFixed(0)} ms`); }
  catch (e) { console.log(`run ${i}: ERROR ${(performance.now()-t0).toFixed(0)}ms ${e.message}`); }
  await new Promise(r => setTimeout(r, 25000));
}
await p.end();
