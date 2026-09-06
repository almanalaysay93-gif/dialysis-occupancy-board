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

function getSql(): ReturnType<typeof postgres> | null {
  const url = process.env.NURSETRACK_DATABASE_URL?.trim();
  if (!url) return null;
  if (!_sql) {
    _sql = postgres(url, { max: 2, idle_timeout: 30, connect_timeout: 8, ssl: { rejectUnauthorized: false } });
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
