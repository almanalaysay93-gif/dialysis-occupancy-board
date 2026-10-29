import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

// Public connection settings, never a service-role key. Broadcasts contain
// only an invalidation signal; call details still come from the scoped API.
const client = createClient(
  import.meta.env.VITE_SUPABASE_URL || "https://oaxgmvsxzfkyqzmfwxtn.supabase.co",
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_30OKe7iCrhCr6gXB5H4rTg_NdHbKh6S",
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);

export function useLiveCalls(enabled: boolean, refresh: () => void) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastRefresh = 0;
    const refreshSoon = () => {
      // Keep the first deadline: a continuous burst must not postpone calls.
      if (timer !== undefined) return;
      // This is an untrusted public hint: coalesce bursts and bound API work.
      timer = setTimeout(() => {
        timer = undefined;
        if (!disposed) {
          lastRefresh = Date.now();
          refreshRef.current();
        }
      }, Math.max(50, 1_000 - (Date.now() - lastRefresh)));
    };
    const channel = client.channel("waiting-updates-v1")
      .on("broadcast", { event: "changed" }, refreshSoon)
      .subscribe(status => {
        if (disposed) return;
        setConnected(status === "SUBSCRIBED");
        // Close the gap between the initial HTTP fetch and joining/rejoining.
        if (status === "SUBSCRIBED") refreshSoon();
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshSoon();
    };
    window.addEventListener("online", refreshSoon);
    window.addEventListener("focus", refreshSoon);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      clearTimeout(timer);
      void client.removeChannel(channel);
      window.removeEventListener("online", refreshSoon);
      window.removeEventListener("focus", refreshSoon);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  return connected;
}
