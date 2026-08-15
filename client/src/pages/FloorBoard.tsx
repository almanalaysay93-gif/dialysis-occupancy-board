import NotFound from "@/pages/NotFound";
import { trpc } from "@/lib/trpc";
import { useParams } from "wouter";
import StaffBar from "@/components/StaffBar";
import { OccupancyBoard } from "@/pages/Home";
import { NarrativeReport } from "@/pages/EndOfDayReport";

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

  const { data: staff } = trpc.staff.me.useQuery(undefined, { refetchInterval: 15_000 });
  const isStaff = staff?.role === "nurse" || staff?.role === "supervisor";
  const isGuest = staff?.role === "guest";

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
      {floor?.id ? (
        <div className="mt-8">
          <NarrativeReport
            floorId={floor.id}
            floorName={floor.name}
            date={todayKey()}
            staff={staff ?? null}
            editable={isStaff && !isGuest}
          />
        </div>
      ) : null}
    </div>
  );
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" });
}
