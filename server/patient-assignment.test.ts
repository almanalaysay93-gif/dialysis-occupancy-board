import { beforeEach, describe, expect, it, vi } from "vitest";
import { findPatientAssignment } from "./patient-assignment";
import { patientTicket } from "./patient-ticket";

const { getDb, select } = vi.hoisted(() => ({ getDb: vi.fn(), select: vi.fn() }));
vi.mock("./db", () => ({ getDb }));

function rows(active: unknown[], waiting: unknown[]) {
  const query = (value: unknown[]) => {
    const result = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn().mockResolvedValue(value) };
    result.from.mockReturnValue(result);
    result.innerJoin.mockReturnValue(result);
    return result;
  };
  select.mockReturnValueOnce(query(active)).mockReturnValueOnce(query(waiting));
}

describe("live patient placement", () => {
  beforeEach(() => { vi.resetAllMocks(); getDb.mockResolvedValue({ select }); });

  it.each(["PT-123", patientTicket("PT-123").toLowerCase()])("resolves active floor from %s", async input => {
    rows([{ patientId: "PT-123", floorId: 4, label: "ICU-04" }], []);
    expect(await findPatientAssignment(input)).toMatchObject({ assignedFloorId: 4, activeBay: "ICU-04", activeStatus: "in_treatment" });
  });

  it("resolves waiting floor and prefers active placement after admission", async () => {
    rows([], [{ patientId: "PT-123", floorId: 2 }]);
    expect(await findPatientAssignment("PT-123")).toMatchObject({ assignedFloorId: 2, activeStatus: "waiting" });
    rows([{ patientId: "PT-123", floorId: 4, label: "ICU-04" }], [{ patientId: "PT-123", floorId: 2 }]);
    expect(await findPatientAssignment("PT-123")).toMatchObject({ assignedFloorId: 4, activeStatus: "in_treatment" });
  });

  it("grants no placement for unknown patients or conflicting active floors", async () => {
    rows([], []);
    expect(await findPatientAssignment("unknown")).toBeNull();
    rows([{ patientId: "PT-123", floorId: 1 }, { patientId: "PT-123", floorId: 2 }], []);
    expect(await findPatientAssignment("PT-123")).toBeNull();
  });

  it("does not choose another patient when short ticket codes collide", async () => {
    const seen = new Map<string, string>();
    let collision: [string, string, string] | undefined;
    for (let i = 0; i < 10000; i++) {
      const id = `PT-${i}`, ticket = patientTicket(id);
      if (seen.has(ticket)) { collision = [seen.get(ticket)!, id, ticket]; break; }
      seen.set(ticket, id);
    }
    expect(collision).toBeDefined();
    const [first, second, ticket] = collision!;
    rows([{ patientId: first, floorId: 1, label: "HD-01" }], [{ patientId: second, floorId: 2 }]);
    expect(await findPatientAssignment(ticket)).toBeNull();
  });

  it("returns no placement when the database is not configured", async () => {
    getDb.mockResolvedValue(null);
    expect(await findPatientAssignment("PT-123")).toBeNull();
  });
});
