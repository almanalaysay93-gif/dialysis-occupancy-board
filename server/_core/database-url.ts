/**
 * Single resolver for the Postgres connection string.
 *
 * The URL is stored base64-encoded (SUPABASE_DATABASE_URL_B64) so the
 * platform's secret storage cannot mangle the "postgresql://" URI. Every
 * consumer — the runtime pool, drizzle-kit, the seeder — must agree on that
 * precedence, or the app connects while migrations claim there is no database.
 *
 * Reasons never contain the connection string: they are logged, and it carries
 * the database password.
 */

export type DatabaseUrlSource = "SUPABASE_DATABASE_URL_B64" | "DATABASE_URL";

export type DatabaseUrlResolution =
  | { url: string; source: DatabaseUrlSource; warning: string | null }
  | { url: null; source: null; reason: string };

type EnvLike = Record<string, string | undefined>;

/**
 * Buffer.from(x, "base64") never throws on malformed input — it silently drops
 * characters outside the alphabet — so a corrupted secret decodes to garbage
 * rather than failing. Re-encoding and comparing is the only way to notice.
 * Whitespace and padding are normalized away because both survive a decode
 * intact and are not corruption.
 */
function decodeStrictBase64(raw: string): { value: string } | { error: string } {
  const decoded = Buffer.from(raw, "base64").toString("utf-8");
  const normalize = (s: string) => s.replace(/\s/g, "").replace(/=+$/, "");
  if (normalize(Buffer.from(decoded, "utf-8").toString("base64")) !== normalize(raw)) {
    return { error: "value is not valid base64 (decoding dropped characters — the secret is truncated or corrupted)" };
  }
  return { value: decoded };
}

/**
 * A boundary-aligned truncation is still valid base64, so the round-trip check
 * above cannot catch it. Parsing as a URI does.
 */
function validatePostgresUri(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return "value is empty";
  if (!/^postgres(ql)?:\/\//.test(trimmed)) return "value is not a postgres:// URI";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "value does not parse as a URI (likely truncated)";
  }
  if (!parsed.hostname) return "URI has no host";
  if (!parsed.username) return "URI has no username";
  if (!parsed.password) return "URI has no password";
  // A truncation that lands on a base64 boundary still parses — it just loses
  // the tail. The database name is the last component, so its absence is the
  // reliable tell.
  if (parsed.pathname.replace(/^\//, "") === "") return "URI has no database name (likely truncated)";
  return null;
}

export function resolveDatabaseUrl(env: EnvLike = process.env): DatabaseUrlResolution {
  const encoded = env.SUPABASE_DATABASE_URL_B64?.trim();
  const plain = env.DATABASE_URL?.trim();
  let encodedError: string | null = null;

  if (encoded) {
    const decoded = decodeStrictBase64(encoded);
    if ("error" in decoded) {
      encodedError = decoded.error;
    } else {
      const invalid = validatePostgresUri(decoded.value);
      if (invalid) encodedError = invalid;
      else return { url: decoded.value.trim(), source: "SUPABASE_DATABASE_URL_B64", warning: null };
    }
  }

  if (plain) {
    const invalid = validatePostgresUri(plain);
    if (invalid) {
      return {
        url: null,
        source: null,
        reason: encodedError
          ? `SUPABASE_DATABASE_URL_B64 is unusable (${encodedError}) and DATABASE_URL is also invalid (${invalid})`
          : `DATABASE_URL is invalid: ${invalid}`,
      };
    }
    return {
      url: plain,
      source: "DATABASE_URL",
      // Falling back is correct, but silence here is what made a mangled secret
      // look like "no database configured" for the whole deploy.
      warning: encodedError ? `SUPABASE_DATABASE_URL_B64 was ignored: ${encodedError}` : null,
    };
  }

  return {
    url: null,
    source: null,
    reason: encodedError
      ? `SUPABASE_DATABASE_URL_B64 is unusable (${encodedError}) and DATABASE_URL is not set`
      : "neither SUPABASE_DATABASE_URL_B64 nor DATABASE_URL is set",
  };
}

/** Throwing variant for CLI tooling, where degrading to "no database" hides the cause. */
export function requireDatabaseUrl(env: EnvLike = process.env): string {
  const resolved = resolveDatabaseUrl(env);
  if (resolved.url === null) throw new Error(`No usable database connection string: ${resolved.reason}`);
  if (resolved.warning) console.warn(`[Database] ${resolved.warning}`);
  return resolved.url;
}
