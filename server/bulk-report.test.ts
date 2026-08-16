/**
 * End of Day bulk report (endOfDay.bulkSummary): one call returns every
 * board's daily summary + day-wide narratives. Supervisor-only; nurses,
 * guests and auditors must be rejected (they keep the single per-board query).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
// Vitest doesn't load the app's .env, so provide a signing secret for the
// staff JWT used by createStaffSessionToken inside the login path.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const { mockDb } = vi.hoisted(() => ({ mockDb: vi.fn() }));
vi.mock("./db", async importOriginal => {
  const mod = await importOriginal<typeof import("./db")>();
  return {
    ...mod,
    getDb: mockDb,
  };
});

const { mockResolve } = vi.hoisted(() => ({ mockResolve: vi.fn() }));
vi.mock("./staffAuth", async importOriginal => {
  const mod = await importOriginal<typeof import("./staffAuth")>();
  return {
    ...mod,
    resolveStaffSession: mockResolve,
    staffAccessedFloors: vi.fn((staff: { role: string; assignedFloorId: number | null }) => {
      if (staff.role === "supervisor") return null;
      if (staff.assignedFloorId) return [staff.assignedFloorId];
      return [];
    }),
  };
});
// EndOfDayReport.tsx imports narrative constants from machines? No — they
// live in the client; nothing extra needed from this mock beyond db.

import * as machineDb from "./machines";

beforeEach(() => {
  vi.clearAllMocks();
});

// Build a fake drizzle-like db whose chain methods return what the bulk
// helper needs: floors, sessions, waiting, machines queries.
function makeFakeDb() {
  const chainSelect = (rows: unknown[]) => ({
    from: () => ({
      where: () => Promise.resolve(rows),
      orderBy: () => Promise.resolve(rows),
    }),
  });
  return {
    select: () => chainSelect([]),
  } as unknown as Awaited<ReturnType<typeof import("./db").getDb>>;
}

function makeCtx(role: "supervisor" | "nurse" | "guest" | "auditor", assignedFloorId: number | null = null): TrpcContext {
  return {
    user: {
      id: 2,
      openId: "staff-user",
      email: "staff@clinic.example",
      name: "Staff Member",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: vi.fn() } as unknown as TrpcContext["res"],
    staff: {
      accountId: 0,
      username: role === "supervisor" ? "supervisor" : `nurse.${role}`,
      displayName: "Staff Member",
      role,
      assignedFloorId,
      fromCookie: role !== "supervisor",
    } as never,
  };
}

const caller = appRouter.createCaller;

describe("endOfDay.bulkSummary", () => {
  it("returns all boards' summaries and narratives for the supervisor", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "supervisor",
      displayName: "SKTI Supervisor",
      role: "supervisor" as const,
      assignedFloorId: null,
    });
    // Stub the bulk helper directly — the test asserts the router forwards the
    // call and the RBAC gate; the helper's math is covered by integration runs.
    const fakeBulk = vi.fn(async () => ({
      reportDate: "2026-08-16",
      floors: [
        { id: 30001, name: "SKTI Main" },
        { id: 30002, name: "RDU Annex" },
      ],
      summaries: {
        "30001": { reportDate: "2026-08-16", totalMachinesOnFloor: 100, sessionsEnded: 5 } as never,
        "30002": { reportDate: "2026-08-16", totalMachinesOnFloor: 36, sessionsEnded: 3 } as never,
      },
      narratives: { "30001": [], "30002": [] },
    }));
    vi.spyOn(machineDb, "endOfDayReportBulk").mockImplementation(fakeBulk);

    const result = await caller(makeCtx("supervisor")).endOfDay.bulkSummary({ date: "2026-08-16" });
    expect(fakeBulk).toHaveBeenCalledWith({ date: "2026-08-16" });
    expect(result.reportDate).toBe("2026-08-16");
    expect(result.floors).toHaveLength(2);
    expect(result.summaries["30001"].totalMachinesOnFloor).toBe(100);
  });

  it("rejects guests with FORBIDDEN", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "guest",
      displayName: "Guest",
      role: "guest" as const,
      assignedFloorId: null,
    });
    await expect(
      caller(makeCtx("guest")).endOfDay.bulkSummary({ date: "2026-08-16" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects nurses with FORBIDDEN (they keep the single per-board query)", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "nurse.sk",
      displayName: "SKTI Nurse",
      role: "nurse" as const,
      assignedFloorId: 30001,
    });
    await expect(
      caller(makeCtx("nurse", 30001)).endOfDay.bulkSummary({ date: "2026-08-16" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects auditors with FORBIDDEN", async () => {
    mockResolve.mockResolvedValue({
      accountId: 0,
      username: "auditor",
      displayName: "Auditor",
      role: "auditor" as const,
      assignedFloorId: null,
    });
    await expect(
      caller(makeCtx("auditor")).endOfDay.bulkSummary({ date: "2026-08-16" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
