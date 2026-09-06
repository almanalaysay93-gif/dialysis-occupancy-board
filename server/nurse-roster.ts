/**
 * Read-only roster from the separate skti-nursetrack Supabase database.
 *
 * This app's own database has no nurse-name table — assignedNurse is a free
 * text field. The roster lives in a different Supabase project, so this pool
 * is intentionally separate from server/db.ts and only ever reads.
 */
import postgres from "postgres";

export type NurseRosterEntry = {
  id: number;
  employeeId: string;
  name: string;
  position: string | null;
  area: string | null;
};

let _sql: ReturnType<typeof postgres> | null = null;
let _sqlFailed = false;

/**
 * Undoes two common copy-paste mistakes when setting the env var: wrapping
 * quotes (`"postgresql://..."`), and pasting a whole `.env` line instead of
 * just its value (`DATABASE_URL=postgresql://...`).
 */
function normalizeConnectionString(raw: string): string {
  let value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim();
    }
  }
  if (!/^[a-z]+:\/\//i.test(value)) {
    const eqIndex = value.indexOf("=");
    const prefix = eqIndex === -1 ? "" : value.slice(0, eqIndex);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) {
      value = value.slice(eqIndex + 1).trim();
    }
  }
  return value;
}

function getSql(): ReturnType<typeof postgres> | null {
  if (_sqlFailed) return null;
  const raw = process.env.NURSETRACK_DATABASE_URL;
  if (!raw?.trim()) return null;
  if (!_sql) {
    try {
      const url = normalizeConnectionString(raw);
      _sql = postgres(url, { max: 2, idle_timeout: 30, connect_timeout: 8, ssl: { rejectUnauthorized: false } });
    } catch (error) {
      _sqlFailed = true;
      console.warn("[NurseRoster] NURSETRACK_DATABASE_URL is set but not a valid connection string:", error);
      return null;
    }
  }
  return _sql;
}

let _warned = false;

/**
 * The roster changes rarely (hires, transfers, resignations) but the dropdown
 * opens often, so a short cache spares the cross-project pooler a query per
 * open across every staff device.
 */
const ROSTER_CACHE_TTL_MS = 60_000;
let _cache: { value: NurseRosterEntry[]; expiresAt: number } | null = null;

/** Active nurses only — resigned/retired/archived staff don't belong in an assignment picker. */
export async function listActiveNurses(): Promise<NurseRosterEntry[]> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.value;

  const sql = getSql();
  if (!sql) {
    if (!_warned) {
      console.warn("[NurseRoster] NURSETRACK_DATABASE_URL not set — nurse dropdown will be empty");
      _warned = true;
    }
    return [];
  }
  try {
    const rows = await sql<
      { id: number; employeeId: string; firstName: string; lastName: string; position: string | null; area: string | null }[]
    >`
      SELECT n.id, n."employeeId", n."firstName", n."lastName", n.position, a.name AS area
      FROM nursetrack.nurses n
      LEFT JOIN nursetrack.areas a ON a.id = n."currentAreaId"
      WHERE n."employmentStatus" = 'Active'
      ORDER BY n."lastName", n."firstName"
    `;
    const value = rows.map(r => ({
      id: r.id,
      employeeId: r.employeeId,
      name: `${r.lastName}, ${r.firstName}`,
      position: r.position,
      area: r.area,
    }));
    _cache = { value, expiresAt: Date.now() + ROSTER_CACHE_TTL_MS };
    return value;
  } catch (error) {
    console.warn("[NurseRoster] Failed to fetch nurse roster:", error);
    return [];
  }
}
