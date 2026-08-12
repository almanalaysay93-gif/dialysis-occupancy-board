import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ---------- mocks for machineDb ----------
const assignSession = vi.fn();
const updateMachineLabel = vi.fn();
vi.mock("./machines", async importOriginal => {
  const actual = await importOriginal<typeof import("./machines")>();
  return {
    ...actual,
    assignSession: (...args: unknown[]) => assignSession(...args),
    updateMachineLabel: (...args: unknown[]) => updateMachineLabel(...args),
  };
});

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createCtx(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
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
    res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
  };
}

describe("sessions.assign with custom duration", () => {
  beforeEach(() => {
    assignSession.mockReset();
    updateMachineLabel.mockReset();
    assignSession.mockResolvedValue({ id: 77 });
  });

  it("accepts a preset duration string", async () => {
    const caller = appRouter.createCaller(createCtx());
    await caller.sessions.assign({
      machineId: 5,
      patientId: "P-101",
      durationMinutes: "180",
      customMinutes: null,
      isolationTag: "clean",
      urgent: false,
    });
    expect(assignSession).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 180 })
    );
  });

  it("accepts a numeric custom duration in minutes (e.g. 240 for 4h)", async () => {
    const caller = appRouter.createCaller(createCtx());
    await caller.sessions.assign({
      machineId: 5,
      patientId: "P-102",
      durationMinutes: 240,
      customMinutes: null,
      isolationTag: "dirty",
      urgent: true,
    });
    expect(assignSession).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 240 })
    );
  });

  it("accepts a custom numeric duration paired with customMinutes fallback", async () => {
    const caller = appRouter.createCaller(createCtx());
    await caller.sessions.assign({
      machineId: 5,
      patientId: "P-103",
      durationMinutes: "custom",
      customMinutes: 270, // 4 h 30 m
      isolationTag: "clean",
      urgent: false,
    });
    expect(assignSession).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 270 })
    );
  });

  it("rejects durations below 15 minutes", async () => {
    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.sessions.assign({
        machineId: 5,
        patientId: "P-104",
        durationMinutes: 10,
        customMinutes: null,
        isolationTag: "clean",
        urgent: false,
      })
    ).rejects.toThrow();
  });

  it("rejects durations above 24 hours (1440 min)", async () => {
    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.sessions.assign({
        machineId: 5,
        patientId: "P-105",
        durationMinutes: 1500,
        customMinutes: null,
        isolationTag: "clean",
        urgent: false,
      })
    ).rejects.toThrow();
  });

  it("requires customMinutes when durationMinutes is \"custom\"", async () => {
    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.sessions.assign({
        machineId: 5,
        patientId: "P-106",
        durationMinutes: "custom",
        customMinutes: null,
        isolationTag: "clean",
        urgent: false,
      })
    ).rejects.toThrow();
  });
});

describe("machines.updateLabel", () => {
  beforeEach(() => {
    assignSession.mockReset();
    updateMachineLabel.mockReset();
    updateMachineLabel.mockResolvedValue(undefined);
  });

  it("renames a machine", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.machines.updateLabel({
      machineId: 4,
      label: "M-4A",
    });
    expect(result.success).toBe(true);
    expect(updateMachineLabel).toHaveBeenCalledWith({
      machineId: 4,
      label: "M-4A",
    });
  });

  it("reports a human error when the new label already exists", async () => {
    updateMachineLabel.mockRejectedValue(new Error("MACHINE_LABEL_EXISTS"));
    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.machines.updateLabel({ machineId: 4, label: "HD-002" })
    ).rejects.toThrow(TRPCError);
  });
});
