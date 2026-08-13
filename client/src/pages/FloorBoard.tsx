import NotFound from "@/pages/NotFound";
import { trpc } from "@/lib/trpc";
import { useParams } from "wouter";
import { OccupancyBoard } from "@/pages/Home";

/**
 * Dedicated occupancy board for a single floor, e.g. /floor/2 or /floor/3.
 * Reuses the shared OccupancyBoard scoped to the requested floor.
 */
export default function FloorBoard() {
  const params = useParams<{ id: string }>();
  const raw = params.id ?? "";

  const { data: floors, isLoading } = trpc.machines.listFloors.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  // Resolve by floor code (F1/F2/F3), raw DB id, or 1-based sort order.
  const floor = floors?.find(
    f =>
      f.code === raw.toUpperCase() ||
      String(f.id) === raw ||
      String(f.sortOrder) === raw
  );

  if (!floor && !isLoading) return <NotFound />;

  // While the floors list is still loading, floor is undefined. Render the
  // board skeleton (via OccupancyBoard without a floor scope) instead of
  // passing an invalid floor id, which would make the waiting-panel queries
  // fail zod validation ("Too small: expected number to be >0").
  return <OccupancyBoard floorId={floor?.id} />;
}
