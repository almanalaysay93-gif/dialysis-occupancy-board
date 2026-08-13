import AddRoomDialog from "@/components/AddRoomDialog";
import DashboardLayout from "@/components/DashboardLayout";
import RemoveRoomDialog from "@/components/RemoveRoomDialog";
import RenameRoomDialog from "@/components/RenameRoomDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { LayoutGrid, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

export default function Rooms() {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const { data: staffMe } = trpc.staff.me.useQuery(undefined, {
    retry: false,
    refetchInterval: 30_000,
  });
  // Write permissions: OAuth admin/staff OR nurse/supervisor staff session.
  // A guest staff session locks out writing even when an OAuth user is signed in.
  const canWrite =
    staffMe?.role === "guest"
      ? false
      : isAuthenticated || Boolean(staffMe?.role);
  const { data: rooms, isLoading } = trpc.rooms.list.useQuery(undefined, {
    refetchInterval: 5_000,
  });
  const { data: machineData } = trpc.machines.list.useQuery(undefined, {
    refetchInterval: 5_000,
  });

  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{
    roomId: number;
    roomName: string;
    machineCount: number;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    roomId: number;
    roomName: string;
  } | null>(null);

  const machineCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const row of machineData ?? []) {
      const fid = row.machine.floorId;
      if (fid !== null && fid !== undefined) {
        counts.set(fid, (counts.get(fid) ?? 0) + 1);
      }
    }
    return counts;
  }, [machineData]);

  const occupancy = useMemo(() => {
    const map = new Map<number, { inUse: number; urgent: number }>();
    for (const row of machineData ?? []) {
      const fid = row.machine.floorId;
      if (fid !== null && fid !== undefined && row.session) {
        const cur = map.get(fid) ?? { inUse: 0, urgent: 0 };
        cur.inUse += 1;
        if (row.session.urgent) cur.urgent += 1;
        map.set(fid, cur);
      }
    }
    return map;
  }, [machineData]);

  const orderedRooms = useMemo(
    () =>
      (rooms ?? []).sort(
        (a, b) => a.sortOrder - b.sortOrder || a.id - b.id
      ),
    [rooms]
  );

  return (
    <DashboardLayout>
      <div className="px-6 py-8 lg:px-12 lg:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#1F2A52]/80 pb-4">
          <div>
            <p className="smallcaps-detail text-[#7684A0]">
              SPMCKTI · Center Configuration
            </p>
            <h1 className="font-display mt-2 text-4xl text-[#1F2A52] sm:text-5xl">
              Rooms
            </h1>
            <p className="font-serif-light mt-3 max-w-xl text-lg italic text-[#556680]">
              The dialysis rooms of your center — add new rooms as your
              facility grows, or retire rooms that are no longer in service.
            </p>
          </div>

          {canWrite && (
            <Button
              onClick={() => setAddOpen(true)}
              className="bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A]"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Add Room
            </Button>
          )}
        </header>

        {!canWrite && (
          <div className="mt-6 flex items-center justify-between border border-[#D4DFE5] bg-[#E8EFF1] px-5 py-4">
            <p className="text-sm text-[#556680]">
              Sign in as clinical staff to add or remove rooms.
            </p>
            <Button
              size="sm"
              onClick={() => startLogin()}
              className="bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A]"
            >
              Sign in
            </Button>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-4">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[96px] animate-pulse bg-[#E8EFF1]" />
            ))
          ) : orderedRooms.length === 0 ? (
            <div className="flex flex-col items-center gap-3 border border-dashed border-[#D4DFE5] py-16">
              <LayoutGrid className="h-6 w-6 text-[#7684A0]" />
              <p className="font-serif-light text-xl italic text-[#556680]">
                No rooms have been defined yet.
              </p>
              {canWrite && (
                <Button
                  variant="outline"
                  onClick={() => setAddOpen(true)}
                  className="border-[#D4DFE5] text-[#1F2A52]"
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add your first room
                </Button>
              )}
            </div>
          ) : (
            orderedRooms.map((room, idx) => {
              const count = machineCounts.get(room.id) ?? 0;
              const occ = occupancy.get(room.id);
              const occupiedBy = count > 0 && occ ? occ.inUse / count : 0;
              return (
                <div
                  key={room.id}
                  className="flex flex-wrap items-center gap-4 border border-[#D4DFE5] bg-[#FBFCFD] px-5 py-4"
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  <div className="flex h-14 w-14 items-center justify-center border border-[#D4DFE5] bg-[#F4F7F8]">
                    <span className="font-display text-xl text-[#1F2A52]">
                      {room.code ?? `R${room.sortOrder}`}
                    </span>
                  </div>
                  <div className="min-w-[180px] flex-1">
                    <p className="font-serif-light text-xl text-[#1F2A52]">
                      {room.name}
                    </p>
                    <p className="smallcaps-detail mt-1 text-[#7684A0]">
                      Room {room.sortOrder} · Sorted by register order
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="smallcaps-detail text-[#1F2A52]">
                      {count} machine{count === 1 ? "" : "s"}
                    </span>
                    {occ && occ.inUse > 0 && (
                      <Badge
                        variant="outline"
                        className={`smallcaps-detail ${
                          occ.urgent > 0
                            ? "border-[#9E1F2B]/50 text-[#9E1F2B]"
                            : "border-[#3E8A6A]/50 text-[#3E8A6A]"
                        }`}
                      >
                        {occ.inUse} in use
                        {occ.urgent > 0 && ` · ${occ.urgent} urgent`}
                      </Badge>
                    )}
                    {count > 0 && (
                      <div className="h-1 w-24 overflow-hidden rounded-full bg-[#E8EFF1]">
                        <div
                          className="h-full bg-[#3E8A6A] transition-all"
                          style={{
                            width: `${Math.round(occupiedBy * 100)}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                  {canWrite && (
                    <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setRenameTarget({
                          roomId: room.id,
                          roomName: room.name,
                        })
                      }
                      className="h-9 border-[#D4DFE5] text-[#1F2A52] hover:bg-[#E8EFF1]"
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setRemoveTarget({
                          roomId: room.id,
                          roomName: room.name,
                          machineCount: count,
                        })
                      }
                      className="h-9 border-[#9E1F2B]/50 text-[#9E1F2B] hover:bg-[#9E1F2B]/10"
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Remove
                    </Button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        <footer className="mt-10 border-t border-[#D4DFE5] pt-4">
          <p className="font-serif-light text-sm italic text-[#7684A0]">
            A room must be empty of machines before it can be removed — remove
            its machines from the Occupancy Board first, then return here.
          </p>
        </footer>
      </div>

      <AddRoomDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <RemoveRoomDialog
        open={removeTarget !== null}
        roomId={removeTarget?.roomId ?? null}
        roomName={removeTarget?.roomName ?? ""}
        machineCount={removeTarget?.machineCount ?? 0}
        onClose={() => setRemoveTarget(null)}
        onRemoved={() => setRemoveTarget(null)}
      />
      <RenameRoomDialog
        open={renameTarget !== null}
        roomId={renameTarget?.roomId ?? null}
        roomName={renameTarget?.roomName ?? ""}
        onClose={() => setRenameTarget(null)}
      />
    </DashboardLayout>
  );
}
