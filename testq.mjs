import mysql from "mysql2/promise";
const c = await mysql.createConnection(process.env.DATABASE_URL);
const [db] = await c.query("SELECT DATABASE()"); console.log("db:", db[0]["DATABASE()"]);
try {
  const [rows] = await c.query("SELECT id, label, COALESCE(isolationTag, 'clean') AS isolationTag FROM machines LIMIT 2");
  console.log("COALESCE query OK:", rows);
} catch (e) { console.log("COALESCE ERROR:", e.message); }
try {
  const [rows] = await c.query("SELECT id, label FROM machines LIMIT 2");
  console.log("plain query OK:", JSON.stringify(rows).slice(0,150));
} catch (e) { console.log("plain ERROR:", e.message); }
await c.end();
