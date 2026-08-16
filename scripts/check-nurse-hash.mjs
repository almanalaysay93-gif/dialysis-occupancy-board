// Compare the documented nurse.skti-main password (Nurse1234) against the
// stored hash/salt using the same sha256(salt+password) scheme as staffAuth.ts.
// Inherits DATABASE_URL from the dev server process env so no .env file is touched.
import { createHash } from "node:crypto";
import postgres from "postgres";

const parent = process.env.PARENT_PID
  ? `/proc/${process.env.PARENT_PID}/environ`
  : null;
if (parent) {
  const fs = await import("node:fs");
  for (const entry of fs.readFileSync(parent, "utf8").split("\0")) {
    const eq = entry.indexOf("=");
    if (eq > 0) process.env[entry.slice(0, eq)] ??= entry.slice(eq + 1);
  }
}

const connUrl =
  (process.env.SUPABASE_DATABASE_URL_B64
    ? Buffer.from(process.env.SUPABASE_DATABASE_URL_B64, "base64").toString()
    : "") ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.DATABASE_URL;
const sql = postgres(connUrl, {
  ssl: process.env.DATABASE_URL?.includes("pooler") ? { rejectUnauthorized: false } : false,
});
const rows = await sql`SELECT "passwordHash", "passwordSalt" FROM staff_accounts WHERE username = 'nurse.skti-main'`;
if (!rows.length) {
  console.error("nurse.skti-main account missing!");
  await sql.end();
  process.exit(1);
}
const { passwordHash, passwordSalt } = rows[0];
console.log("salt:", passwordSalt);
console.log("hash:", passwordHash);

const hash = (salt, password) =>
  createHash("sha256").update(salt + password).digest("hex");

for (const pw of ["Nurse1234"]) {
  const computed = hash(passwordSalt, pw);
  console.log(`password "${pw}" -> match:`, computed === passwordHash);
  if (computed !== passwordHash) console.log("  computed:", computed);
}
const candidates = ["nurse1234", "Nurse1234!", "Nurse12345", "nurse1234!"];
for (const pw of candidates) {
  console.log(`candidate "${pw}" -> match:`, hash(passwordSalt, pw) === passwordHash);
}
await sql.end();
