import AddMachineDialog from "@/components/AddMachineDialog";
import AssignSessionDialog from "@/components/AssignSessionDialog";
import EndSessionDialog from "@/components/EndSessionDialog";
import { FloorRow } from "@/components/FloorMachineRow";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { Activity, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { MachineWithSession } from "../../../server/machines";

type FloorGroup = {
  id: number | null;
  name: string;
  machines: MachineWithSession[];
};

export default function Home() {
  const { isAuthenticated } = useAuth();
  const { data, isLoading } = trpc.machines.list.useQuery(undefined, {
    // Cross-device real-time sync: re-sync board state every 5 seconds
    refetchInterval: 5_000,
  });
  const { data: floors } = trpc.machines.listFloors.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const [assignTarget, setAssignTarget] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addInitialFloor, setAddInitialFloor] = useState<number | null>(null);
  const [endTarget, setEndTarget] = useState<{
    sessionId: number;
    machineLabel: string;
  } | null>(null);

  const floorGroups = useMemo<FloorGroup[]>(() => {
    if (!data) return [];
    const floorMap = new Map<number | string, { id: number; name: string }>();
    for (const f of floors ?? []) floorMap.set(f.id, { id: f.id, name: f.name });

    const groups = new Map<number | string, FloorGroup>();

    // Order: assigned floors first (by floor sortOrder/name), then unassigned
    const orderedFloors = [...(floors ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id - b.id
    );
    for (const f of orderedFloors) groups.set(f.id, { id: f.id, name: f.name, machines: [] });
    groups.set("unassigned", { id: null, name: "Unassigned Machines", machines: [] });

    for (const row of data) {
      const key =
        row.machine.floorId && floorMap.has(row.machine.floorId)
          ? row.machine.floorId
          : "unassigned";
      groups.get(key)!.machines.push(row);
    }

    return Array.from(groups.values()).filter(g => g.machines.length > 0);
  }, [data, floors]);

  const stats = useMemo(() => {
    if (!data) return { vacant: 0, occupied: 0, urgent: 0, dirty: 0 };
    let vacant = 0;
    let occupied = 0;
    let urgent = 0;
    let dirty = 0;
    for (const row of data) {
      if (row.session) {
        occupied++;
        if (row.session.urgent) urgent++;
        if (row.session.isolationTag === "dirty") dirty++;
      } else {
        vacant++;
      }
    }
    return { vacant, occupied, urgent, dirty };
  }, [data]);

  const assignMachine = data?.find(r => r.machine.id === assignTarget);
  const endMachine = endTarget
    ? data?.find(
        r =>
          r.session !== null &&
          r.session.id === (endTarget as { sessionId: number }).sessionId
      )
    : null;

  const handleAssign = (machineId: number) => setAssignTarget(machineId);

  const floorStats = (group: FloorGroup) => {
    let occupied = 0;
    let urgent = 0;
    let dirty = 0;
    for (const row of group.machines) {
      if (row.session) {
        occupied++;
        if (row.session.urgent) urgent++;
        if (row.session.isolationTag === "dirty") dirty++;
      }
    }
    return { occupied, urgent, dirty };
  };

  return (
    <DashboardLayout>
      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {/* Editorial masthead */}
        <header className="flex flex-col gap-2">
          <div className="flex items-center justify-between border-b border-[#2B2620]/80 pb-3">
            <p className="smallcaps-detail text-[#8A7A5F]">
              Dialysis Center · Live Board
            </p>
            <p className="smallcaps-detail text-[#8A7A5F]">
              {new Date().toLocaleDateString([], {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-6 pt-5">
            <div>
              <h1 className="font-display text-4xl text-[#2B2620] sm:text-5xl lg:text-6xl">
                The Occupancy Board
              </h1>
              <p className="font-serif-light mt-2 max-w-xl text-base italic text-[#6B6152] sm:text-lg">
                A live register of every hemodialysis machine, arranged by
                floor — which are in treatment, which stand vacant, and which
                cases demand immediate attention.
              </p>
            </div>
            <div className="flex flex-col items-stretch gap-3 sm:flex-row">
              <div className="flex items-baseline gap-3 border-l border-[#D9CFBA] pl-4">
                <span className="font-display text-3xl text-[#4E7A48]">
                  {stats.vacant}
                </span>
                <span className="smallcaps-detail text-[#8A7A5F]">Vacant</span>
              </div>
              <div className="flex items-baseline gap-3 border-l border-[#D9CFBA] pl-4">
                <span className="font-display text-3xl text-[#2B2620]">
                  {stats.occupied}
                </span>
                <span className="smallcaps-detail text-[#8A7A5F]">In Use</span>
              </div>
              <div className="flex items-baseline gap-3 border-l border-[#D9CFBA] pl-4">
                <span className="font-display text-3xl text-[#A03A25]">
                  {stats.urgent}
                </span>
                <span className="smallcaps-detail text-[#8A7A5F]">Urgent</span>
              </div>
              <div className="flex items-baseline gap-3 border-l border-[#D9CFBA] pl-4">
                <span className="font-display text-3xl text-[#A0562F]">
                  {stats.dirty}
                </span>
                <span className="smallcaps-detail text-[#8A7A5F]">
                  Isolation
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 border border-[#D9CFBA] bg-[#F6F1E7]" />
            <span className="smallcaps-detail text-[#6B6152]">Vacant</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 bg-[#4E7A48]" />
            <span className="smallcaps-detail text-[#6B6152]">In Treatment</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 bg-[#A03A25]" />
            <span className="smallcaps-detail text-[#6B6152]">Urgent Case</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="smallcaps-detail text-[#4E7A48]">Clean</span>
            <span className="text-[#D9CFBA]">·</span>
            <span className="smallcaps-detail text-[#A0562F]">Dirty</span>
            <span className="smallcaps-detail text-[#8A7A5F]">isolation tag</span>
          </span>
        </div>

        {/* Auth gate for actions */}
        {!isAuthenticated && (
          <div className="mt-5 flex items-center justify-between border border-[#D9CFBA] bg-[#EFE9DC] px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-[#8A7A5F]" />
              <p className="text-sm text-[#6B6152]">
                Sign in as clinical staff to assign sessions, control machines,
                or add machines.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => startLogin()}
              className="bg-[#2B2620] text-[#F6F1E7] hover:bg-[#1A1611]"
            >
              Sign in
            </Button>
          </div>
        )}

        {/* Floor rows */}
        <section className="mt-6 flex flex-col gap-5">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-10 w-72" />
                <Skeleton className="h-16" />
              </div>
            ))
          ) : floorGroups.length === 0 ? (
            <div className="flex flex-col items-center gap-3 border border-dashed border-[#D9CFBA] py-16">
              <p className="font-serif-light text-xl italic text-[#6B6152]">
                No machines registered yet.
              </p>
              {isAuthenticated && (
                <Button
                  size="sm"
                  onClick={() => setAddOpen(true)}
                  className="bg-[#2B2620] text-[#F6F1E7] hover:bg-[#1A1611]"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add your first machine
                </Button>
              )}
            </div>
          ) : (
            floorGroups.map(group => (
              <FloorRow
                key={group.id ?? "unassigned"}
                floorName={group.name}
                machines={group.machines}
                floorStats={floorStats(group)}
                onAssign={handleAssign}
              />
            ))
          )}
        </section>

        {/* Footer controls for authenticated staff */}
        {isAuthenticated && !isLoading && (
          <div className="mt-6 flex items-center justify-between border-t border-[#D9CFBA] pt-4">
            <p className="font-serif-light italic text-[#6B6152]">
              {stats.vacant} machine{stats.vacant === 1 ? "" : "s"} vacant ·{" "}
              {data?.length ?? 0} machine
              {data?.length === 1 ? "" : "s"} on the board
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddOpen(true)}
                className="h-9 border-[#8A7A5F]/60 text-[#2B2620] hover:bg-[#EFE9DC]"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Machine
              </Button>
              {stats.vacant > 0 && (
                <Button
                  size="sm"
                  onClick={() => {
                    const first = data?.find(r => !r.session);
                    if (first) setAssignTarget(first.machine.id);
                  }}
                  className="h-9 bg-[#2B2620] text-[#F6F1E7] hover:bg-[#1A1611] font-serif-light"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Assign Next Vacant
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <AddMachineDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        initialFloorId={addInitialFloor}
      />

      <AssignSessionDialog
        open={assignTarget !== null}
        machineId={assignTarget}
        machineLabel={assignMachine?.machine.label ?? ""}
        onClose={() => setAssignTarget(null)}
        onAssigned={() => setAssignTarget(null)}
      />

      <EndSessionDialog
        open={endTarget !== null}
        sessionId={endTarget?.sessionId ?? null}
        machineLabel={endMachine?.machine.label ?? ""}
        onClose={() => setEndTarget(null)}
        onEnded={() => setEndTarget(null)}
      />
    </DashboardLayout>
  );
}
