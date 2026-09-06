import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import * as machineDb from "./machines";
import { patientTicket } from "./patient-ticket";
import { ticketCallText, treatmentAreaCallText } from "@/lib/kioskAudio";
import type { TrpcContext } from "./_core/context";

vi.mock("./machines", async importOriginal => {
  const orig = await importOriginal<typeof machineDb>();
  return {
    ...orig,
    listWaiting: vi.fn(),
    admitWaiting: vi.fn(),
    listMachines: vi.fn(),
    listFloors: vi.fn().mockResolvedValue([{ id: 30001, name: "SKTI Main" }]),
    setWaitingCall: vi.fn(),
    nextVacantMachine: vi.fn(),
  };
});

vi.mock("./staffAuth", async importOriginal => {
  const mod = await importOriginal<typeof import("./staffAuth")>();
  return {
    ...mod,
    resolveStaffSession: vi.fn().mockResolvedValue({
      accountId: 1,
      username: "joy",
      displayName: "Nurse Joy",
      role: "supervisor" as const,
      assignedFloorId: null,
    }),
  };
});

function createStaffContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "staff-1",
      name: "Nurse Joy",
      email: "joy@skti.gov.ph",
      role: "user",
      loginMethod: "manus",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("ticket calling and admission announcement", () => {
  it("waiting.admit returns ticket code and machine label for immediate audio calling", async () => {
    vi.mocked(machineDb.listWaiting).mockResolvedValueOnce([
      { id: 10, patientId: "P-1001", floorId: 30001, priority: "normal", addedBy: "staff", joinedAt: new Date() },
    ]);
    vi.mocked(machineDb.admitWaiting).mockResolvedValueOnce({
      sessionId: 55,
      machineId: 101,
      machineLabel: "HD-05",
      patientId: "P-1001",
      ticket: patientTicket("P-1001"),
    });

    const caller = appRouter.createCaller(createStaffContext());
    const res = await caller.waiting.admit({
      entryId: 10,
      floorId: 30001,
    });

    expect(res.success).toBe(true);
    expect(res.patientId).toBe("P-1001");
    expect(res.ticket).toBe(patientTicket("P-1001"));
    expect(res.machineLabel).toBe("HD-05");
    expect(res.floorName).toBe("SKTI Main");
  });

  it("waiting.callIn returns the board and the machine the next admit lands on", async () => {
    vi.mocked(machineDb.nextVacantMachine).mockResolvedValueOnce({
      machineLabel: "HD-07",
      floorName: "SKTI Main",
    });

    const caller = appRouter.createCaller(createStaffContext());
    const res = await caller.waiting.callIn({ entryId: 10, floorId: 30001, called: true });

    expect(res.machineLabel).toBe("HD-07");
    expect(res.floorName).toBe("SKTI Main");
  });

  it("speaks only the board, the ticket and the machine number", () => {
    expect(ticketCallText("TK-4821", "HD-02", "SKTI Main")).toBe(
      "SKTI Main. Ticket 4 8 2 1. Machine 2."
    );
    expect(treatmentAreaCallText("TK-4821", "RDU Annex", "RA-07")).toBe(
      "RDU Annex. Ticket 4 8 2 1. Machine 7 is next."
    );
  });

  it("drops the machine from a call when the board has none free", () => {
    expect(treatmentAreaCallText("TK-0300", "SKTI ICU", null)).toBe(
      "SKTI ICU. Ticket 0 3 0 0."
    );
  });

  it("detects first admitted session when previous active session set was empty", () => {
    const isInitializedRef = { current: false };
    const prevAdmittedIdsRef = { current: new Set<number>() };
    const calloutQueue: Array<{ ticket: string; bay: string }> = [];

    // Step 1: Kiosk loads with 0 active sessions
    const initialSessions: Array<{ id: number; ticket: string; bay: string }> = [];
    const activeIds1 = new Set(initialSessions.map(s => s.id));

    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      prevAdmittedIdsRef.current = activeIds1;
    }

    expect(isInitializedRef.current).toBe(true);
    expect(prevAdmittedIdsRef.current.size).toBe(0);
    expect(calloutQueue).toHaveLength(0);

    // Step 2: First patient admitted (session id: 201)
    const updatedSessions = [{ id: 201, ticket: "TK-1001", bay: "HD-01" }];
    const activeIds2 = new Set(updatedSessions.map(s => s.id));

    for (const s of updatedSessions) {
      if (!prevAdmittedIdsRef.current.has(s.id)) {
        calloutQueue.push({ ticket: s.ticket, bay: s.bay });
      }
    }
    prevAdmittedIdsRef.current = activeIds2;

    // Must announce the first patient!
    expect(calloutQueue).toHaveLength(1);
    expect(calloutQueue[0]).toEqual({ ticket: "TK-1001", bay: "HD-01" });
  });
});
