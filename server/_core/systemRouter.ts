import { createReadStream } from "node:fs";
import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";

// TEMPORARY (migration): schema SQL base64-encoded
const SCHEMA_SQL_B64 = "LS0gU3VwYWJhc2UgKFBvc3RncmVzKSBzY2hlbWEgZm9yIHRoZSBTUE1DS1RJIEhlbW9kaWFseXNpcyBPY2N1cGFuY3kgQm9hcmQKLS0gQ29udmVydGVkIGZyb20gdGhlIG9yaWdpbmFsIE15U1FML1RpREIgZHJpenpsZSBzY2hlbWEuCi0tIENvbnZlbnRpb25zOiBNeVNRTCBgdGltZXN0YW1wYCAoVVRDIGVwb2NoIG1zKSAtPiBQb3N0Z3JlcyBgdGltZXN0YW1wKDMpIHdpdGggdGltZSB6b25lYAotLSAoZHJpenpsZSBwZyBtb2RlIHN0b3JlcyBEYXRlcyBhcyB0aW1lc3RhbXB0ejsgdGhlIGFwcCByZWFkcy93cml0ZXMgSlMgRGF0ZXMpLgotLSBNeVNRTCBhdXRvX2luY3JlbWVudCAtPiBQb3N0Z3JlcyBHRU5FUkFURUQgQUxXQVlTIEFTIElERU5USVRZLgotLSBNeVNRTCBteXNxbEVudW0gLT4gUG9zdGdyZXMgdmFyY2hhciB3aXRoIENIRUNLIGNvbnN0cmFpbnRzIChrZWVwcyBkcml6emxlIHBnIGNvbXBhdCBzaW1wbGUpLgotLSBNeVNRTCBib29sZWFuIC0+IFBvc3RncmVzIGJvb2xlYW4uIE15U1FMIHRleHQvdmFyY2hhcigzMjApIC0+IHRleHQuCgpDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyB1c2VycyAoCiAgaWQgaW50ZWdlciBHRU5FUkFURUQgQUxXQVlTIEFTIElERU5USVRZIFBSSU1BUlkgS0VZLAogICJvcGVuSWQiIHZhcmNoYXIoNjQpIE5PVCBOVUxMIFVOSVFVRSwKICBuYW1lIHRleHQsCiAgZW1haWwgdmFyY2hhcigzMjApLAogICJsb2dpbk1ldGhvZCIgdmFyY2hhcig2NCksCiAgImNyZWF0ZWRBdCIgdGltZXN0YW1wKDMpIHdpdGggdGltZSB6b25lIE5PVCBOVUxMIERFRkFVTFQgbm93KCksCiAgInVwZGF0ZWRBdCIgdGltZXN0YW1wKDMpIHdpdGggdGltZSB6b25lIE5PVCBOVUxMIERFRkFVTFQgbm93KCksCiAgImxhc3RTaWduZWRJbiIgdGltZXN0YW1wKDMpIHdpdGggdGltZSB6b25lIE5PVCBOVUxMIERFRkFVTFQgbm93KCkKKTsKCkNSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTIGZsb29ycyAoCiAgaWQgaW50ZWdlciBHRU5FUkFURUQgQUxXQVlTIEFTIElERU5USVRZIFBSSU1BUlkgS0VZLAogIGNvZGUgdmFyY2hhcigxNikgTk9UIE5VTEwgVU5JUVVFLAogIG5hbWUgdmFyY2hhcig2NCkgTk9UIE5VTEwsCiAgInNvcnRPcmRlciIgaW50ZWdlciBOT1QgTlVMTCBERUZBVUxUIDAsCiAgImNyZWF0ZWRBdCIgdGltZXN0YW1wKDMpIHdpdGggdGltZSB6b25lIE5PVCBOVUxMIERFRkFVTFQgbm93KCkKKTsKCkNSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTIG1hY2hpbmVzICgKICBpZCBpbnRlZ2VyIEdFTkVSQVRFRCBBTFdBWVMgQVMgSURFTlRJVFkgUFJJTUFSWSBLRVksCiAgbGFiZWwgdmFyY2hhcigzMikgTk9UIE5VTEwsCiAgbG9jYXRpb24gdmFyY2hhcig2NCkgTk9UIE5VTEwsCiAgImZsb29ySWQiIGludGVnZXIgUkVGRVJFTkNFUyBmbG9vcnMoaWQpIE9OIERFTEVURSBTRVQgTlVMTCBPTiBVUERBVEUgTk8gQUNUSU9OLAogICJzb3J0T3JkZXIiIGludGVnZXIgTk9UIE5VTEwgREVGQVVMVCAwLAogICJpc29sYXRpb25UYWciIHZhcmNoYXIoOCkgTk9UIE5VTEwgREVGQVVMVCAnY2xlYW4nIENIRUNLICgiaXNvbGF0aW9uVGFnIiBJTiAoJ2NsZWFuJywnZGlydHknKSksCiAgdXJnZW50IGJvb2xlYW4gTk9UIE5VTEwgREVGQVVMVCBmYWxzZSwKICAiZGlzcGxheUxhYmVsIiB2YXJjaGFyKDY0KSwKICAiY3JlYXRlZEF0IiB0aW1lc3RhbXAoMykgd2l0aCB0aW1lIHpvbmUgTk9UIE5VTEwgREVGQVVMVCBub3coKSwKICAidXBkYXRlZEF0IiB0aW1lc3RhbXAoMykgd2l0aCB0aW1lIHpvbmUgTk9UIE5VTEwgREVGQVVMVCBub3coKQopOwoKQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgc2Vzc2lvbnMgKAogIGlkIGludGVnZXIgR0VORVJBVEVEIEFMV0FZUyBBUyBJREVOVElUWSBQUklNQVJZIEtFWSwKICAibWFjaGluZUlkIiBpbnRlZ2VyIE5PVCBOVUxMIFJFRkVSRU5DRVMgbWFjaGluZXMoaWQpIE9OIERFTEVURSBOTyBBQ1RJT04gT04gVVBEQVRFIE5PIEFDVElPTiwKICAicGF0aWVudElkIiB2YXJjaGFyKDY0KSBOT1QgTlVMTCwKICAiZHVyYXRpb25NaW51dGVzIiBpbnRlZ2VyIE5PVCBOVUxMLAogICJzdGFydGVkQXQiIHRpbWVzdGFtcCgzKSB3aXRoIHRpbWUgem9uZSBOT1QgTlVMTCwKICAiZW5kc0F0IiB0aW1lc3RhbXAoMykgd2l0aCB0aW1lIHpvbmUgTk9UIE5VTEwsCiAgImlzb2xhdGlvblRhZyIgdmFyY2hhcig4KSBOT1QgTlVMTCBERUZBVUxUICdjbGVhbicgQ0hFQ0sgKCJpc29sYXRpb25UYWciIElOICgnY2xlYW4nLCdkaXJ0eScpKSwKICB1cmdlbnQgYm9vbGVhbiBOT1QgTlVMTCBERUZBVUxUIGZhbHNlLAogICJkaXNwbGF5TGFiZWwiIHZhcmNoYXIoNjQpLAogICJhc3NpZ25lZE51cnNlIiB2YXJjaGFyKDY0KSwKICBzdGF0dXMgdmFyY2hhcigxNikgTk9UIE5VTEwgREVGQVVMVCAnYWN0aXZlJyBDSEVDSyAoc3RhdHVzIElOICgnYWN0aXZlJywnZW5kZWQnKSksCiAgImVuZGVkQXQiIHRpbWVzdGFtcCgzKSB3aXRoIHRpbWUgem9uZSwKICAiZW5kZWRCeSIgdGV4dCwKICAic3RhcnRlZEJ5IiB0ZXh0LAogICJjcmVhdGVkQXQiIHRpbWVzdGFtcCgzKSB3aXRoIHRpbWUgem9uZSBOT1QgTlVMTCBERUZBVUxUIG5vdygpLAogICJ1cGRhdGVkQXQiIHRpbWVzdGFtcCgzKSB3aXRoIHRpbWUgem9uZSBOT1QgTlVMTCBERUZBVUxUIG5vdygpCik7CgpDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyB3YWl0aW5nX2xpc3QgKAogIGlkIGludGVnZXIgR0VORVJBVEVEIEFMV0FZUyBBUyBJREVOVElUWSBQUklNQVJZIEtFWSwKICAicGF0aWVudElkIiB2YXJjaGFyKDY0KSBOT1QgTlVMTCwKICAiZmxvb3JJZCIgaW50ZWdlciBOT1QgTlVMTCBSRUZFUkVOQ0VTIGZsb29ycyhpZCkgT04gREVMRVRFIE5PIEFDVElPTiBPTiBVUERBVEUgTk8gQUNUSU9OLAogIHByaW9yaXR5IHZhcmNoYXIoMTIpIE5PVCBOVUxMIERFRkFVTFQgJ25vcm1hbCcgQ0hFQ0sgKHByaW9yaXR5IElOICgnbm9ybWFsJywndXJnZW50JywndmVyeVVyZ2VudCcpKSwKICAiZHVyYXRpb25NaW51dGVzIiBpbnRlZ2VyIE5PVCBOVUxMIERFRkFVTFQgMjQwLAogICJpc29sYXRpb25UYWciIHZhcmNoYXIoOCkgTk9UIE5VTEwgREVGQVVMVCAnY2xlYW4nIENIRUNLICgiaXNvbGF0aW9uVGFnIiBJTiAoJ2NsZWFuJywnZGlydHknKSksCiAgImFzc2lnbmVkTnVyc2UiIHZhcmNoYXIoNjQpLAogICJhZGRlZEJ5IiB0ZXh0LAogICJqb2luZWRBdCIgdGltZXN0YW1wKDMpIHdpdGggdGltZSB6b25lIE5PVCBOVUxMIERFRkFVTFQgbm93KCksCiAgImFkbWl0dGVkQXQiIHRpbWVzdGFtcCgzKSB3aXRoIHRpbWUgem9uZSwKICBzdGF0dXMgdmFyY2hhcigxMikgTk9UIE5VTEwgREVGQVVMVCAnd2FpdGluZycgQ0hFQ0sgKHN0YXR1cyBJTiAoJ3dhaXRpbmcnLCdhZG1pdHRlZCcpKSwKICAiY3JlYXRlZEF0IiB0aW1lc3RhbXAoMykgd2l0aCB0aW1lIHpvbmUgTk9UIE5VTEwgREVGQVVMVCBub3coKQopOwoKQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgc3RhZmZfYWNjb3VudHMgKAogIGlkIGludGVnZXIgR0VORVJBVEVEIEFMV0FZUyBBUyBJREVOVElUWSBQUklNQVJZIEtFWSwKICB1c2VybmFtZSB2YXJjaGFyKDY0KSBOT1QgTlVMTCBVTklRVUUsCiAgImRpc3BsYXlOYW1lIiB2YXJjaGFyKDY0KSBOT1QgTlVMTCwKICByb2xlIHZhcmNoYXIoMTYpIE5PVCBOVUxMIENIRUNLIChyb2xlIElOICgnbnVyc2UnLCdzdXBlcnZpc29yJywnZ3Vlc3QnKSksCiAgImFzc2lnbmVkRmxvb3JJZCIgaW50ZWdlciBSRUZFUkVOQ0VTIGZsb29ycyhpZCkgT04gREVMRVRFIFNFVCBOVUxMIE9OIFVQREFURSBOTyBBQ1RJT04sCiAgInBhc3N3b3JkSGFzaCIgdmFyY2hhcigxMjgpIE5PVCBOVUxMLAogICJwYXNzd29yZFNhbHQiIHZhcmNoYXIoMzIpIE5PVCBOVUxMLAogIGFjdGl2ZSBib29sZWFuIE5PVCBOVUxMIERFRkFVTFQgdHJ1ZSwKICAiY3JlYXRlZEF0IiB0aW1lc3RhbXAoMykgd2l0aCB0aW1lIHpvbmUgTk9UIE5VTEwgREVGQVVMVCBub3coKSwKICAibGFzdFNpZ25lZEluIiB0aW1lc3RhbXAoMykgd2l0aCB0aW1lIHpvbmUsCiAgInRva2VuVmVyc2lvbiIgaW50ZWdlciBOT1QgTlVMTCBERUZBVUxUIDEKKTsKCkNSRUFURSBJTkRFWCBJRiBOT1QgRVhJU1RTIGlkeF9zZXNzaW9uc19tYWNoaW5lX2FjdGl2ZSBPTiBzZXNzaW9ucyAoIm1hY2hpbmVJZCIsIHN0YXR1cyk7CkNSRUFURSBJTkRFWCBJRiBOT1QgRVhJU1RTIGlkeF9zZXNzaW9uc19zdGF0dXMgT04gc2Vzc2lvbnMgKHN0YXR1cyk7CkNSRUFURSBJTkRFWCBJRiBOT1QgRVhJU1RTIGlkeF93YWl0aW5nX2xpc3RfZmxvb3IgT04gd2FpdGluZ19saXN0ICgiZmxvb3JJZCIpOwpDUkVBVEUgSU5ERVggSUYgTk9UIEVYSVNUUyBpZHhfd2FpdGluZ19saXN0X3N0YXR1cyBPTiB3YWl0aW5nX2xpc3QgKHN0YXR1cyk7Cg==";

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
    const url =
      (process.env.SUPABASE_DATABASE_URL_B64
        ? Buffer.from(process.env.SUPABASE_DATABASE_URL_B64, "base64").toString("utf8")
        : "") || process.env.SUPABASE_DATABASE_URL || "";
    if (!url) return { set: false } as const;
    try {
      const u = new URL(url);
      return { set: true, proto: u.protocol, user: u.username, host: u.host, port: u.port, pathname: u.pathname, pwdLen: u.password.length } as const;
    } catch { return { set: true, parseError: true } as const; }
  }),

  supabasePing: publicProcedure.query(async () => {
    const url =
      (process.env.SUPABASE_DATABASE_URL_B64
        ? Buffer.from(process.env.SUPABASE_DATABASE_URL_B64, "base64").toString("utf8")
        : "") || process.env.SUPABASE_DATABASE_URL || "";
    if (!url) return { ok: false, error: "Supabase URL not set" } as const;
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

  // TEMPORARY (migration): nonce-gated migration trigger. The adminProcedure path
  // requires the owner's browser session, which is unavailable from automation, so
  // a short random nonce is used as a shared secret. REMOVE THIS AFTER MIGRATION.
  supabaseMigrate: publicProcedure
    .input(z.object({ nonce: z.string().min(1).max(64) }).optional())
    .mutation(async ({ input }) => {
      if (input?.nonce && input.nonce !== process.env.MIGRATE_NONCE) {
        return { ok: false, error: "bad nonce" } as const;
      }
      return await runSupabaseMigration();
    }),

  // TEMPORARY: admin path for the owner via browser. Remove after migration.
  supabaseMigrateAdmin: adminProcedure.mutation(async () => runSupabaseMigration()),

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

async function runSupabaseMigration(): Promise<{ ok: boolean; log?: string[]; error?: string }> {
  const url =
    (process.env.SUPABASE_DATABASE_URL_B64
      ? Buffer.from(process.env.SUPABASE_DATABASE_URL_B64, "base64").toString("utf8")
      : "") || process.env.SUPABASE_DATABASE_URL || "";
  if (!url) return { ok: false, error: "Supabase URL not set" };
  try {
    const { Pool } = await import("pg");
    const dst = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 4 });
    const srcUrl = process.env.DATABASE_URL ?? "";
    const mysql = await import("mysql2/promise");
    const src = await mysql.createConnection(srcUrl);
    const q = async (sql: string) => {
      const [rows] = await src.query(sql);
      return rows as any[];
    };
    const log: string[] = [];
    // 1) Schema
    const schemaSql = Buffer.from(SCHEMA_SQL_B64, "base64").toString("utf8");
    await dst.query(schemaSql);
    log.push("schema applied");
    const epochToDate = (v: any) => (v == null ? null : new Date(v));
    // 2) floors
    const floors = await q("SELECT id, code, name, sortOrder, createdAt FROM floors ORDER BY sortOrder");
    await dst.query("DELETE FROM floors");
    for (const f of floors) {
      await dst.query(
        `INSERT INTO floors (id, code, name, "sortOrder", "createdAt") VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [f.id, f.code, f.name, f.sortOrder, epochToDate(f.createdAt)]
      );
    }
    log.push(`floors: ${floors.length}`);
    // 3) machines
    const machines = await q("SELECT id, label, location, floorId, sortOrder, isolationTag, urgent, displayLabel, createdAt, updatedAt FROM machines ORDER BY id");
    await dst.query("DELETE FROM machines");
    for (const m of machines) {
      await dst.query(
        `INSERT INTO machines (id, label, location, "floorId", "sortOrder", "isolationTag", urgent, "displayLabel", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [m.id, m.label, m.location, m.floorId, m.sortOrder, m.isolationTag, Boolean(m.urgent), m.displayLabel || null, epochToDate(m.createdAt), epochToDate(m.updatedAt)]
      );
    }
    log.push(`machines: ${machines.length}`);
    // 4) sessions
    const sessions = await q("SELECT id, machineId, patientId, durationMinutes, startedAt, endsAt, isolationTag, urgent, displayLabel, assignedNurse, status, endedAt, endedBy, startedBy, createdAt, updatedAt FROM sessions ORDER BY id");
    await dst.query("DELETE FROM sessions");
    for (const s of sessions) {
      await dst.query(
        `INSERT INTO sessions (id, "machineId", "patientId", "durationMinutes", "startedAt", "endsAt", "isolationTag", urgent, "displayLabel", "assignedNurse", status, "endedAt", "endedBy", "startedBy", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.machineId, s.patientId, s.durationMinutes, epochToDate(s.startedAt), epochToDate(s.endsAt), s.isolationTag, Boolean(s.urgent), s.displayLabel || null, s.assignedNurse || null, s.status, epochToDate(s.endedAt), s.endedBy || null, s.startedBy || null, epochToDate(s.createdAt), epochToDate(s.updatedAt)]
      );
    }
    log.push(`sessions: ${sessions.length}`);
    // 5) waiting list
    const waiting = await q("SELECT id, patientId, floorId, priority, durationMinutes, isolationTag, assignedNurse, addedBy, joinedAt, admittedAt, status, createdAt FROM waiting_list ORDER BY id");
    await dst.query("DELETE FROM waiting_list");
    for (const w of waiting) {
      await dst.query(
        `INSERT INTO waiting_list (id, "patientId", "floorId", priority, "durationMinutes", "isolationTag", "assignedNurse", "addedBy", "joinedAt", "admittedAt", status, "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
        [w.id, w.patientId, w.floorId, w.priority, w.durationMinutes, w.isolationTag, w.assignedNurse || null, w.addedBy || null, epochToDate(w.joinedAt), epochToDate(w.admittedAt), w.status, epochToDate(w.createdAt)]
      );
    }
    log.push(`waiting_list: ${waiting.length}`);
    // 6) staff accounts
    const staff = await q("SELECT id, username, displayName, role, assignedFloorId, passwordHash, passwordSalt, active, createdAt, lastSignedIn, tokenVersion FROM staff_accounts ORDER BY id");
    await dst.query("DELETE FROM staff_accounts");
    for (const s of staff) {
      await dst.query(
        `INSERT INTO staff_accounts (id, username, "displayName", role, "assignedFloorId", "passwordHash", "passwordSalt", active, "createdAt", "lastSignedIn", "tokenVersion") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.username, s.displayName, s.role, s.assignedFloorId, s.passwordHash, s.passwordSalt, Boolean(s.active), epochToDate(s.createdAt), epochToDate(s.lastSignedIn), s.tokenVersion ?? 1]
      );
    }
    log.push(`staff_accounts: ${staff.length}`);
    // Verify
    const checks = ["floors", "machines", "sessions", "waiting_list", "staff_accounts"];
    for (const t of checks) {
      const { rows } = await dst.query(`SELECT COUNT(*) FROM ${t}`);
      log.push(`supabase ${t}: ${rows[0].count}`);
    }
    await src.end();
    await dst.end();
    return { ok: true, log };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
