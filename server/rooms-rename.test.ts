import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

vi.mock("./machines", () => ({
  listFloors: vi.fn(),
  listMachines: vi.fn(),
  addRoom: vi.fn(),
  renameRoom: vi.fn(),
  removeRoom: vi.fn(),
}));

import * as machineDb from "./machines";

const renameRoom = vi.mocked(machineDb.renameRoom);
const listFloors = vi.mocked(machineDb.listFloors);

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createCtx(user: Partial<AuthenticatedUser> = {}): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "staff-1",
      email: "staff@example.com",
      name: "Staff Member",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      ...user,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
  };
}

const anonCtx: TrpcContext = {
  user: null,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
};

beforeEach(() => {
  vi.clearAllMocks();
  listFloors.mockResolvedValue([]);
});

describe("rooms.rename", () => {
  it("renames a room as authenticated staff", async () => {
    renameRoom.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.rooms.rename({ roomId: 30001, name: "SKTI Main" });
    expect(result).toEqual({ success: true });
    expect(renameRoom).toHaveBeenCalledWith({ roomId: 30001, name: "SKTI Main" });
  });

  it("rejects empty names", async () => {
    renameRoom.mockRejectedValue(new Error("ROOM_NAME_REQUIRED"));
    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.rooms.rename({ roomId: 30001, name: "   " })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects duplicate room names with a friendly message", async () => {
    renameRoom.mockRejectedValue(new Error("ROOM_EXISTS"));
    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.rooms.rename({ roomId: 30001, name: "RDU Annex" })
    ).rejects.toSatisfy(e => e instanceof TRPCError && e.message.includes("already exists"));
  });

  it("rejects anonymous users", async () => {
    renameRoom.mockRejectedValue(new Error("ROOM_NAME_REQUIRED"));
    const caller = appRouter.createCaller(anonCtx);
    await expect(
      caller.rooms.rename({ roomId: 30001, name: "SKTI Main" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects names longer than 64 characters at the schema layer", async () => {
    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.rooms.rename({ roomId: 30001, name: "x".repeat(65) })
    ).rejects.toThrow();
  });

  it("trims whitespace before persisting", async () => {
    renameRoom.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createCtx());
    await caller.rooms.rename({ roomId: 30002, name: "  RDU Annex  " });
    expect(renameRoom).toHaveBeenCalledWith({ roomId: 30002, name: "RDU Annex" });
  });
});
