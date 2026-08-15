console.log("dev nonce:", JSON.stringify(process.env.MIGRATE_NONCE));
console.log("b64 set:", !!process.env.SUPABASE_DATABASE_URL_B64);
console.log("supabase url set:", !!process.env.SUPABASE_DATABASE_URL);
if (process.env.SUPABASE_DATABASE_URL_B64) {
  const d = Buffer.from(process.env.SUPABASE_DATABASE_URL_B64, "base64").toString("utf8");
  console.log("b64 decoded host:", d.replace(/:[^@]+@/, ":***@"));
}
