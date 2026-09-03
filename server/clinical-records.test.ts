import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./db";
import {
  createShiftEndorsement,
  createSessionComplication,
  createWaterQualityLog,
  listSessionComplications,
} from "./machines";

type Captured = { values: Record<string, unknown> | null };

/** Captures the row a write hands to drizzle, so the mapping can be asserted. */
function mockWriteDb(captured: Captured) {
  return {
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        captured.values = v;
        return { returning: vi.fn().mockResolvedValue([{ id: 42 }]) };
      }),
    })),
  };
}

/** Serves fixed rows to the read path. */
function mockReadDb(rows: unknown[]) {
  const chain = (): Record<string, unknown> => ({
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    from: vi.fn(() => chain()),
    where: vi.fn(() => chain()),
    orderBy: vi.fn(() => chain()),
  });
  return { select: vi.fn(() => chain()) };
}

describe("clinical records reach the database", () => {
  const captured: Captured = { values: null };

  beforeEach(() => {
    vi.clearAllMocks();
    captured.values = null;
  });

  describe("water quality logs", () => {
    it("derives the salt rejection rate on the server", async () => {
      vi.mocked(getDb).mockResolvedValue(mockWriteDb(captured) as never);

      await createWaterQualityLog({
        date: "2026-08-28",
        floorId: 1,
        technician: "Biomed Tech",
        feedTds: 184,
        productTds: 3.1,
      });

      // 1 - 3.1/184 = 98.3%. The client never supplies this number.
      expect(captured.values?.rejectionRate).toBe(98.3);
    });

    it("leaves the rejection rate null when the feed reading is missing", async () => {
      vi.mocked(getDb).mockResolvedValue(mockWriteDb(captured) as never);

      await createWaterQualityLog({
        date: "2026-08-28",
        floorId: 1,
        technician: "Biomed Tech",
        productTds: 3.1,
      });

      expect(captured.values?.rejectionRate).toBeNull();
    });

    it("stores the disinfection and microbiology readings", async () => {
      vi.mocked(getDb).mockResolvedValue(mockWriteDb(captured) as never);

      await createWaterQualityLog({
        date: "2026-08-28",
        floorId: 2,
        technician: "Biomed Tech",
        shift: "Morning (05:00-13:00)",
        totalChlorine: 0.02,
        chloramineBreakthrough: false,
        heatDisinfectionCompleted: true,
        heatPeakTemp: 87.5,
        heatHoldMinutes: 35,
        chemicalAgentUsed: "Citrosteril",
        residualChemicalTestNegative: true,
        endotoxinLevel: 0.02,
        colonyCount: 3,
      });

      expect(captured.values).toMatchObject({
        shift: "Morning (05:00-13:00)",
        totalChlorine: 0.02,
        heatDisinfectionCompleted: true,
        heatPeakTemp: 87.5,
        heatHoldMinutes: 35,
        chemicalAgentUsed: "Citrosteril",
        residualChemicalTestNegative: true,
        endotoxinLevel: 0.02,
        colonyCount: 3,
      });
    });
  });

  describe("session complications", () => {
    it("stores the vital signs and the intervention list", async () => {
      vi.mocked(getDb).mockResolvedValue(mockWriteDb(captured) as never);

      await createSessionComplication({
        sessionId: 50,
        complicationType: "Hypotension (IDH)",
        machineLabel: "HD-04",
        severity: "Moderate",
        preEventBp: "132/78",
        eventBp: "84/52",
        heartRate: 96,
        spo2: 97,
        interventions: ["Trendelenburg position", "100 mL saline bolus"],
        salineBolusVolumeMl: 100,
        outcome: "UF Target Reduced",
      });

      expect(captured.values).toMatchObject({
        machineLabel: "HD-04",
        severity: "Moderate",
        preEventBp: "132/78",
        eventBp: "84/52",
        heartRate: 96,
        spo2: 97,
        salineBolusVolumeMl: 100,
        outcome: "UF Target Reduced",
      });
      expect(captured.values?.interventionsJson).toBe(
        JSON.stringify(["Trendelenburg position", "100 mL saline bolus"])
      );
    });

    it("reads the intervention list back as an array", async () => {
      vi.mocked(getDb).mockResolvedValue(
        mockReadDb([
          { id: 1, sessionId: 50, interventionsJson: JSON.stringify(["Saline bolus"]) },
        ]) as never
      );

      const rows = await listSessionComplications();
      expect(rows[0].interventions).toEqual(["Saline bolus"]);
    });

    it("survives a malformed intervention column", async () => {
      vi.mocked(getDb).mockResolvedValue(
        mockReadDb([{ id: 1, sessionId: 50, interventionsJson: "{not json" }]) as never
      );

      const rows = await listSessionComplications();
      expect(rows[0].interventions).toEqual([]);
    });
  });

  describe("shift endorsements", () => {
    it("stores the SBAR narrative and the JSON handover payloads", async () => {
      vi.mocked(getDb).mockResolvedValue(mockWriteDb(captured) as never);

      await createShiftEndorsement({
        shift: "Morning (05:00-13:00)",
        floorId: 1,
        date: "2026-08-28",
        incomingNurse: "Nurse Incoming, RN",
        outgoingNurse: "Nurse Outgoing, RN",
        floorName: "Floor 1 Main",
        situation: "All morning sessions initiated on schedule.",
        background: "Unit at peak capacity.",
        assessment: "HD-04 nadir BP 84/52.",
        recommendations: "Check post-dialysis standing BP for HD-04.",
        censusJson: JSON.stringify({ activeTreatments: 18 }),
        checklistJson: JSON.stringify({ crashCartChecked: true }),
        specialWatchJson: JSON.stringify([{ patientId: "P-4821" }]),
        status: "ENDORSED_AND_LOCKED",
      });

      expect(captured.values).toMatchObject({
        floorName: "Floor 1 Main",
        situation: "All morning sessions initiated on schedule.",
        assessment: "HD-04 nadir BP 84/52.",
        censusJson: JSON.stringify({ activeTreatments: 18 }),
        status: "ENDORSED_AND_LOCKED",
      });
      // A locked endorsement carries the moment it was signed.
      expect(captured.values?.endorsedAt).toBeInstanceOf(Date);
    });

    it("leaves a draft unsigned", async () => {
      vi.mocked(getDb).mockResolvedValue(mockWriteDb(captured) as never);

      await createShiftEndorsement({
        shift: "Morning (05:00-13:00)",
        floorId: 1,
        date: "2026-08-28",
        incomingNurse: "Nurse Incoming, RN",
        outgoingNurse: "Nurse Outgoing, RN",
        status: "DRAFT",
      });

      expect(captured.values?.status).toBe("DRAFT");
      expect(captured.values?.endorsedAt).toBeNull();
    });
  });
});
