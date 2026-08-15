import postgres from "postgres";
import { randomBytes, createHash } from "crypto";

const url = 'postgresql://postgres.oaxgmvsxzfkyqzmfwxtn:alshie121522!@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';
const sql = postgres(url, { max: 1, ssl: { rejectUnauthorized: false } });

const username = "nurse.skti-main";
const password = "Seed@1234";

const rows = await sql`SELECT id, username, role FROM staff_accounts WHERE username = ${username}`;
console.log("account:", rows);

if (rows.length > 0) {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  const result = await sql`UPDATE staff_accounts SET "passwordHash" = ${hash}, "passwordSalt" = ${salt} WHERE id = ${rows[0].id}`;
  console.log("reset count:", result.count);
} else {
  console.log("no account found");
}

await sql.end();
