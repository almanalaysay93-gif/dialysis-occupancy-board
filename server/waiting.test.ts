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
  listWaiting: vi.fn(async () => []),
  addWaiting: vi.fn(async () => ({ id: 42 })),
  removeWaiting: vi.fn(async () => undefined),
  markWaitingUrgent: vi.fn(async () => undefined),
  countVacantMachines: vi.fn(async () => 3),
  admitWaiting: vi.fn(async () => undefined),
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
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return { ctx, mocked: machineDb };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("waiting.list", () => {
  it("returns waiting patients ordered by priority tier", async () => {
    vi.mocked(machineDb.listWaiting).mockResolvedValueOnce([
      { id: 1, patientId: "P-1", floorId: 30001, priority: "veryUrgent", addedBy: "staff", joinedAt: new Date() },
      { id: 2, patientId: "P-2", floorId: 30001, priority: "urgent", addedBy: null, joinedAt: new Date() },
      { id: 3, patientId: "P-3", floorId: 30001, priority: "normal", addedBy: null, joinedAt: new Date() },
    ]);

    const caller = appRouter.createCaller(createStaffContext().ctx);
    const result = await caller.waiting.list({ floorId: 30001 });

    expect(result).toHaveLength(3);
    expect(result[0]?.priority).toBe("veryUrgent");
    expect(result[1]?.priority).toBe("urgent");
    expect(result[2]?.priority).toBe("normal");
    expect(vi.mocked(machineDb.listWaiting)).toHaveBeenCalledWith({ floorId: 30001 });
  });
});

describe("waiting.add", () => {
  it("adds a patient with the given priority", async () => {
    const caller = appRouter.createCaller(createStaffContext().ctx);
    const result = await caller.waiting.add({
      floorId: 30002,
      patientId: "P-9011",
      priority: "veryUrgent",
    });

    expect(result.success).toBe(true);
    expect(result.entryId).toBe(42);
    expect(vi.mocked(machineDb.addWaiting)).toHaveBeenCalledWith({
      floorId: 30002,
      patientId: "P-9011",
      priority: "veryUrgent",
      addedBy: "Staff Member",
    });
  });

  it("rejects an empty patient identifier", async () => {
    const caller = appRouter.createCaller(createStaffContext().ctx);
    await expect(
      caller.waiting.add({ floorId: 30001, patientId: "   ", priority: "normal" })
    ).rejects.toThrow(TRPCError);
    expect(vi.mocked(machineDb.addWaiting)).not.toHaveBeenCalled();
  });

  it("rejects patient identifiers longer than 64 characters", async () => {
    const caller = appRouter.createCaller(createStaffContext().ctx);
    await expect(
      caller.waiting.add({
        floorId: 30001,
        patientId: "P".repeat(65),
        priority: "normal",
      })
    ).rejects.toThrow(TRPCError);
    expect(vi.mocked(machineDb.addWaiting)).not.toHaveBeenCalled();
  });

  it("defaults priority to normal", async () => {
    const caller = appRouter.createCaller(createStaffContext().ctx);
    await caller.waiting.add({ floorId: 30003, patientId: "P-0001" });

    expect(vi.mocked(machineDb.addWaiting)).toHaveBeenCalledWith({
      floorId: 30003,
      patientId: "P-0001",
      priority: "normal",
      addedBy: "Staff Member",
    });
  });
});

describe("waiting.remove", () => {
  it("removes the waiting entry on the given floor", async () => {
    const caller = appRouter.createCaller(createStaffContext().ctx);
    const result = await caller.waiting.remove({ entryId: 7, floorId: 30001 });

    expect(result.success).toBe(true);
    expect(vi.mocked(machineDb.removeWaiting)).toHaveBeenCalledWith({
      entryId: 7,
      floorId: 30001,
    });
  });
});

