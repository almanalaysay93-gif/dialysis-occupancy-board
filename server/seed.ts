import "dotenv/config";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { getDb } from "./db";
import { resolveDatabaseUrl } from "./_core/database-url";
import { floors, machines, staffAccounts } from "../drizzle/schema";
import { hashWithSalt } from "./staffAuth";

/**
 * Bring an empty database up to the live layout: five boards, their machines
 * and the staff logins. Safe to re-run — every step skips rows that
 * already exist, so it never overwrites production data or resets a password.
 *
 * Run with: npm run db:seed
 */

const BOARDS = [
  { code: "F1", name: "SKTI Main", sortOrder: 1, prefix: "HD", count: 100 },
  { code: "F2", name: "RDU Annex", sortOrder: 2, prefix: "RA", count: 36 },
  { code: "F3", name: "RDU Main", sortOrder: 3, prefix: "RM", count: 24 },
  { code: "F4", name: "SKTI ICU", sortOrder: 4, prefix: "IC", count: 0 },
  { code: "F5", name: "SKTI Service Ward", sortOrder: 5, prefix: "SW", count: 0 },
];

const STAFF = [
  { username: "supervisor", displayName: "SKTI Supervisor", role: "supervisor" as const, board: null },
  { username: "nurse.skti-main", displayName: "Nurse · SKTI Main", role: "nurse" as const, board: "F1" },
  { username: "nurse.rdu-annex", displayName: "Nurse · RDU Annex", role: "nurse" as const, board: "F2" },
  { username: "nurse.rdu-main", displayName: "Nurse · RDU Main", role: "nurse" as const, board: "F3" },
  { username: "nurse.skti-icu", displayName: "Nurse · SKTI ICU", role: "nurse" as const, board: "F4" },
  { username: "nurse.skti-service-ward", displayName: "Nurse · SKTI Service Ward", role: "nurse" as const, board: "F5" },
];

/** Env override (SEED_PASSWORD_SUPERVISOR, SEED_PASSWORD_NURSE_SKTI_MAIN, …) or a random one. */
function passwordFor(username: string): { password: string; generated: boolean } {
  const key = `SEED_PASSWORD_${username.toUpperCase().replace(/[.\-]/g, "_")}`;
  const fromEnv = process.env[key];
  if (fromEnv) return { password: fromEnv, generated: false };
  return { password: randomBytes(9).toString("base64url"), generated: true };
}

async function main() {
  const db = await getDb();
  if (!db) {
    const resolved = resolveDatabaseUrl();
    console.error(resolved.url !== null
      ? `Database unreachable via ${resolved.source} — nothing to seed.`
      : `Cannot seed: ${resolved.reason}`);
    process.exit(1);
  }

  const floorIdByCode = new Map<string, number>();

  for (const board of BOARDS) {
    const existing = await db.select().from(floors).where(eq(floors.code, board.code)).limit(1);
    let floorId = existing[0]?.id;
    if (!floorId) {
      const inserted = await db
        .insert(floors)
        .values({ code: board.code, name: board.name, sortOrder: board.sortOrder })
        .returning({ id: floors.id });
      floorId = inserted[0].id;
      console.log(`+ board ${board.name} (${board.code})`);
    } else {
      console.log(`· board ${board.name} already present`);
    }
    floorIdByCode.set(board.code, floorId);

    const present = await db
      .select({ label: machines.label })
      .from(machines)
      .where(eq(machines.floorId, floorId));
    const labels = new Set(present.map(m => m.label));

    const missing = [];
    for (let i = 1; i <= board.count; i++) {
      const label = `${board.prefix}-${String(i).padStart(3, "0")}`;
      if (labels.has(label)) continue;
      missing.push({ label, location: board.name, floorId, sortOrder: i });
    }
    if (missing.length > 0) {
      await db.insert(machines).values(missing);
      console.log(`+ ${missing.length} machines on ${board.name}`);
    } else {
      console.log(`· ${board.name} already has its ${board.count} machines`);
    }
  }

  const credentials: string[] = [];
  for (const account of STAFF) {
    const existing = await db
      .select({ id: staffAccounts.id })
      .from(staffAccounts)
      .where(eq(staffAccounts.username, account.username))
      .limit(1);
    if (existing.length > 0) {
      console.log(`· account ${account.username} already present (password unchanged)`);
      continue;
    }
    const { password, generated } = passwordFor(account.username);
    const { hash, salt } = hashWithSalt(password);
    await db.insert(staffAccounts).values({
      username: account.username,
      displayName: account.displayName,
      role: account.role,
      assignedFloorId: account.board ? (floorIdByCode.get(account.board) ?? null) : null,
      passwordHash: hash,
      passwordSalt: salt,
    });
    console.log(`+ account ${account.username}`);
    credentials.push(`  ${account.username.padEnd(18)} ${password}${generated ? "  (generated)" : ""}`);
  }

  if (credentials.length > 0) {
    console.log("\nStaff logins — store these now, they are not recoverable:");
    console.log(credentials.join("\n"));
  }
  console.log("\nSeed complete. Guests need no account: use “Enter as Guest”.");
  process.exit(0);
}

main().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
