import "dotenv/config";
import mysql from "mysql2/promise";

// Seed floors and 160 machines grouped by floor rows:
// Floor 1 (F1): 100 machines HD-001..HD-100
// Floor 2 (F2): 36 machines  HD-101..HD-136
// Floor 3 (F3): 24 machines  HD-137..HD-160
// Any leftover legacy machines (HD-01..HD-16) are removed first.

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Remove legacy machines and any sessions referencing them
await conn.execute("DELETE FROM sessions WHERE machineId IN (SELECT id FROM machines)");
await conn.execute("DELETE FROM machines");

await conn.execute("DELETE FROM floors");
await conn.execute(
  "INSERT INTO floors (code, name, sortOrder) VALUES ('F1', 'Floor 1', 1), ('F2', 'Floor 2', 2), ('F3', 'Floor 3', 3)"
);
// Use real auto-increment IDs so floorId foreign references are valid
const [floors] = await conn.execute("SELECT id, code FROM floors ORDER BY code");
const codeToId = Object.fromEntries(floors.map(f => [f.code, f.id]));
const floorIds = [codeToId.F1, codeToId.F2, codeToId.F3];

let n = 1;
const floorCounts = [100, 36, 24];
const rows = [];
floorIds.forEach((fid, i) => {
  for (let k = 0; k < floorCounts[i]; k += 1) {
    const label = `HD-${String(n).padStart(3, "0")}`;
    const row = Math.floor(k / 4) + 1;
    const pos = (k % 4) + 1;
    rows.push([label, `Row ${row} · Pos ${pos}`, fid, n]);
    n += 1;
  }
});

await conn.execute(
  `INSERT INTO machines (label, location, floorId, sortOrder) VALUES ${rows
    .map(() => "(?, ?, ?, ?)")
    .join(",")}`,
  rows.flatMap(r => r)
);

const [count] = await conn.execute(
  "SELECT floorId, COUNT(*) AS c FROM machines GROUP BY floorId"
);
console.log("Machine counts by floor:", JSON.stringify(count));
const [machineCount] = await conn.execute("SELECT COUNT(*) AS c FROM machines");
console.log("Total machines:", machineCount[0].c);
await conn.end();
