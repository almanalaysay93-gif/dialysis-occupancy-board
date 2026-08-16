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
  listWaitingAll: vi.fn(async () => []),
  addWaiting: vi.fn(async () => ({ id: 42 })),
  removeWaiting: vi.fn(async () => undefined),
  markWaitingUrgent: vi.fn(async () => undefined),
  countVacantMachines: vi.fn(async () => 3),
  admitWaiting: vi.fn(async () => undefined),
  listNurseAssignments: vi.fn(async () => []),
}));
import * as machineDb from "./machines";

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
      durationMinutes: 240,
      isolationTag: "clean",
      assignedNurse: null,
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
      durationMinutes: 240,
      isolationTag: "clean",
      assignedNurse: null,
      addedBy: "Staff Member",
    });
  });

  it("carries the treatment length, isolation tag and nurse onto the queue entry", async () => {
    const caller = appRouter.createCaller(createStaffContext().ctx);
    await caller.waiting.add({
      floorId: 30001,
      patientId: "P-7788",
      priority: "urgent",
      durationMinutes: 255,
      isolationTag: "dirty",
      assignedNurse: "  Nurse Ana  ",
    });

    expect(vi.mocked(machineDb.addWaiting)).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMinutes: 255,
        isolationTag: "dirty",
        assignedNurse: "Nurse Ana",
      })
    );
  });

  it("rejects a treatment length outside 15–1440 minutes", async () => {
    const caller = appRouter.createCaller(createStaffContext().ctx);
    await expect(
      caller.waiting.add({ floorId: 30001, patientId: "P-1", durationMinutes: 5 })
    ).rejects.toThrow(TRPCError);
    expect(vi.mocked(machineDb.addWaiting)).not.toHaveBeenCalled();
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

  it("leaves duration and tag unset so the queue entry's own details are used", async () => {
    vi.mocked(machineDb.listWaiting).mockResolvedValueOnce([
      { id: 5, patientId: "P-505", floorId: 30001, priority: "normal", addedBy: null, joinedAt: new Date() },
    ] as Awaited<ReturnType<typeof machineDb.listWaiting>>);

    const caller = appRouter.createCaller(createStaffContext().ctx);
    await caller.waiting.admit({ entryId: 5, floorId: 30001 });

    const call = vi.mocked(machineDb.admitWaiting).mock.calls[0][0];
    expect(call.durationMinutes).toBeUndefined();
    expect(call.isolationTag).toBeUndefined();
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

  it("accepts the 4-hour preset (240 min)", async () => {
    vi.mocked(machineDb.admitWaiting).mockResolvedValueOnce(undefined);
    const caller = appRouter.createCaller(createStaffContext().ctx);

    await caller.waiting.admit({
      entryId: 5,
      floorId: 30001,
      durationMinutes: 240,
      isolationTag: "clean",
    });

    expect(vi.mocked(machineDb.admitWaiting)).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 240 }),
    );
  });

  it("accepts custom durations that are not preset multiples (e.g. 4h15m = 255 min)", async () => {
    vi.mocked(machineDb.admitWaiting).mockResolvedValueOnce(undefined);
    const caller = appRouter.createCaller(createStaffContext().ctx);

    await caller.waiting.admit({
      entryId: 5,
      floorId: 30001,
      durationMinutes: 255,
      isolationTag: "clean",
      urgent: false,
    });

    expect(vi.mocked(machineDb.admitWaiting)).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 255 }),
    );
  });

  it("accepts boundary custom durations (15 min and 24 h)", async () => {
    vi.mocked(machineDb.admitWaiting).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createStaffContext().ctx);

    await caller.waiting.admit({ entryId: 5, floorId: 30001, durationMinutes: 15, isolationTag: "clean" });
    await caller.waiting.admit({ entryId: 5, floorId: 30001, durationMinutes: 1440, isolationTag: "dirty" });

    expect(vi.mocked(machineDb.admitWaiting)).toHaveBeenCalledTimes(2);
  });

  it("rejects durations above the 24 h cap (e.g. 25 h = 1500 min)", async () => {
    const caller = appRouter.createCaller(createStaffContext().ctx);
    await expect(
      caller.waiting.admit({
        entryId: 5,
        floorId: 30001,
        durationMinutes: 1500,
        isolationTag: "clean",
      }),
    ).rejects.toThrow(TRPCError);
    expect(vi.mocked(machineDb.admitWaiting)).not.toHaveBeenCalled();
  });

  it("rejects guest-only staff sessions", async () => {
    const { resolveStaffSession } = await import("./staffAuth");
    vi.mocked(resolveStaffSession).mockResolvedValueOnce({
      accountId: 0,
      username: "",
      displayName: "Guest",
      role: "guest" as never,
      assignedFloorId: null,
    });
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

describe("waiting.urgentRegister", () => {
  const floors = [
    { id: 30001, code: "F1", name: "SKTI Main", sortOrder: 1 },
    { id: 30002, code: "F2", name: "RDU Annex", sortOrder: 2 },
  ];

  function machineRow(opts: {
    machineId: number;
    label: string;
    floorId: number | null;
    urgent?: boolean;
  }): {
    machine: {
      id: number;
      label: string;
      location: string;
      floorId: number | null;
      sortOrder: number;
    };
    session: {
      id: number;
      machineId: number;
      patientId: string;
      durationMinutes: number;
      startedAt: Date;
      endsAt: Date;
      isolationTag: "clean" | "dirty";
      urgent: boolean;
      startedBy: string | null;
    } | null;
  } {
    const now = new Date();
    const endsAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    return {
      machine: {
        id: opts.machineId,
        label: opts.label,
        location: "Row 2 · Pos 5",
        floorId: opts.floorId,
        sortOrder: 1,
      },
      session: opts.urgent
        ? {
            id: opts.machineId * 10,
            machineId: opts.machineId,
            patientId: `P-${opts.machineId}`,
            durationMinutes: 240,
            startedAt: now,
            endsAt,
            isolationTag: "clean",
            urgent: true,
            startedBy: "staff",
          }
        : null,
    };
  }

  it("aggregates urgent sessions from every board with floor names", async () => {
    vi.mocked(machineDb.listFloors).mockResolvedValueOnce(floors);
    vi.mocked(machineDb.listMachines).mockResolvedValueOnce([
      machineRow({ machineId: 1, label: "HD-001", floorId: 30001, urgent: true }),
      machineRow({ machineId: 2, label: "HD-002", floorId: 30002, urgent: true }),
      machineRow({ machineId: 3, label: "HD-003", floorId: 30001, urgent: false }),
    ]);
    vi.mocked(machineDb.listWaitingAll).mockResolvedValueOnce([]);

    const caller = appRouter.createCaller(createStaffContext().ctx);
    const result = await caller.waiting.urgentRegister();

    expect(result.urgentSessions).toHaveLength(2);
    expect(result.urgentSessions.map(s => s.floorName)).toEqual([
      "SKTI Main",
      "RDU Annex",
    ]);
    expect(result.veryUrgentWaiting).toHaveLength(0);
  });

  it("includes very-urgent waiting patients from every board", async () => {
    vi.mocked(machineDb.listFloors).mockResolvedValueOnce(floors);
    vi.mocked(machineDb.listMachines).mockResolvedValueOnce([]);
    vi.mocked(machineDb.listWaitingAll).mockResolvedValueOnce([
      {
        id: 9,
        patientId: "P-9001",
        floorId: 30001,
        priority: "veryUrgent" as const,
        addedBy: "staff",
        joinedAt: new Date(),
      },
      {
        id: 10,
        patientId: "P-9002",
        floorId: 30002,
        priority: "normal" as const,
        addedBy: null,
        joinedAt: new Date(),
      },
      {
        id: 11,
        patientId: "P-9003",
        floorId: 30001,
        priority: "urgent" as const,
        addedBy: null,
        joinedAt: new Date(),
      },
    ]);

    const caller = appRouter.createCaller(createStaffContext().ctx);
    const result = await caller.waiting.urgentRegister();

    expect(result.veryUrgentWaiting).toHaveLength(1);
    expect(result.veryUrgentWaiting[0]?.patientId).toBe("P-9001");
    expect(result.veryUrgentWaiting[0]?.floorName).toBe("SKTI Main");
    expect(result.urgentSessions).toHaveLength(0);
  });

  it("handles machines without a floor gracefully", async () => {
    vi.mocked(machineDb.listFloors).mockResolvedValueOnce([]);
    vi.mocked(machineDb.listMachines).mockResolvedValueOnce([
      machineRow({ machineId: 4, label: "HD-004", floorId: null, urgent: true }),
    ]);
    vi.mocked(machineDb.listWaitingAll).mockResolvedValueOnce([]);

    const caller = appRouter.createCaller(createStaffContext().ctx);
    const result = await caller.waiting.urgentRegister();

    expect(result.urgentSessions).toHaveLength(1);
    expect(result.urgentSessions[0]?.floorName).toBeNull();
  });
});

describe("waiting.nurseAssignments", () => {
  it("delegates to listNurseAssignments for the requested floor", async () => {
    const rows = [
      {
        nurse: "Nurse Ana",
        machineId: 1,
        machineLabel: "HD-001",
        patientId: "P-1",
        displayLabel: null,
        endsAt: new Date(Date.now() + 60 * 60_000),
        durationMinutes: 180,
        startedAt: new Date(),
        urgent: false,
        isolationTag: "clean" as const,
      },
    ];
    vi.mocked(machineDb.listNurseAssignments).mockResolvedValueOnce(rows);

    const caller = appRouter.createCaller(createStaffContext().ctx);
    const result = await caller.waiting.nurseAssignments({ floorId: 30001 });
    expect(result).toHaveLength(1);
    expect(result[0]?.nurse).toBe("Nurse Ana");
    expect(machineDb.listNurseAssignments).toHaveBeenCalledWith({ floorId: 30001 });
  });

  it("returns an empty roster when no sessions are active on the floor", async () => {
    vi.mocked(machineDb.listNurseAssignments).mockResolvedValueOnce([]);

    const caller = appRouter.createCaller(createStaffContext().ctx);
    const result = await caller.waiting.nurseAssignments({ floorId: 30002 });
    expect(result).toHaveLength(0);
  });

  it("is a public procedure callable without authentication", async () => {
    const unauthenticatedCtx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    vi.mocked(machineDb.listNurseAssignments).mockResolvedValueOnce([]);

    const caller = appRouter.createCaller(unauthenticatedCtx);
    const result = await caller.waiting.nurseAssignments({ floorId: 30003 });
    expect(result).toHaveLength(0);
  });
});

describe("guest viewers never receive clinical panel data", () => {
  function guestContext(): TrpcContext {
    return {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
  }

  it("waiting.list returns an empty queue for guest cookie sessions", async () => {
    const { resolveStaffSession } = await import("./staffAuth");
    vi.mocked(resolveStaffSession).mockResolvedValueOnce({
      accountId: 0,
      username: "",
      displayName: "Guest",
      role: "guest" as never,
      assignedFloorId: null,
      fromCookie: true,
    });
    vi.mocked(machineDb.listWaiting).mockResolvedValueOnce([
      { id: 1, patientId: "P-1", floorId: 30001, priority: "veryUrgent", addedBy: "staff", joinedAt: new Date() },
    ]);

    const caller = appRouter.createCaller(guestContext());
    const result = await caller.waiting.list({ floorId: 30001 });

    expect(result).toEqual([]);
    expect(vi.mocked(machineDb.listWaiting)).not.toHaveBeenCalled();
  });

  it("waiting.urgentRegister returns empty registers for guest cookie sessions", async () => {
    const { resolveStaffSession } = await import("./staffAuth");
    vi.mocked(resolveStaffSession).mockResolvedValueOnce({
      accountId: 0,
      username: "",
      displayName: "Guest",
      role: "guest" as never,
      assignedFloorId: null,
      fromCookie: true,
    });
    vi.mocked(machineDb.listMachines).mockResolvedValueOnce([]);

    const caller = appRouter.createCaller(guestContext());
    const result = await caller.waiting.urgentRegister();

    expect(result).toEqual({ urgentSessions: [], veryUrgentWaiting: [] });
    expect(vi.mocked(machineDb.listMachines)).not.toHaveBeenCalled();
  });

  it("waiting.nurseAssignments returns an empty roster for guest cookie sessions", async () => {
    const { resolveStaffSession } = await import("./staffAuth");
    vi.mocked(resolveStaffSession).mockResolvedValueOnce({
      accountId: 0,
      username: "",
      displayName: "Guest",
      role: "guest" as never,
      assignedFloorId: null,
      fromCookie: true,
    });
    vi.mocked(machineDb.listNurseAssignments).mockResolvedValueOnce([
      { nurse: "Nurse Ana", machineId: 1, machineLabel: "HD-001", patientId: "P-1", displayLabel: null, endsAt: new Date(), durationMinutes: 180, startedAt: new Date(), urgent: false, isolationTag: "clean" },
    ]);

    const caller = appRouter.createCaller(guestContext());
    const result = await caller.waiting.nurseAssignments({ floorId: 30001 });

    expect(result).toEqual([]);
    expect(vi.mocked(machineDb.listNurseAssignments)).not.toHaveBeenCalled();
  });
});
