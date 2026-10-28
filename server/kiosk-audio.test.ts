import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("voice call delivery", () => {
  const speak = vi.fn();
  const cancel = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    speak.mockReset();
    cancel.mockReset();
    vi.stubGlobal("window", { speechSynthesis: {
      speak, cancel, resume: vi.fn(), paused: false, getVoices: () => [],
    } });
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      constructor(public text: string) {}
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not play an older delayed call over the newest call", async () => {
    const audio = await import("@/lib/kioskAudio");
    audio.announceTreatmentArea("TK-1111", "SKTI Main", null);
    audio.announceTreatmentArea("TK-2222", "RDU Annex", null);
    vi.runAllTimers();
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0].text).toContain("2 2 2 2");
  });

  it("cancels pending speech when a call is canceled or the page closes", async () => {
    const audio = await import("@/lib/kioskAudio");
    audio.announceTicketVoice("TK-1111", "HD-01", "SKTI Main");
    audio.stopAnnouncement();
    vi.runAllTimers();
    expect(speak).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });

  it("primes iPhone speech synchronously inside the enabling gesture", async () => {
    const audio = await import("@/lib/kioskAudio");
    const unlock = audio.unlockAudio();
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0].volume).toBe(0);
    await unlock;
  });
});
