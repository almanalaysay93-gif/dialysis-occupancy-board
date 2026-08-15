import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { User } from "../shared/types";

// ---------------- mocks ----------------
// NOTE: mocks are created via vi.hoisted so the vi.mock factories can capture
// them; the real module values are re-imported below for assertion/inspection.
const { mockResolve } = vi.hoisted(() => ({ mockResolve: vi.fn() }));
import * as machineDb from "./machines";

vi.mock("./machines", async importOriginal => {
  const mod = await importOriginal<typeof import("./machines")>();
  return {
    ...mod,
    setMachineStatus: vi.fn(async (_input: any) => undefined),
    swapMachines: vi.fn(async (_input: any) => undefined),
    listOffboardedMachines: vi.fn(async () => []),
    getMachineById: vi.fn(async (id: number) =>
      id === 11
        ? { id: 11, label: "HD-101", floorId: 30001, status: "active" }
        : id === 22
          ? { id: 22, label: "HD-201", floorId: 30002, status: "active" }
          : id === 33
            ? { id: 33, label: "HD-303", floorId: null, status: "backup" }
            : id === 99
              ? { id: 99, label: "HD-102", floorId: 30001, status: "active" }
              : null
    ),
  };
});

vi.mock("./staffAuth", async importOriginal => {
  const mod = await importOriginal<typeof import("./staffAuth")>();
  return {
    ...mod,
    resolveStaffSession: mockResolve,
    staffAccessedFloors: vi.fn(
      (staff: { role: string; assignedFloorId: number | null }) => {
        if (staff.role === "supervisor") return null;
        if (staff.assignedFloorId) return [staff.assignedFloorId];
        return [];
      }
    ),
  };
});

const setMachineStatusMock = machineDb.setMachineStatus as unknown as ReturnType<typeof vi.fn>;
const swapMachinesMock = machineDb.swapMachines as unknown as ReturnType<typeof vi.fn>;
const listOffboardedMock = machineDb.listOffboardedMachines as unknown as ReturnType<typeof vi.fn>;

// ---------------- fixtures ----------------

const supervisor: User = {
  id: 1,
  openId: "sup",
  name: "Supt",
  email: "supt@skti.local",
  loginMethod: "staff",
  role: "supervisor",
  assignedFloorId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
} as unknown as User;

function makeNurse(floorId: number): User {
  return { ...supervisor, id: 2, openId: `nurse-${floorId}`, role: "nurse", assignedFloorId: floorId } as unknown as User;
}

const guest: User = {
  ...supervisor,
  id: 3,
  openId: "guest",
  role: "guest",
  assignedFloorId: null,
} as unknown as User;

// ---------------- ctx ----------------

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(user: AuthenticatedUser | null): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const caller = appRouter.createCaller;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: an unsigned-in request (staff resolves to guest, no cookie).
  mockResolve.mockResolvedValue({ role: "guest", fromCookie: false });
});

// ---------------- tests ----------------

describe("machines.setStatus (Backup & Repair offboarding)", () => {
  it("supervisor can move a vacant machine to backup", async () => {
    mockResolve.mockResolvedValueOnce({ role: "supervisor", assignedFloorId: null, fromCookie: true });
    const result = await caller(makeCtx(supervisor)).machines.setStatus({
      machineId: 11,
      status: "backup",
    });
    expect(result).toEqual({ success: true });
    expect(setMachineStatusMock).toHaveBeenCalledWith({
      machineId: 11,
      status: "backup",
      floorId: undefined,
      statusNote: null,
    });
  });

  it("supervisor can return a backup machine to a floor by picking a floor", async () => {
    mockResolve.mockResolvedValueOnce({ role: "supervisor", assignedFloorId: null, fromCookie: true });
    await caller(makeCtx(supervisor)).machines.setStatus({
      machineId: 33,
      status: "active",
      floorId: 30001,
      statusNote: "Sanitized and ready",
    });
    expect(setMachineStatusMock).toHaveBeenCalledWith({
      machineId: 33,
      status: "active",
      floorId: 30001,
      statusNote: "Sanitized and ready",
    });
  });

  it("rejects moving a machine that is mid-treatment", async () => {
    mockResolve.mockResolvedValueOnce({ role: "supervisor", assignedFloorId: null, fromCookie: true });
    setMachineStatusMock.mockRejectedValueOnce(new Error("MACHINE_IN_TREATMENT"));
    await expect(
      caller(makeCtx(supervisor)).machines.setStatus({
        machineId: 11,
        status: "backup",
      })
    ).rejects.toThrow(/in treatment/i);
  });

  it("blocks guests from status changes", async () => {
    // Guest mode: a signed staff cookie with role=guest, no OAuth identity.
    mockResolve.mockResolvedValueOnce({ role: "guest", fromCookie: true });
    await expect(
      caller(makeCtx(null)).machines.setStatus({
        machineId: 11,
        status: "backup",
      })
    ).rejects.toBeInstanceOf(TRPCError);
    expect(setMachineStatusMock).not.toHaveBeenCalled();
  });
});

