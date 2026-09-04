import { describe, expect, it } from "vitest";
import { requireDatabaseUrl, resolveDatabaseUrl } from "./_core/database-url";

const URL_A = "postgresql://postgres.abcd:pw123@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres";
const URL_B = "postgresql://fallback:pw@db.example.com:5432/board";
const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");

describe("resolveDatabaseUrl", () => {
  it("prefers the base64 Supabase variable over the plain one", () => {
    const r = resolveDatabaseUrl({ SUPABASE_DATABASE_URL_B64: b64(URL_A), DATABASE_URL: URL_B });
    expect(r).toEqual({ url: URL_A, source: "SUPABASE_DATABASE_URL_B64", warning: null });
  });

  it("uses DATABASE_URL when the base64 variable is absent", () => {
    const r = resolveDatabaseUrl({ DATABASE_URL: URL_B });
    expect(r).toEqual({ url: URL_B, source: "DATABASE_URL", warning: null });
  });

  it("tolerates whitespace and padding around the encoded value", () => {
    const r = resolveDatabaseUrl({ SUPABASE_DATABASE_URL_B64: `  ${b64(URL_A)}\n` });
    expect(r.url).toBe(URL_A);
  });

  it("reports both variables missing", () => {
    const r = resolveDatabaseUrl({});
    expect(r.url).toBeNull();
    expect(r).toHaveProperty("reason", "neither SUPABASE_DATABASE_URL_B64 nor DATABASE_URL is set");
  });

  /**
   * The bug this whole module exists for: Buffer.from(x, "base64") never throws
   * on corrupt input, so the old try/catch never fired and the fallback was
   * unreachable. A mangled secret produced a junk connection string instead.
   */
  it("falls back to DATABASE_URL when the encoded value is corrupted", () => {
    const corrupted = b64(URL_A).slice(0, 20) + "!" + b64(URL_A).slice(21);
    const r = resolveDatabaseUrl({ SUPABASE_DATABASE_URL_B64: corrupted, DATABASE_URL: URL_B });
    expect(r.url).toBe(URL_B);
    expect(r.source).toBe("DATABASE_URL");
    expect((r as { warning: string }).warning).toContain("not valid base64");
  });

  it("explains the corruption when there is nothing to fall back to", () => {
    const corrupted = b64(URL_A).slice(0, 41);
    const r = resolveDatabaseUrl({ SUPABASE_DATABASE_URL_B64: corrupted });
    expect(r.url).toBeNull();
    expect((r as { reason: string }).reason).toContain("DATABASE_URL is not set");
  });

  /** Truncation on a 4-char boundary stays valid base64, so only URI parsing catches it. */
  it("rejects a boundary-aligned truncation that round-trips cleanly", () => {
    const encoded = b64(URL_A);
    const aligned = encoded.slice(0, encoded.length - (encoded.length % 4) - 16);
    const r = resolveDatabaseUrl({ SUPABASE_DATABASE_URL_B64: aligned });
    expect(r.url).toBeNull();
  });

  it("rejects a decoded value that is not a postgres URI", () => {
    const r = resolveDatabaseUrl({ SUPABASE_DATABASE_URL_B64: b64("mysql://u:p@host:3306/db") });
    expect(r.url).toBeNull();
    expect((r as { reason: string }).reason).toContain("not a postgres:// URI");
  });

  it("never puts the connection string in a reason", () => {
    const r = resolveDatabaseUrl({ SUPABASE_DATABASE_URL_B64: b64("postgresql://") });
    expect(r.url).toBeNull();
    expect((r as { reason: string }).reason).not.toContain("postgresql://");
  });
});

describe("requireDatabaseUrl", () => {
  it("returns the resolved URL", () => {
    expect(requireDatabaseUrl({ DATABASE_URL: URL_B })).toBe(URL_B);
  });

  it("throws with the cause instead of degrading to no database", () => {
    expect(() => requireDatabaseUrl({})).toThrow(/neither SUPABASE_DATABASE_URL_B64 nor DATABASE_URL is set/);
  });
});
