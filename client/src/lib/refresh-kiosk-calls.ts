import type { trpc } from "./trpc";

/** Realtime hints must join a slow request, never cancel it and start over. */
export function createKioskCallRefresh(
  utils: ReturnType<typeof trpc.useUtils>
) {
  let inFlight: Promise<void> | undefined;
  return () => {
    if (inFlight) return inFlight;
    inFlight = utils.waiting.kioskCalls
      .invalidate(undefined, undefined, { cancelRefetch: false })
      .finally(() => {
        inFlight = undefined;
        // These larger reads are secondary to the small call event response.
        void utils.waiting.list.invalidate(undefined, undefined, {
          cancelRefetch: false,
        });
        void utils.machines.list.invalidate(undefined, undefined, {
          cancelRefetch: false,
        });
        void utils.staff.me.invalidate(undefined, undefined, {
          cancelRefetch: false,
        });
      });
    return inFlight;
  };
}
