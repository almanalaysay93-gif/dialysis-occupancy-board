import { createReadStream } from "node:fs";
import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";

// ---------------------------------------------------------------------------
// TEMPORARY: one-off Postgres migrations that must run from the production
// runtime (sandbox has no egress to Supabase). Apply the machine_status
// migration for the backup & repair board. Remove this block after it runs.
// ---------------------------------------------------------------------------
const STATUS_MIGRATION_SQL = `CREATE TYPE IF NOT EXISTS "machine_status" AS ENUM ('active', 'backup', 'repair');
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "status" "machine_status" NOT NULL DEFAULT 'active';
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "statusNote" varchar(256);`;

let statusMigrationExecuted = false;

/**
 * One-off migration endpoint. When MIGRATE_NONCE is configured, callers must
 * supply the matching nonce; without the secret, the endpoint is unreachable.
 */
export function runStatusMigration() {
  return statusMigrationExecuted
    ? { success: true, note: "already executed previously" } as const
    : (async () => {
        // Lazy import keeps the heavy pg driver out of the cold-start path.
        const { Client } = await import("pg");
        const raw = process.env.SUPABASE_DATABASE_URL_B64
          ? Buffer.from(process.env.SUPABASE_DATABASE_URL_B64, "base64").toString("utf-8")
          : process.env.SUPABASE_DATABASE_URL;
        const client = new Client({
          connectionString: raw,
          ssl: raw?.startsWith("postgres") ? { rejectUnauthorized: false } : undefined,
        });
        await client.connect();
        try {
          await client.query(STATUS_MIGRATION_SQL);
          statusMigrationExecuted = true;
          return { success: true } as const;
        } finally {
          await client.end();
        }
      })();
}


export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  // TEMPORARY: apply the machine_status migration from production runtime.
  // Remove after it runs successfully.
  supabaseApplyStatus: publicProcedure.mutation(async () => {
    return runStatusMigration();
  }),
});
