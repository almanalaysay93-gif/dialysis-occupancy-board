import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ---------- mocks for machineDb ----------
const listShiftEndorsements = vi.fn();
const getShiftEndorsementById = vi.fn();
const createShiftEndorsement = vi.fn();
const updateShiftEndorsement = vi.fn();
const deleteShiftEndorsement = vi.fn();

const listSessionComplications = vi.fn();
const createSessionComplication = vi.fn();
const updateSessionComplication = vi.fn();
const deleteSessionComplication = vi.fn();

const listWaterQualityLogs = vi.fn();
const getWaterQualityLogById = vi.fn();
const createWaterQualityLog = vi.fn();
const updateWaterQualityLog = vi.fn();
const deleteWaterQualityLog = vi.fn();

const listInfectionSurveillance = vi.fn();
const getInfectionSurveillanceByPatientId = vi.fn();
const upsertInfectionSurveillance = vi.fn();
const deleteInfectionSurveillance = vi.fn();

const listInventorySupplies = vi.fn();
const getInventorySupplyByItemCode = vi.fn();
const addInventorySupply = vi.fn();
const updateInventorySupply = vi.fn();
const adjustInventoryStock = vi.fn();
const deleteInventorySupply = vi.fn();
const getSessionFloorId = vi.fn();

vi.mock("./machines", async importOriginal => {
  const actual = await importOriginal<typeof import("./machines")>();
  return {
    ...actual,
    listShiftEndorsements: (...args: unknown[]) => listShiftEndorsements(...args),
    getShiftEndorsementById: (...args: unknown[]) => getShiftEndorsementById(...args),
    createShiftEndorsement: (...args: unknown[]) => createShiftEndorsement(...args),
    updateShiftEndorsement: (...args: unknown[]) => updateShiftEndorsement(...args),
    deleteShiftEndorsement: (...args: unknown[]) => deleteShiftEndorsement(...args),

    listSessionComplications: (...args: unknown[]) => listSessionComplications(...args),
    createSessionComplication: (...args: unknown[]) => createSessionComplication(...args),
    updateSessionComplication: (...args: unknown[]) => updateSessionComplication(...args),
    deleteSessionComplication: (...args: unknown[]) => deleteSessionComplication(...args),

    listWaterQualityLogs: (...args: unknown[]) => listWaterQualityLogs(...args),
    getWaterQualityLogById: (...args: unknown[]) => getWaterQualityLogById(...args),
    createWaterQualityLog: (...args: unknown[]) => createWaterQualityLog(...args),
    updateWaterQualityLog: (...args: unknown[]) => updateWaterQualityLog(...args),
    deleteWaterQualityLog: (...args: unknown[]) => deleteWaterQualityLog(...args),

    listInfectionSurveillance: (...args: unknown[]) => listInfectionSurveillance(...args),
    getInfectionSurveillanceByPatientId: (...args: unknown[]) => getInfectionSurveillanceByPatientId(...args),
    upsertInfectionSurveillance: (...args: unknown[]) => upsertInfectionSurveillance(...args),
    deleteInfectionSurveillance: (...args: unknown[]) => deleteInfectionSurveillance(...args),

    listInventorySupplies: (...args: unknown[]) => listInventorySupplies(...args),
    getInventorySupplyByItemCode: (...args: unknown[]) => getInventorySupplyByItemCode(...args),
    addInventorySupply: (...args: unknown[]) => addInventorySupply(...args),
    updateInventorySupply: (...args: unknown[]) => updateInventorySupply(...args),
    adjustInventoryStock: (...args: unknown[]) => adjustInventoryStock(...args),
    deleteInventorySupply: (...args: unknown[]) => deleteInventorySupply(...args),
    getSessionFloorId: (...args: unknown[]) => getSessionFloorId(...args),
  };
});

function createSupervisorCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "supervisor-user",
      email: "supervisor@example.com",
      name: "Supervisor Staff",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
  };
}

