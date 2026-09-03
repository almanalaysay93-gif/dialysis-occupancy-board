import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./db";
import { invalidateBoardCache, listMachines } from "./machines";
import { patientTicket } from "./patient-ticket";

const MACHINE_ROW = {
  id: 7,
  label: "HD-07",
  location: "Bay 7",
  floorId: 1,
  sortOrder: 7,
  status: "active",
  statusNote: null,
};

const SESSION_ROW = {
  id: 55,
  machineId: 7,
  patientId: "P-4821",
  durationMinutes: 240,
  startedAt: new Date("2026-08-28T01:00:00Z"),
  endsAt: new Date("2026-08-28T05:00:00Z"),
  isolationTag: "clean",
  urgent: false,
  status: "active",
  startedBy: "Nurse Jane, RN",
  displayLabel: "Dela Cruz, J.",
  assignedNurse: "Nurse Jane, RN",
  needsRepairAfterSession: false,
  pausedAt: null,
  pausedSeconds: 0,
};

/**
 * listMachines fires the machine query and the session query through
 * Promise.all, so the first select resolves to machines and the second to
 * sessions.
 */
function mockBoardDb() {
  const chain = (rows: unknown[]): Record<string, unknown> => ({
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    from: vi.fn(() => chain(rows)),
    where: vi.fn(() => chain(rows)),
    orderBy: vi.fn(() => chain(rows)),
    limit: vi.fn(() => chain(rows)),
  });

  let call = 0;
  return {
    select: vi.fn(() => {
      const rows = call === 0 ? [MACHINE_ROW] : [SESSION_ROW];
      call += 1;
      return chain(rows);
    }),
  };
}

describe("board PHI gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateBoardCache();
    vi.mocked(getDb).mockResolvedValue(mockBoardDb() as never);
  });

  it("hides the patient identifier and staff names from a guest viewer", async () => {
    const rows = await listMachines({ canSeePhi: false });

    expect(rows).toHaveLength(1);
    const session = rows[0].session;
    expect(session).not.toBeNull();
    expect(session?.patientId).toBeNull();
    expect(session?.startedBy).toBeNull();
    expect(session?.displayLabel).toBeNull();
    expect(session?.assignedNurse).toBeNull();
    // The kiosk still needs something to call out, so a stable ticket stands in.
    expect(session?.ticket).toBe(patientTicket("P-4821"));
    expect(JSON.stringify(rows)).not.toContain("P-4821");
    expect(JSON.stringify(rows)).not.toContain("Dela Cruz");
  });

  it("returns the real identifiers to a staff viewer", async () => {
    const rows = await listMachines({ canSeePhi: true });

    const session = rows[0].session;
    expect(session?.patientId).toBe("P-4821");
    expect(session?.startedBy).toBe("Nurse Jane, RN");
    expect(session?.displayLabel).toBe("Dela Cruz, J.");
    expect(session?.assignedNurse).toBe("Nurse Jane, RN");
  });

  it("defaults to the masked view when no viewer is given", async () => {
    const rows = await listMachines();
    expect(rows[0].session?.patientId).toBeNull();
  });

  it("does not serve a masked payload to a staff viewer from the cache", async () => {
    const guest = await listMachines({ canSeePhi: false });
    expect(guest[0].session?.patientId).toBeNull();

    // Same 2s window, different viewer: the cache key carries PHI access.
    vi.mocked(getDb).mockResolvedValue(mockBoardDb() as never);
    const staff = await listMachines({ canSeePhi: true });
    expect(staff[0].session?.patientId).toBe("P-4821");
  });
});
