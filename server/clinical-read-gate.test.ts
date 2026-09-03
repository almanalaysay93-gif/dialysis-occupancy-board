import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-vitest";

import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

vi.mock("./machines", async importOriginal => {
  const mod = await importOriginal<typeof import("./machines")>();
  return {
    ...mod,
    invalidateBoardCache: vi.fn(),
    listShiftEndorsements: vi.fn(async () => [{ id: 1, situation: "Nadir BP 84/52 on HD-04." }]),
    listWaterQualityLogs: vi.fn(async () => [{ id: 1, status: "pass" }]),
  };
});

const { mockResolve } = vi.hoisted(() => ({ mockResolve: vi.fn() }));
vi.mock("./staffAuth", async importOriginal => {
  const mod = await importOriginal<typeof import("./staffAuth")>();
  return { ...mod, resolveStaffSession: mockResolve };
});

/** Context with no OAuth user, so the staff cookie alone decides access. */
function ctxWithoutOauth(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function session(role: string, fromCookie: boolean) {
  return {
    accountId: role === "guest" ? 0 : 5,
    username: role,
    displayName: role,
    role,
    assignedFloorId: null,
    fromCookie,
  };
}

describe("clinical registries are closed to guests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a guest cookie session on shiftEndorsements.list", async () => {
    mockResolve.mockResolvedValue(session("guest", true));
    const call = appRouter.createCaller(ctxWithoutOauth());
    await expect(call.shiftEndorsements.list()).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects a guest cookie session on waterQualityLogs.list", async () => {
    mockResolve.mockResolvedValue(session("guest", true));
    const call = appRouter.createCaller(ctxWithoutOauth());
    await expect(call.waterQualityLogs.list()).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects an anonymous visitor with no staff cookie", async () => {
    mockResolve.mockResolvedValue(session("guest", false));
    const call = appRouter.createCaller(ctxWithoutOauth());
    await expect(call.shiftEndorsements.list()).rejects.toBeInstanceOf(TRPCError);
    await expect(call.waterQualityLogs.list()).rejects.toBeInstanceOf(TRPCError);
  });

  it("never leaks the narrative to a guest", async () => {
    mockResolve.mockResolvedValue(session("guest", true));
    const call = appRouter.createCaller(ctxWithoutOauth());
    await expect(call.shiftEndorsements.list()).rejects.toThrow();
    const machineDb = await import("./machines");
    expect(vi.mocked(machineDb.listShiftEndorsements)).not.toHaveBeenCalled();
  });

  it("serves a nurse cookie session", async () => {
    mockResolve.mockResolvedValue(session("nurse", true));
    const call = appRouter.createCaller(ctxWithoutOauth());
    await expect(call.shiftEndorsements.list()).resolves.toHaveLength(1);
    await expect(call.waterQualityLogs.list()).resolves.toHaveLength(1);
  });

  it("serves a supervisor cookie session", async () => {
    mockResolve.mockResolvedValue(session("supervisor", true));
    const call = appRouter.createCaller(ctxWithoutOauth());
    await expect(call.waterQualityLogs.list()).resolves.toHaveLength(1);
  });
});