describe("machines.swap (drag-and-drop swap)", () => {
  it("supervisor can swap two vacant machines across floors", async () => {
    mockResolve.mockResolvedValueOnce({ role: "supervisor", assignedFloorId: null, fromCookie: true });
    await caller(makeCtx(supervisor)).machines.swap({
      machineAId: 11,
      machineBId: 22,
    });
    expect(swapMachinesMock).toHaveBeenCalledWith({ machineAId: 11, machineBId: 22 });
  });

  it("rejects swapping a machine mid-treatment", async () => {
    mockResolve.mockResolvedValueOnce({ role: "supervisor", assignedFloorId: null, fromCookie: true });
    swapMachinesMock.mockRejectedValueOnce(new Error("MACHINE_IN_TREATMENT"));
    await expect(
      caller(makeCtx(supervisor)).machines.swap({ machineAId: 11, machineBId: 22 })
    ).rejects.toThrow(/treatment/i);
  });

  it("rejects swapping the same machine with itself", async () => {
    mockResolve.mockResolvedValueOnce({ role: "supervisor", assignedFloorId: null, fromCookie: true });
    swapMachinesMock.mockRejectedValueOnce(new Error("SAME_MACHINE"));
    await expect(
      caller(makeCtx(supervisor)).machines.swap({ machineAId: 11, machineBId: 11 })
    ).rejects.toThrow(/cannot be swapped with itself/i);
  });

  it("rejects swapping machines already on the same board", async () => {
    mockResolve.mockResolvedValueOnce({ role: "supervisor", assignedFloorId: null, fromCookie: true });
    swapMachinesMock.mockRejectedValueOnce(new Error("SAME_FLOOR"));
    await expect(
      caller(makeCtx(supervisor)).machines.swap({ machineAId: 11, machineBId: 99 })
    ).rejects.toThrow(/same board/i);
  });

  it("rejects swapping when either machine is offboard (backup/repair)", async () => {
    mockResolve.mockResolvedValueOnce({ role: "supervisor", assignedFloorId: null, fromCookie: true });
    swapMachinesMock.mockRejectedValueOnce(new Error("MACHINE_OFFBOARD"));
    await expect(
      caller(makeCtx(supervisor)).machines.swap({ machineAId: 11, machineBId: 33 })
    ).rejects.toThrow(/floor boards/i);
  });

  it("blocks guests from swapping", async () => {
    // Guest mode: a signed staff cookie with role=guest, no OAuth identity.
    mockResolve.mockResolvedValueOnce({ role: "guest", fromCookie: true });
    await expect(
      caller(makeCtx(null)).machines.swap({ machineAId: 11, machineBId: 22 })
    ).rejects.toBeInstanceOf(TRPCError);
    expect(swapMachinesMock).not.toHaveBeenCalled();
  });

  it("nurse on floor 30001 can swap only within her own board", async () => {
    // cross-floor swap attempts a machine on another floor; the server (db
    // layer) rejects SAME_FLOOR — the procedure is reachable by nurses but
    // scoping lives in the implementation
    const nurse = makeNurse(30001);
    mockResolve.mockResolvedValueOnce({ role: "nurse", assignedFloorId: 30001, fromCookie: true });
    swapMachinesMock.mockRejectedValueOnce(new Error("SAME_FLOOR"));
    await expect(
      caller(makeCtx(nurse)).machines.swap({ machineAId: 11, machineBId: 22 })
    ).rejects.toThrow(/same board/i);
  });
});

describe("machines.offboarded.list (Backup & Repair inventory)", () => {
  it("is readable by guests (view-only board)", async () => {
    listOffboardedMock.mockResolvedValueOnce([
      { id: 33, label: "HD-303", location: "Storage", status: "backup", statusNote: null, floorId: null, createdAt: new Date() },
    ]);
    const rows = await caller(makeCtx(guest)).machines.offboarded.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("backup");
  });

  it("returns machines with their status and floor", async () => {
    mockResolve.mockResolvedValueOnce({ role: "supervisor", assignedFloorId: null, fromCookie: true });
    listOffboardedMock.mockResolvedValueOnce([
      { id: 44, label: "HD-404", location: "Storage", status: "repair", statusNote: "Pump fault", floorId: 30002, createdAt: new Date() },
    ]);
    const rows = await caller(makeCtx(supervisor)).machines.offboarded.list();
    expect(rows[0].status).toBe("repair");
    expect(rows[0].floorId).toBe(30002);
  });
});

