import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-vitest";

import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { createStaffSessionToken, verifyStaffSession } from "./staffAuth";
import { patientTicket } from "./patient-ticket";

vi.mock("./machines", async importOriginal => {
  const mod = await importOriginal<typeof import("./machines")>();
  return {
    ...mod,
    invalidateBoardCache: vi.fn(),
    listShiftEndorsements: vi.fn(async () => [{ id: 1, situation: "Nadir BP 84/52." }]),
    listWaterQualityLogs: vi.fn(async () => [{ id: 1, status: "pass" }]),
  };
});

const { mockResolve } = vi.hoisted(() => ({ mockResolve: vi.fn() }));
vi.mock("./staffAuth", async importOriginal => {
  const mod = await importOriginal<typeof import("./staffAuth")>();
  return { ...mod, resolveStaffSession: mockResolve };
});

function ctxWithoutOauth(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function patientSession(username = "TK-4821") {
  return {
    accountId: 0,
    username,
    displayName: `Patient ${username}`,
    role: "patient" as const,
    assignedFloorId: null,
    fromCookie: true,
  };
}

describe("patient login and kiosk-only access enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates and verifies a valid role=patient JWT token", async () => {
    const token = await createStaffSessionToken({
      accountId: 0,
      username: "TK-4821",
      displayName: "Patient TK-4821",
      role: "patient",
      assignedFloorId: null,
    });

    const parsed = await verifyStaffSession(token);
    expect(parsed).not.toBeNull();
    expect(parsed?.role).toBe("patient");
    expect(parsed?.username).toBe("TK-4821");
    expect(parsed?.displayName).toBe("Patient TK-4821");
    expect(parsed?.accountId).toBe(0);
  });

  it("patientLogin issues ticket and role=patient payload", async () => {
    const ctx = ctxWithoutOauth();
    const caller = appRouter.createCaller(ctx);
    const res = await caller.staff.patientLogin({ ticketOrId: "P-4821" });

    expect(res.success).toBe(true);
    expect(res.role).toBe("patient");
    expect(res.ticket).toBe(patientTicket("P-4821"));
    expect(res.displayName).toBe(`Patient ${patientTicket("P-4821")}`);
    expect(ctx.res.cookie).toHaveBeenCalled();
  });

  it("patientGuest enters anonymous kiosk-only session", async () => {
    const ctx = ctxWithoutOauth();
    const caller = appRouter.createCaller(ctx);
    const res = await caller.staff.patientGuest();

    expect(res.success).toBe(true);
    expect(res.role).toBe("patient");
    expect(ctx.res.cookie).toHaveBeenCalled();
  });

  it("blocks patient session from accessing clinical endorsements", async () => {
    mockResolve.mockResolvedValue(patientSession("TK-4821"));
    const caller = appRouter.createCaller(ctxWithoutOauth());
    await expect(caller.shiftEndorsements.list()).rejects.toBeInstanceOf(TRPCError);
  });

  it("blocks patient session from accessing RO water quality logs", async () => {
    mockResolve.mockResolvedValue(patientSession("TK-4821"));
    const caller = appRouter.createCaller(ctxWithoutOauth());
    await expect(caller.waterQualityLogs.list()).rejects.toBeInstanceOf(TRPCError);
  });

  it("blocks patient session from writing or modifying machines", async () => {
    mockResolve.mockResolvedValue(patientSession("TK-4821"));
    const caller = appRouter.createCaller(ctxWithoutOauth());
    await expect(
      caller.machines.setStatus({ machineId: 1, status: "repair" })
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
