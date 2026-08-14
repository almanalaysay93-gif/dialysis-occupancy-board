import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";

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

  // TEMPORARY (migration probe): verify the production runtime can reach Supabase Postgres.
  supabasePing: publicProcedure.query(async () => {
    const url = process.env.SUPABASE_DATABASE_URL ?? "";
    if (!url) return { ok: false, error: "SUPABASE_DATABASE_URL not set" } as const;
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 12000 });
    try {
      const r = await pool.query("SELECT version()");
      return { ok: true, version: r.rows[0].version } as const;
    } catch (e) {
      return { ok: false, error: (e as Error).message } as const;
    } finally {
      await pool.end();
    }
  }),

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
});
