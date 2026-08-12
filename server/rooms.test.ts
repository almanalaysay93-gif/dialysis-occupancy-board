import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

vi.mock("./machines", () => ({
  listFloors: vi.fn(async () => []),
  listMachines: vi.fn(async () => []),
  addRoom: vi.fn(async () => ({ id: 42 })),
  removeRoom: vi.fn(async () => undefined),
  addMachine: vi.fn(async () => ({ id: 7 })),
  removeMachine: vi.fn(async () => undefined),
  assignSession: vi.fn(async () => ({ id: 11 })),
  endSession: vi.fn(async () => undefined),
  toggleUrgent: vi.fn(async () => undefined),
  updateIsolationTag: vi.fn(async () => undefined),
}));

import * as machineDb from "./machines";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createStaffContext(): { ctx: TrpcContext; mocked: typeof machineDb } {
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

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return { ctx, mocked: machineDb };
}

describe("rooms.list", () => {
  it("returns floors via listFloors", async () => {
    vi.mocked(machineDb.listFloors).mockResolvedValueOnce([
      { id: 1, code: "F1", name: "Floor 1", sortOrder: 1, createdAt: new Date() },
    ]);
    const caller = appRouter.createCaller(createStaffContext().ctx);
    const rooms = await caller.rooms.list();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.name).toBe("Floor 1");
  });
});

describe("rooms.add", () => {
  it("requires authentication", async () => {
    const anonymousCtx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(anonymousCtx);
    await expect(
      caller.rooms.add({ name: "Floor 4" })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("adds a room with the supplied name", async () => {
    const { ctx } = createStaffContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.rooms.add({ name: "Floor 4" });
    expect(result).toEqual({ success: true, roomId: 42 });
    expect(machineDb.addRoom).toHaveBeenCalledWith({ name: "Floor 4" });
  });

  it("reports a conflict when the room name already exists", async () => {
    vi.mocked(machineDb.addRoom).mockRejectedValueOnce(new Error("ROOM_EXISTS"));
    const caller = appRouter.createCaller(createStaffContext().ctx);
    await expect(
      caller.rooms.add({ name: "Floor 1" })
    ).rejects.toThrow("already exists");
  });
});

describe("rooms.remove", () => {
  it("requires authentication", async () => {
    const anonymousCtx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(anonymousCtx);
    await expect(
      caller.rooms.remove({ roomId: 1 })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("removes an empty room", async () => {
    const caller = appRouter.createCaller(createStaffContext().ctx);
    const result = await caller.rooms.remove({ roomId: 3 });
    expect(result).toEqual({ success: true });
    expect(machineDb.removeRoom).toHaveBeenCalledWith({ roomId: 3 });
  });

  it("blocks removal when machines still belong to the room", async () => {
    vi.mocked(machineDb.removeRoom).mockRejectedValueOnce(
      new Error("ROOM_HAS_MACHINES")
    );
    const caller = appRouter.createCaller(createStaffContext().ctx);
    await expect(
      caller.rooms.remove({ roomId: 1 })
    ).rejects.toThrow("still has machines");
  });

  it("blocks removal when sessions are active in the room", async () => {
    vi.mocked(machineDb.removeRoom).mockRejectedValueOnce(
      new Error("ROOM_HAS_ACTIVE_SESSIONS")
    );
    const caller = appRouter.createCaller(createStaffContext().ctx);
    await expect(
      caller.rooms.remove({ roomId: 2 })
    ).rejects.toThrow("in treatment");
  });
});
