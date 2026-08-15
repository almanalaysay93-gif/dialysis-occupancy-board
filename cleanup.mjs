import postgres from "postgres";
const sql = postgres('postgresql://postgres.oaxgmvsxzfkyqzmfwxtn:alshie121522!@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres', { max: 1, ssl: { rejectUnauthorized: false } });
const d = await sql`DELETE FROM narrative_history WHERE narrative_id = 3`;
console.log("history deleted:", d.count);
const n = await sql`DELETE FROM narrative_reports WHERE id = 3`;
console.log("narrative deleted:", n.count);
await sql.end();
