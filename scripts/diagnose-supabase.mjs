/**
 * Read-only Supabase connection diagnostic.
 *
 * Walks the same resolution path as server/db.ts, then stops at the first
 * layer that actually fails, so "database not available" resolves to a
 * specific cause instead of a shrug. Never prints the password.
 *
 * Run with the same environment the failing process has:
 *   node scripts/diagnose-supabase.mjs
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import pkg from 'pg';

const { Client } = pkg;

let failed = false;
const line = (mark, label, detail) => console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`);
const pass = (l, d) => line('PASS', l, d);
const warn = (l, d) => line('WARN', l, d);
const fail = (l, d) => { failed = true; line('FAIL', l, d); };

console.log('Supabase diagnostic — read-only, no writes.\n');

/* ---- 1. Which variables are present ---- */
const b64 = process.env.SUPABASE_DATABASE_URL_B64;
const plain = process.env.DATABASE_URL;
console.log(`1. Environment`);
console.log(`   SUPABASE_DATABASE_URL_B64: ${b64 ? `set (${b64.length} chars)` : 'MISSING'}`);
console.log(`   DATABASE_URL:              ${plain ? `set (${plain.length} chars)` : 'MISSING'}`);
if (!b64 && !plain) {
  fail('no connection variable set', 'server/db.ts resolveUrl() returns null, so getDb() returns null and every route degrades to empty');
  process.exit(1);
}

/* ---- 2. Decode, and detect the silent-mangle case (F8) ---- */
console.log(`\n2. URL resolution`);
let url = null;
let source = null;
if (b64) {
  const decoded = Buffer.from(b64, 'base64').toString('utf-8');
  // Buffer.from never throws on bad base64 — it drops invalid chars — so the
  // only way to catch a mangled secret is to re-encode and compare.
  const roundTrip = Buffer.from(decoded, 'utf-8').toString('base64');
  const normalize = s => s.replace(/\s/g, '').replace(/=+$/, '');
  if (normalize(roundTrip) !== normalize(b64)) {
    fail('SUPABASE_DATABASE_URL_B64 is not clean base64',
      'decode dropped characters; the secret was truncated or whitespace-mangled in storage');
  } else if (!/^postgres(ql)?:\/\//.test(decoded)) {
    fail('decoded value is not a postgres URI', `starts with ${JSON.stringify(decoded.slice(0, 12))}`);
  } else {
    pass('base64 decodes cleanly to a postgres URI');
    url = decoded;
    source = 'SUPABASE_DATABASE_URL_B64';
  }
  if (!url && plain) warn('falling back to DATABASE_URL', 'server/db.ts would NOT do this — its try/catch never fires (F8)');
}
if (!url && plain) { url = plain; source = source ?? 'DATABASE_URL'; }
if (!url) process.exit(1);
console.log(`   using ${source}`);

/* ---- 3. Parse and classify the endpoint ---- */
console.log(`\n3. Endpoint`);
let u;
try {
  u = new URL(url);
} catch (e) {
  fail('connection string does not parse as a URI', e.message);
  process.exit(1);
}
const port = u.port || '5432';
const db = u.pathname.replace(/^\//, '') || '(none)';
console.log(`   host ${u.hostname}  port ${port}  db ${db}  user ${u.username || '(none)'}  password ${u.password ? 'set' : 'MISSING'}`);
if (!u.username) fail('no username in connection string');
if (!u.password) fail('no password in connection string');
if (port === '6543') warn('transaction pooler (port 6543)', 'no prepared statements or session state; drizzle-kit migrate needs port 5432');
else if (port === '5432') pass('session/direct port 5432');
if (/\s/.test(url)) fail('connection string contains whitespace', 'a newline in the secret survives base64 and breaks auth');

/* ---- 4. DNS ---- */
console.log(`\n4. DNS`);
try {
  const addrs = await dns.lookup(u.hostname, { all: true });
  pass('resolves', addrs.map(a => a.address).join(', '));
} catch (e) {
  fail('DNS lookup failed', `${e.code ?? ''} ${e.message}`);
  process.exit(1);
}

/* ---- 5. TCP reachability, before TLS or auth muddies the error ---- */
console.log(`\n5. TCP`);
const tcpMs = await new Promise(resolve => {
  const t0 = performance.now();
  const sock = net.createConnection({ host: u.hostname, port: Number(port) });
  const done = v => { sock.destroy(); resolve(v); };
  sock.setTimeout(8000);
  sock.on('connect', () => done(performance.now() - t0));
  sock.on('timeout', () => done(null));
  sock.on('error', () => done(null));
});
if (tcpMs === null) {
  fail('cannot open a TCP socket', 'network egress blocked, project paused, or wrong host/port');
  process.exit(1);
}
pass('connected', `${tcpMs.toFixed(0)} ms`);

/* ---- 6. TLS + auth ---- */
console.log(`\n6. Authentication`);
const client = new Client({
  connectionString: url,
  connectionTimeoutMillis: 8000,
  ssl: { rejectUnauthorized: false },
});
try {
  const t0 = performance.now();
  await client.connect();
  pass('authenticated', `${(performance.now() - t0).toFixed(0)} ms`);
} catch (e) {
  fail('authentication failed', `${e.code ?? ''} ${e.message}`);
  process.exit(1);
}

/* ---- 7. Identity ---- */
console.log(`\n7. Server`);
try {
  const r = await client.query('SELECT current_database() AS db, current_user AS usr, version() AS v');
  const row = r.rows[0];
  pass('reachable', `db=${row.db} user=${row.usr}`);
  console.log(`   ${row.v.split(',')[0]}`);
} catch (e) {
  fail('SELECT failed after connecting', e.message);
}

/* ---- 8. Do the app's tables exist ---- */
console.log(`\n8. Schema`);
const expected = ['users', 'machines', 'floors', 'sessions', 'waiting_list', 'staff_accounts'];
try {
  const r = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)`, [expected]);
  const found = new Set(r.rows.map(x => x.table_name));
  const missing = expected.filter(t => !found.has(t));
  if (missing.length === 0) pass('all core tables present', expected.join(', '));
  else fail('missing tables', missing.join(', '));
} catch (e) {
  fail('could not read information_schema', e.message);
}

/* ---- 9. Migration bookkeeping (F7) ---- */
console.log(`\n9. Migration state`);
try {
  const r = await client.query(
    `SELECT table_schema FROM information_schema.tables WHERE table_name = '__drizzle_migrations'`);
  if (r.rowCount === 0) {
    warn('no __drizzle_migrations table', 'schema was applied by hand (drizzle/manual/*.sql), not by drizzle-kit');
  } else {
    pass('drizzle migration table found', `schema ${r.rows.map(x => x.table_schema).join(', ')}`);
  }
} catch (e) {
  warn('could not check migration table', e.message);
}

/* ---- 10. Connection headroom ---- */
console.log(`\n10. Connections`);
try {
  const r = await client.query(
    `SELECT count(*)::int AS open,
            (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max
       FROM pg_stat_activity WHERE datname = current_database()`);
  const { open, max } = r.rows[0];
  const msg = `${open} open / ${max} max`;
  if (max && open / max > 0.8) fail('connection pool near exhaustion', msg);
  else pass('headroom available', msg);
} catch (e) {
  warn('could not read pg_stat_activity', e.message);
}

await client.end();
console.log(`\n${failed ? 'VERDICT: failures above — fix the first FAIL, then re-run.' : 'VERDICT: connection path is healthy.'}`);
process.exit(failed ? 1 : 0);