describe("SPMCKTI Dialysis Backend Modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("shiftEndorsements router", () => {
    it("creates a shift handover endorsement", async () => {
      createShiftEndorsement.mockResolvedValue({ id: 101 });
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.shiftEndorsements.create({
        shift: "05-13",
        floorId: 1,
        date: "2026-08-28",
        incomingNurse: "Nurse Jane",
        outgoingNurse: "Nurse John",
        patientNotes: "Patient P-101 had slight hypotension",
        accessIssues: "Left AVF slow flow",
        equipmentNotes: "Machine HD-03 calibrated",
      });
      expect(res).toEqual({ success: true, id: 101 });
      expect(createShiftEndorsement).toHaveBeenCalledWith(
        expect.objectContaining({
          shift: "05-13",
          floorId: 1,
          date: "2026-08-28",
          incomingNurse: "Nurse Jane",
          outgoingNurse: "Nurse John",
        })
      );
    });

    it("lists shift handover endorsements", async () => {
      const mockList = [
        {
          id: 101,
          shift: "05-13",
          floorId: 1,
          date: "2026-08-28",
          incomingNurse: "Nurse Jane",
          outgoingNurse: "Nurse John",
          patientNotes: null,
          accessIssues: null,
          equipmentNotes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      listShiftEndorsements.mockResolvedValue(mockList);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.shiftEndorsements.list({ floorId: 1, date: "2026-08-28" });
      expect(res).toEqual(mockList);
    });

    it("updates a shift endorsement", async () => {
      getShiftEndorsementById.mockResolvedValue({ id: 101, floorId: 1 });
      updateShiftEndorsement.mockResolvedValue(undefined);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.shiftEndorsements.update({
        id: 101,
        patientNotes: "Updated patient progress notes",
      });
      expect(res).toEqual({ success: true });
      expect(updateShiftEndorsement).toHaveBeenCalledWith(101, {
        patientNotes: "Updated patient progress notes",
      });
    });

    it("removes a shift endorsement", async () => {
      getShiftEndorsementById.mockResolvedValue({ id: 101, floorId: 1 });
      deleteShiftEndorsement.mockResolvedValue(undefined);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.shiftEndorsements.remove({ id: 101 });
      expect(res).toEqual({ success: true });
      expect(deleteShiftEndorsement).toHaveBeenCalledWith(101);
    });
  });

  describe("sessionComplications router", () => {
    it("creates a session complication record", async () => {
      getSessionFloorId.mockResolvedValue(1);
      createSessionComplication.mockResolvedValue({ id: 201 });
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.sessionComplications.create({
        sessionId: 50,
        complicationType: "hypotension",
        onsetMinutes: 120,
        intervention: "Administered 100mL normal saline, lowered UFR",
        resolved: true,
      });
      expect(res).toEqual({ success: true, id: 201 });
      expect(createSessionComplication).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 50,
          complicationType: "hypotension",
          onsetMinutes: 120,
          resolved: true,
        })
      );
    });

    it("lists complications for a session", async () => {
      const mockComplications = [
        {
          id: 201,
          sessionId: 50,
          complicationType: "hypotension",
          onsetMinutes: 120,
          intervention: "Saline",
          resolved: true,
          createdAt: new Date(),
        },
      ];
      listSessionComplications.mockResolvedValue(mockComplications);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.sessionComplications.list({ sessionId: 50 });
      expect(res).toEqual(mockComplications);
    });

    it("updates complication resolution status", async () => {
      updateSessionComplication.mockResolvedValue(undefined);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.sessionComplications.update({
        id: 201,
        resolved: true,
      });
      expect(res).toEqual({ success: true });
      expect(updateSessionComplication).toHaveBeenCalledWith(201, { resolved: true });
    });

    it("deletes a complication entry", async () => {
      deleteSessionComplication.mockResolvedValue(undefined);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.sessionComplications.remove({ id: 201 });
      expect(res).toEqual({ success: true });
      expect(deleteSessionComplication).toHaveBeenCalledWith(201);
    });
  });

  describe("waterQualityLogs router", () => {
    it("creates a water quality log entry", async () => {
      createWaterQualityLog.mockResolvedValue({ id: 301 });
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.waterQualityLogs.create({
        date: "2026-08-28",
        floorId: 1,
        tdsIn: 180,
        tdsOut: 5,
        chlorineLevel: "<0.01 ppm",
        hardness: "0 gpg",
        waterTemp: "21 C",
        technician: "Tech Mike",
        status: "pass",
      });
      expect(res).toEqual({ success: true, id: 301 });
      expect(createWaterQualityLog).toHaveBeenCalledWith(
        expect.objectContaining({
          date: "2026-08-28",
          floorId: 1,
          tdsIn: 180,
          tdsOut: 5,
          technician: "Tech Mike",
          status: "pass",
        })
      );
    });

    it("lists water quality logs", async () => {
      const mockLogs = [
        {
          id: 301,
          date: "2026-08-28",
          floorId: 1,
          tdsIn: 180,
          tdsOut: 5,
          chlorineLevel: "<0.01 ppm",
          hardness: "0 gpg",
          waterTemp: "21 C",
          technician: "Tech Mike",
          status: "pass",
          createdAt: new Date(),
        },
      ];
      listWaterQualityLogs.mockResolvedValue(mockLogs);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.waterQualityLogs.list({ floorId: 1, date: "2026-08-28" });
      expect(res).toEqual(mockLogs);
    });

    it("updates a water quality log", async () => {
      getWaterQualityLogById.mockResolvedValue({ id: 301, floorId: 1 });
      updateWaterQualityLog.mockResolvedValue(undefined);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.waterQualityLogs.update({
        id: 301,
        status: "pass",
        tdsOut: 4,
      });
      expect(res).toEqual({ success: true });
      expect(updateWaterQualityLog).toHaveBeenCalledWith(301, {
        status: "pass",
        tdsOut: 4,
      });
    });

    it("removes a water quality log", async () => {
      getWaterQualityLogById.mockResolvedValue({ id: 301, floorId: 1 });
      deleteWaterQualityLog.mockResolvedValue(undefined);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.waterQualityLogs.remove({ id: 301 });
      expect(res).toEqual({ success: true });
      expect(deleteWaterQualityLog).toHaveBeenCalledWith(301);
    });
  });

  describe("infectionSurveillance router", () => {
    it("upserts an infection surveillance profile", async () => {
      upsertInfectionSurveillance.mockResolvedValue({ id: 401 });
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.infectionSurveillance.upsert({
        patientId: "P-4821",
        hbsagStatus: "negative",
        hcvStatus: "positive",
        hivStatus: "negative",
        mdrStatus: "negative",
        lastTestedDate: "2026-08-15",
        assignedIsolationRoom: "HCV Isolation Room 2",
      });
      expect(res).toEqual({ success: true, id: 401 });
      expect(upsertInfectionSurveillance).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: "P-4821",
          hcvStatus: "positive",
          assignedIsolationRoom: "HCV Isolation Room 2",
        })
      );
    });

    it("retrieves surveillance profile by patient ID", async () => {
      const mockRecord = {
        id: 401,
        patientId: "P-4821",
        hbsagStatus: "negative",
        hcvStatus: "positive",
        hivStatus: "negative",
        mdrStatus: "negative",
        lastTestedDate: "2026-08-15",
        assignedIsolationRoom: "HCV Isolation Room 2",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      getInfectionSurveillanceByPatientId.mockResolvedValue(mockRecord);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.infectionSurveillance.byPatientId({ patientId: "P-4821" });
      expect(res).toEqual(mockRecord);
    });

    it("removes a surveillance record", async () => {
      deleteInfectionSurveillance.mockResolvedValue(undefined);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.infectionSurveillance.remove({ id: 401 });
      expect(res).toEqual({ success: true });
      expect(deleteInfectionSurveillance).toHaveBeenCalledWith(401);
    });
  });

  describe("inventorySupplies router", () => {
    it("adds a new supply item to inventory", async () => {
      addInventorySupply.mockResolvedValue({ id: 501 });
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.inventorySupplies.add({
        itemCode: "FX-80",
        itemName: "FX CorDiax 80 High-Flux Dialyzer",
        unit: "box",
        currentStock: 24,
        reorderLevel: 10,
        category: "dialyzers",
      });
      expect(res).toEqual({ success: true, id: 501 });
      expect(addInventorySupply).toHaveBeenCalledWith(
        expect.objectContaining({
          itemCode: "FX-80",
          itemName: "FX CorDiax 80 High-Flux Dialyzer",
          currentStock: 24,
        })
      );
    });

    it("retrieves an inventory supply item by item code", async () => {
      const mockItem = {
        id: 501,
        itemCode: "FX-80",
        itemName: "FX CorDiax 80 High-Flux Dialyzer",
        unit: "box",
        currentStock: 24,
        reorderLevel: 10,
        category: "dialyzers",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      getInventorySupplyByItemCode.mockResolvedValue(mockItem);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.inventorySupplies.byItemCode({ itemCode: "FX-80" });
      expect(res).toEqual(mockItem);
    });

    it("adjusts inventory stock levels", async () => {
      adjustInventoryStock.mockResolvedValue(undefined);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.inventorySupplies.adjustStock({
        id: 501,
        delta: -4,
      });
      expect(res).toEqual({ success: true });
      expect(adjustInventoryStock).toHaveBeenCalledWith(501, -4);
    });

    it("updates inventory supply details", async () => {
      updateInventorySupply.mockResolvedValue(undefined);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.inventorySupplies.update({
        id: 501,
        reorderLevel: 15,
      });
      expect(res).toEqual({ success: true });
      expect(updateInventorySupply).toHaveBeenCalledWith(501, { reorderLevel: 15 });
    });

    it("removes an inventory supply item", async () => {
      deleteInventorySupply.mockResolvedValue(undefined);
      const caller = appRouter.createCaller(createSupervisorCtx());
      const res = await caller.inventorySupplies.remove({ id: 501 });
      expect(res).toEqual({ success: true });
      expect(deleteInventorySupply).toHaveBeenCalledWith(501);
    });
  });
});
