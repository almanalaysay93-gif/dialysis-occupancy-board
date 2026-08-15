import postgres from "postgres";
const url = process.env.SUPABASE_URL;
const sql = postgres(url, { max: 1 });
const rows = await sql`SELECT id, "username", "displayName", role, "passwordSalt", "passwordHash", active FROM staff_accounts WHERE username = 'auditor'`;
console.log(JSON.stringify(rows, null, 2));
await sql.end();
