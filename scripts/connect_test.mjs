import pg from 'pg';
const url = Buffer.from(process.env.B64, 'base64').toString();
const t0 = Date.now();
const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 10000, max: 1 });
try {
  const res = await pool.query('SELECT 1 AS ok');
  console.log('OK first query in', Date.now()-t0, 'ms:', res.rows[0].ok);
} catch(e) {
  console.log('FAILED after', Date.now()-t0, 'ms:', e.message);
}
await pool.end();
