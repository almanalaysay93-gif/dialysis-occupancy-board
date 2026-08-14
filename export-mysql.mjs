import mysql from "mysql2/promise";
import fs from "fs";
const conn = await mysql.createConnection(process.env.DATABASE_URL);
const tables = ["floors","machines","sessions","waiting_list","staff_accounts"];
const out = {};
for (const t of tables) {
  const [rows] = await conn.query(`SELECT * FROM ${t}`);
  out[t] = rows;
  console.log(t, rows.length, "rows");
}
fs.writeFileSync("/home/ubuntu/mysql-export.json", JSON.stringify(out, null, 1));
await conn.end();
