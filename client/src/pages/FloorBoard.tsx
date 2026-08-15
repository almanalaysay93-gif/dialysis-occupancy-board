import NotFound from "@/pages/NotFound";
import { trpc } from "@/lib/trpc";
import { useParams } from "wouter";
import StaffBar from "@/components/StaffBar";
import { OccupancyBoard } from "@/pages/Home";

/**
 * Dedicated occupancy board for a single floor, e.g. /floor/2 or /floor/3.
 * Reuses the shared OccupancyBoard scoped to the requested floor, with its
 * own editorial masthead and the staff session bar.
 */
export default function FloorBoard() {
  const params = useParams<{ id: string }>();
  const raw = params.id ?? "";

  const { data: floors, isLoading } = trpc.machines.listFloors.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  // Resolve by floor code (F1/F2/F3) or raw DB id first; fall back to the
  // 1-based sort order only when the numeric route value matches no floor id.
  // This avoids the collision where the newest floor (auto-assigned id 1)
  // resolved to SKTI Main because its sort order 1 matched the route.
  const floor =
    floors?.find(f => f.code === raw.toUpperCase() || String(f.id) === raw) ??
    floors?.find(
      f => String(f.sortOrder) === raw && String(f.id) !== raw
    );

  if (!floor && !isLoading) return <NotFound />;

  // While the floors list is still loading, floor is undefined. Render the
  // board skeleton (via OccupancyBoard without a floor scope) instead of
  // passing an invalid floor id, which would make the waiting-panel queries
  // fail zod validation ("Too small: expected number to be >0").
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <header className="flex items-center justify-between border-b border-[#1F2A52]/80 pb-3">
        <p className="smallcaps-detail text-[#7684A0]">
          SPMC Kidney &amp; Transplant Institute · {floor?.name ?? "Floor Board"}
        </p>
        <div className="flex items-center gap-3">
          <StaffBar />
          <p className="smallcaps-detail text-[#7684A0]">
            {new Date().toLocaleDateString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      </header>
      <OccupancyBoard floorId={floor?.id} />
    </div>
  );
}
