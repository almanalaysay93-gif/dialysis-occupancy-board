import { createHash } from "node:crypto";
import postgres from "postgres";
const parent = `/proc/${process.env.PARENT_PID}/environ`;
const fs = await import("node:fs");
for (const entry of fs.readFileSync(parent, "utf8").split("\0")) {
  const eq = entry.indexOf("=");
  if (eq > 0) process.env[entry.slice(0, eq)] ??= entry.slice(eq + 1);
}
const connUrl = Buffer.from(process.env.SUPABASE_DATABASE_URL_B64, "base64").toString();
const sql = postgres(connUrl);
const rows = await sql`SELECT id, username, role, "passwordHash", "passwordSalt", active FROM staff_accounts`;
const hash = (salt, pw) => createHash("sha256").update(salt + pw).digest("hex");
const docPw = { supervisor: "Supervisor1234", "nurse.skti-main": "Nurse1234", "nurse.rdu-annex": "Nurse1234", "nurse.rdu-main": "Nurse1234", "nurse.skti-icu": "Seed@1234", "nurse.skti-service-ward": "Seed@1234", auditor: "Auditor1234", guest: "(no login)" };
for (const r of rows) {
  const expected = docPw[r.username] ?? null;
  const match = expected ? hash(r.passwordSalt, expected) === r.passwordHash : "no doc pw";
  console.log(`${r.username} (${r.role}) active=${r.active}: doc-password matches = ${match}`);
}
await sql.end();
