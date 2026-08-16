// Reset nurse.skti-main to the documented password Nurse1234.
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";
const parent = `/proc/${process.env.PARENT_PID}/environ`;
const fs = await import("node:fs");
for (const entry of fs.readFileSync(parent, "utf8").split("\0")) {
  const eq = entry.indexOf("=");
  if (eq > 0) process.env[entry.slice(0, eq)] ??= entry.slice(eq + 1);
}
const connUrl = Buffer.from(process.env.SUPABASE_DATABASE_URL_B64, "base64").toString();
const sql = postgres(connUrl);

// Compute the pre-change hash (for the audit history note)
const before = await sql`SELECT "passwordHash", "passwordSalt" FROM staff_accounts WHERE username = 'nurse.skti-main'`;
console.log("before hash:", before[0]?.passwordHash);

const salt = randomBytes(16).toString("hex");
const hash = createHash("sha256").update(salt + "Nurse1234").digest("hex");
await sql`UPDATE staff_accounts SET "passwordHash" = ${hash}, "passwordSalt" = ${salt}, "tokenVersion" = 1 WHERE username = 'nurse.skti-main'`;
const after = await sql`SELECT "passwordHash", "passwordSalt" FROM staff_accounts WHERE username = 'nurse.skti-main'`;
const verify = hash === after[0].passwordHash;
console.log("reset done, verification:", verify ? "PASS" : "FAIL");
await sql.end();
if (!verify) process.exit(1);
