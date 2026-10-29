import { afterEach, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({ event: undefined as undefined | (() => void), cleanup: undefined as undefined | (() => void) }));
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useState: () => [false, vi.fn()],
  useEffect: (effect: () => (() => void)) => { live.cleanup = effect(); },
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  channel: () => {
    const channel = {
      on: (_: string, __: unknown, fn: () => void) => { live.event = fn; return channel; },
      subscribe: () => channel,
    };
    return channel;
  },
  removeChannel: vi.fn(),
}) }));
import { useLiveCalls } from "@/hooks/useLiveCalls";

afterEach(() => { live.cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("call refresh timing", () => {
  it("does not starve announcements during continuous realtime updates", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const refresh = vi.fn();
    useLiveCalls(true, refresh);
    for (let i = 0; i < 200; i++) {
      live.event!();
      vi.advanceTimersByTime(10);
    }
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(3);
    live.cleanup!();
    vi.runAllTimers();
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
