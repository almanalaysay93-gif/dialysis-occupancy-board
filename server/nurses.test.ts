import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

vi.mock("./nurse-roster", () => ({
  listActiveNurses: vi.fn(async () => [
    { id: 1, employeeId: "RN-001", name: "Cruz, Al", position: "Staff Nurse II", area: "RDU Main" },
  ]),
}));
import { listActiveNurses } from "./nurse-roster";

vi.mock("./staffAuth", async importOriginal => {
  const mod = await importOriginal<typeof import("./staffAuth")>();
  return {
    ...mod,
    resolveStaffSession: vi.fn().mockResolvedValue({
      accountId: 0,
      username: "",
      displayName: "",
      role: "supervisor" as const,
      assignedFloorId: null,
    }),
    staffAccessedFloors: vi.fn().mockReturnValue(null),
  };
});

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createStaffContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: "staff-user",
    email: "staff@clinic.example",
    name: "Staff Member",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("nurses.roster", () => {
  it("returns the active roster for a staff session", async () => {
    const caller = appRouter.createCaller(createStaffContext());
    const roster = await caller.nurses.roster();
    expect(roster).toEqual([
      { id: 1, employeeId: "RN-001", name: "Cruz, Al", position: "Staff Nurse II", area: "RDU Main" },
    ]);
    expect(listActiveNurses).toHaveBeenCalledTimes(1);
  });

  it("rejects an unauthenticated guest", async () => {
    const { resolveStaffSession } = await import("./staffAuth");
    vi.mocked(resolveStaffSession).mockResolvedValueOnce(null);
    const anonymousCtx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(anonymousCtx);
    await expect(caller.nurses.roster()).rejects.toBeInstanceOf(TRPCError);
  });
});