describe("waiting.setPriority", () => {
  it("escalates a patient to very urgent", async () => {
    const caller = appRouter.createCaller(createStaffContext().ctx);
    const result = await caller.waiting.setPriority({
      entryId: 3,
      floorId: 30001,
      priority: "veryUrgent",
    });

    expect(result.success).toBe(true);
    expect(vi.mocked(machineDb.markWaitingUrgent)).toHaveBeenCalledWith({
      entryId: 3,
      floorId: 30001,
      priority: "veryUrgent",
    });
  });

  it("accepts all three priority levels", async () => {
    const caller = appRouter.createCaller(createStaffContext().ctx);
    for (const priority of ["normal", "urgent", "veryUrgent"] as const) {
      await caller.waiting.setPriority({ entryId: 3, floorId: 30001, priority });
    }
    expect(vi.mocked(machineDb.markWaitingUrgent)).toHaveBeenCalledTimes(3);
  });
});

describe("waiting.vacantCount", () => {
  it("returns the number of vacant machines on the floor", async () => {
    vi.mocked(machineDb.countVacantMachines).mockResolvedValueOnce(12);

    const caller = appRouter.createCaller(createStaffContext().ctx);
    const result = await caller.waiting.vacantCount({ floorId: 30001 });

    expect(result).toBe(12);
    expect(vi.mocked(machineDb.countVacantMachines)).toHaveBeenCalledWith({ floorId: 30001 });
  });
});

describe("waiting.admit", () => {
  it("admits the waiting patient onto a vacant machine", async () => {
    vi.mocked(machineDb.listWaiting).mockResolvedValueOnce([
      { id: 5, patientId: "P-505", floorId: 30001, priority: "veryUrgent", addedBy: "staff", joinedAt: new Date() },
    ]);

    const caller = appRouter.createCaller(createStaffContext().ctx);
    const result = await caller.waiting.admit({
      entryId: 5,
      floorId: 30001,
      durationMinutes: 240,
      isolationTag: "dirty",
      urgent: true,
    });

    expect(result.success).toBe(true);
    expect(result.patientId).toBe("P-505");
    expect(vi.mocked(machineDb.admitWaiting)).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: 5,
        floorId: 30001,
        durationMinutes: 240,
        isolationTag: "dirty",
        urgent: true,
        startedBy: "Staff Member",
      })
    );
  });

  it("maps NO_VACANT_MACHINE to a staff-friendly error", async () => {
    vi.mocked(machineDb.listWaiting).mockResolvedValueOnce([
      { id: 5, patientId: "P-505", floorId: 30001, priority: "normal", addedBy: null, joinedAt: new Date() },
    ]);
    vi.mocked(machineDb.admitWaiting).mockRejectedValueOnce(new Error("NO_VACANT_MACHINE"));

    const caller = appRouter.createCaller(createStaffContext().ctx);
    await expect(
      caller.waiting.admit({
        entryId: 5,
        floorId: 30001,
        durationMinutes: 240,
        isolationTag: "clean",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /no vacant machine/i });
  });

  it("maps NO_WAITING_PATIENT to a staff-friendly error", async () => {
    vi.mocked(machineDb.listWaiting).mockResolvedValueOnce([]);
    vi.mocked(machineDb.admitWaiting).mockRejectedValueOnce(new Error("NO_WAITING_PATIENT"));

    const caller = appRouter.createCaller(createStaffContext().ctx);
    await expect(
      caller.waiting.admit({
        entryId: 99,
        floorId: 30001,
        durationMinutes: 240,
        isolationTag: "clean",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /no longer waiting/i });
  });

  it("rejects durations outside 15–1440 minutes", async () => {
    const caller = appRouter.createCaller(createStaffContext().ctx);
    await expect(
      caller.waiting.admit({
        entryId: 5,
        floorId: 30001,
        durationMinutes: 5,
        isolationTag: "clean",
      })
    ).rejects.toThrow(TRPCError);
    expect(vi.mocked(machineDb.admitWaiting)).not.toHaveBeenCalled();
  });

  it("rejects anonymous users", async () => {
    const userlessCtx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(userlessCtx);
    await expect(
      caller.waiting.admit({
        entryId: 5,
        floorId: 30001,
        durationMinutes: 240,
        isolationTag: "clean",
      })
    ).rejects.toThrow(TRPCError);
    expect(vi.mocked(machineDb.admitWaiting)).not.toHaveBeenCalled();
  });
});
