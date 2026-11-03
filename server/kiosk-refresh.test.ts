import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createTRPCClient } from "@trpc/client";
import { createTRPCQueryUtils, getQueryKey } from "@trpc/react-query";
import { expect, it } from "vitest";
import type { AppRouter } from "./routers";
import { trpc } from "../client/src/lib/trpc";
import { createKioskCallRefresh } from "../client/src/lib/refresh-kiosk-calls";

it("delivers an in-flight call response during a burst of realtime updates", async () => {
  const queryClient = new QueryClient();
  const utils = createTRPCQueryUtils({
    queryClient,
    client: createTRPCClient<AppRouter>({ links: [] }),
  });
  const key = getQueryKey(trpc.waiting.kioskCalls, undefined, "query");
  queryClient.setQueryData(key, []);
  let requests = 0;
  let deliver!: (calls: { ticket: string }[]) => void;
  const observer = new QueryObserver(queryClient, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: () => {
      requests++;
      return new Promise<{ ticket: string }[]>(resolve => {
        deliver = resolve;
      });
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  const alreadyFetching = observer.refetch();
  const refresh = createKioskCallRefresh(utils);
  const first = refresh();
  for (let i = 0; i < 100; i++) expect(refresh()).toBe(first);
  expect(requests).toBe(1);
  deliver([{ ticket: "TK-1234" }]);
  await alreadyFetching;
  await first;
  expect(queryClient.getQueryData(key)).toEqual([{ ticket: "TK-1234" }]);
  expect(requests).toBe(1);
  unsubscribe();
  queryClient.clear();
});
