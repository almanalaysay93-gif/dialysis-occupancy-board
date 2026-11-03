import type { trpc } from "./trpc";

// Every room picker and board uses the same freshness policy, including
// unattended kiosks that cannot rely on navigation to refresh their lists.
export const roomListQueryOptions = {
  refetchInterval: 8_000,
  staleTime: 0,
  refetchOnWindowFocus: true,
} as const;

export function resolveRoomRoute<T extends { id: number; code: string }>(
  rooms: readonly T[] | undefined,
  route: string
): T | undefined {
  // Sort order is presentation data, not a room identity. Falling back to it
  // could make a deleted room's URL open a different board.
  return rooms?.find(
    room => String(room.id) === route || room.code === route.toUpperCase()
  );
}

export function currentRoomId(
  rooms: readonly { id: number }[] | undefined,
  selectedId: number | null | undefined
): number | null {
  return rooms?.find(room => room.id === selectedId)?.id ?? null;
}

export async function refreshRoomViews(
  utils: ReturnType<typeof trpc.useUtils>,
  removedRoomId?: number
) {
  if (removedRoomId !== undefined) {
    // Cancel older requests before updating the shared lists so a response
    // started before deletion cannot put the room back in the sidebar.
    await Promise.all([
      utils.rooms.list.cancel(),
      utils.machines.listFloors.cancel(),
    ]);
    utils.rooms.list.setData(undefined, rooms =>
      rooms?.filter(room => room.id !== removedRoomId)
    );
    utils.machines.listFloors.setData(undefined, rooms =>
      rooms?.filter(room => room.id !== removedRoomId)
    );
  }
  await Promise.all([
    utils.rooms.invalidate(),
    utils.machines.invalidate(),
    utils.endOfDay.invalidate(),
    utils.waiting.invalidate(),
  ]);
}
