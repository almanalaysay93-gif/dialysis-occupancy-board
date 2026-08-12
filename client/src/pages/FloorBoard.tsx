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
  const floorId = Number(params.id);
  const invalid = Number.isNaN(floorId) || floorId <= 0;

  const { data: floors } = trpc.machines.listFloors.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  if (invalid) return <NotFound />;
  if (floors && !floors.some(f => f.id === floorId)) return <NotFound />;

  return <OccupancyBoard floorId={floorId} />;
}
