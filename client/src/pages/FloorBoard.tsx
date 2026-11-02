import { roomListQueryOptions, resolveRoomRoute } from "@/lib/room-views";
import NotFound from "@/pages/NotFound";
import { trpc } from "@/lib/trpc";
import { useParams } from "wouter";
import { OccupancyBoardContent } from "@/pages/Home";

/**
 * Dedicated occupancy board for a single floor, e.g. /floor/2 or /floor/3.
 * Reuses the shared OccupancyBoard scoped to the requested floor. Renders
 * inside the dashboard shell, so the shell's page header is the only header
 * (the duplicated masthead bug).
 */
export default function FloorBoard() {
  const params = useParams<{ id: string }>();
  const raw = params.id ?? "";

  const { data: floors, isLoading } = trpc.machines.listFloors.useQuery(
    undefined,
    roomListQueryOptions
  );

  const floor = resolveRoomRoute(floors, raw);

  if (isLoading)
    return (
      <div role="status" className="p-6">
        Loading room…
      </div>
    );
  if (!floor) return <NotFound />;
  return (
    <div className="w-full px-4 sm:px-6 py-6">
      <OccupancyBoardContent floorId={floor.id} />
    </div>
  );
}
