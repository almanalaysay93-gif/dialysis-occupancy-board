import postgres from "postgres";
import crypto from "crypto";

// Environment variables set in this session (see session-notes).
const url = process.env.SUPABASE_URL;
if (!url) {
  console.error("SUPABASE_URL not set");
  process.exit(1);
}
const sql = postgres(url, { max: 1 });

// Reuse the app's password hashing convention (sha256 of salt + password).
function hashWithSalt(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.createHash("sha256").update(salt + password).digest("hex");
  return { salt, hash };
}

async function main() {
  // Check if auditor account already exists
  const existing = await sql`SELECT id FROM staff_accounts WHERE username = 'auditor' LIMIT 1`;
  const password = process.env.AUDITOR_PASSWORD || "Auditor1234";
  if (existing.length > 0) {
    console.log("Auditor account already exists with id", existing[0].id, "— resetting password to", password);
    const { salt, hash } = hashWithSalt(password);
    await sql`UPDATE staff_accounts SET "passwordSalt" = ${salt}, "passwordHash" = ${hash} WHERE username = 'auditor'`;
  } else {
    const { salt, hash } = hashWithSalt(password);
    const res = await sql`
      INSERT INTO staff_accounts ("username", "displayName", "role", "passwordHash", "passwordSalt", "active")
      VALUES ('auditor', 'Audit Viewer', 'auditor', ${hash}, ${salt}, true)
      RETURNING id
    `;
    console.log("Created auditor account id", res[0].id, "with password", password);
  }

  // Verify login works through the dev server
  const body = JSON.stringify({ username: "auditor", password: process.env.AUDITOR_PASSWORD || "Auditor1234" });
  const res = await fetch("http://localhost:3000/api/trpc/staff.login?batch=1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([{ json: { username: "auditor", password: process.env.AUDITOR_PASSWORD || "Auditor1234" } }]),
  });
  const data = await res.json();
  console.log("Login status:", res.status, JSON.stringify(data).slice(0, 300));
  await sql.end();
}

main().catch(e => {
  console.error(e);
  sql.end();
  process.exit(1);
});
