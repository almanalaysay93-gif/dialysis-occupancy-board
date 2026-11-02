import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient } from "@trpc/client";
import { createTRPCQueryUtils, getQueryKey } from "@trpc/react-query";
import { describe, expect, it } from "vitest";
import type { AppRouter } from "./routers";
import { trpc } from "../client/src/lib/trpc";
import {
  refreshRoomViews,
  resolveRoomRoute,
  currentRoomId,
} from "../client/src/lib/room-views";

const rooms = [
  {
    id: 1,
    code: "F1",
    name: "Deleted room",
    sortOrder: 1,
    createdAt: new Date(),
  },
  {
    id: 30002,
    code: "F2",
    name: "Remaining room",
    sortOrder: 1,
    createdAt: new Date(),
  },
];

describe("room views after deletion", () => {
  it("removes a deleted room from both shared lists and invalidates cached reports and storage views", async () => {
    const queryClient = new QueryClient();
    const utils = createTRPCQueryUtils({
      queryClient,
      client: createTRPCClient<AppRouter>({ links: [] }),
    });
    utils.rooms.list.setData(undefined, rooms);
    utils.machines.listFloors.setData(undefined, rooms);
    const reportKey = getQueryKey(
      trpc.endOfDay.reportPage,
      { date: "2026-11-02" },
      "query"
    );
    const storageKey = getQueryKey(
      trpc.machines.offboarded.list,
      undefined,
      "query"
    );
    const staffKey = getQueryKey(trpc.staff.me, undefined, "query");
    queryClient.setQueryData(reportKey, { daily: { floors: rooms } });
    queryClient.setQueryData(storageKey, [{ id: 10, floorId: 1 }]);
    queryClient.setQueryData(staffKey, { role: "supervisor" });

    await refreshRoomViews(utils, 1);

    expect(utils.rooms.list.getData()).toEqual([rooms[1]]);
    expect(utils.machines.listFloors.getData()).toEqual([rooms[1]]);
    expect(queryClient.getQueryState(reportKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(storageKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(staffKey)?.isInvalidated).toBe(false);
    queryClient.clear();
  });

  it("prevents an older room-list response from restoring a deleted room", async () => {
    const queryClient = new QueryClient();
    const utils = createTRPCQueryUtils({
      queryClient,
      client: createTRPCClient<AppRouter>({ links: [] }),
    });
    utils.machines.listFloors.setData(undefined, rooms);
    let resolveRequest!: (value: typeof rooms) => void;
    const request = queryClient
      .fetchQuery({
        queryKey: getQueryKey(trpc.machines.listFloors, undefined, "query"),
        queryFn: () =>
          new Promise<typeof rooms>(resolve => {
            resolveRequest = resolve;
          }),
      })
      .catch(() => undefined);
    await refreshRoomViews(utils, 1);
    resolveRequest(rooms);
    await request;
    expect(utils.machines.listFloors.getData()).toEqual([rooms[1]]);
    queryClient.clear();
  });

  it("does not resolve a deleted room URL using another room's sort order", () => {
    const remaining = rooms.slice(1);
    expect(resolveRoomRoute(remaining, "1")).toBeUndefined();
    expect(resolveRoomRoute(remaining, "30002")).toEqual(rooms[1]);
    expect(resolveRoomRoute(remaining, "f2")).toEqual(rooms[1]);
  });

  it("does not keep a deleted kiosk selection or patient assignment active", () => {
    expect(currentRoomId(rooms.slice(1), 1)).toBeNull();
    expect(currentRoomId([], 1)).toBeNull();
    expect(currentRoomId(rooms, 30002)).toBe(30002);
  });
});
