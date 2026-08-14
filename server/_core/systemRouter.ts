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
    // TEMPORARY: return masked Supabase URL for secret debugging (remove after)
  supabaseMask: publicProcedure.query(() => {
    const url = process.env.SUPABASE_DATABASE_URL ?? "";
    if (!url) return { set: false } as const;
    try {
      const u = new URL(url);
      return { set: true, proto: u.protocol, user: u.username, host: u.host, port: u.port, pathname: u.pathname, pwdLen: u.password.length } as const;
    } catch { return { set: true, parseError: true } as const; }
  }),

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
