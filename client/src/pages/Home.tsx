import AddMachineDialog from "@/components/AddMachineDialog";
import AssignSessionDialog from "@/components/AssignSessionDialog";
import EndSessionDialog from "@/components/EndSessionDialog";
import { FloorRow } from "@/components/FloorMachineRow";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import NurseAssignmentsPanel from "@/components/NurseAssignmentsPanel";
import StaffBar from "@/components/StaffBar";
import WaitingListPanel from "@/components/WaitingListPanel";
import { NarrativeReport } from "@/pages/EndOfDayReport";
import { Skeleton } from "@/components/ui/skeleton";
import { useCanWrite } from "@/hooks/useCanWrite";
import { trpc } from "@/lib/trpc";
import { Activity, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import type { MachineWithSession } from "../../../server/machines";

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" });
}

type FloorGroup = {
  id: number | null;
  name: string;
  machines: MachineWithSession[];
};

/** Header stat showing how many patients wait on this board. */
function WaitingCount({ floorId }: { floorId: number }) {
  const { data: waiting } = trpc.waiting.list.useQuery(
    { floorId },
    { refetchInterval: 5_000 }
  );
  const total = waiting?.length ?? 0;
  const veryUrgent = waiting?.filter(w => w.priority === "veryUrgent").length ?? 0;
  return (
    <div className="flex items-baseline gap-3 border-l border-[#D4DFE5] pl-4">
      <span className={`font-display text-3xl ${veryUrgent > 0 ? "text-[#9E1F2B]" : "text-[#1F2A52]"}`}>
        {total}
      </span>
      <span className="smallcaps-detail text-[#7684A0]">
        Waiting{veryUrgent > 0 ? ` · ${veryUrgent} very urgent` : ""}
      </span>
    </div>
  );
}

/**
 * Shared occupancy board used by the main board (/) and the per-floor
 * boards (/floor/:id). When floorId is provided, only that floor's
 * machines are shown and page scope is limited to it.
 */
export function OccupancyBoardContent({ floorId }: { floorId?: number }) {
  const { canWrite } = useCanWrite();
  const { data, isLoading } = trpc.machines.list.useQuery(undefined, {
    // Cross-device real-time sync: re-sync board state every 5 seconds
    refetchInterval: 5_000,
  });
  const { data: staff } = trpc.staff.me.useQuery(undefined, { refetchInterval: 15_000 });
  const { data: floors } = trpc.machines.listFloors.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const [assignTarget, setAssignTarget] = useState<number | null>(null);
  const scoped = floorId !== undefined;
  const [addOpen, setAddOpen] = useState(false);
  const [addInitialFloor, setAddInitialFloor] = useState<number | null>(null);
  const [endTarget, setEndTarget] = useState<{
    sessionId: number;
    machineLabel: string;
  } | null>(null);

  const floorGroups = useMemo<FloorGroup[]>(() => {
    if (!data) return [];
    const floorMap = new Map<number | string, { id: number; name: string }>();
    const floorRows = floorId !== undefined
      ? data.filter(r => r.machine.floorId === floorId)
      : data;
    for (const f of floors ?? []) floorMap.set(f.id, { id: f.id, name: f.name });

    const groups = new Map<number | string, FloorGroup>();

    // Order: assigned floors first (by floor sortOrder/name), then unassigned
    const orderedFloors = [...(floors ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id - b.id
    );
    if (floorId !== undefined && orderedFloors.length === 0 && floors) {
      const match = floors.find(f => f.id === floorId);
      if (match) orderedFloors.push(match);
    }
    for (const f of orderedFloors) groups.set(f.id, { id: f.id, name: f.name, machines: [] });
    groups.set("unassigned", { id: null, name: "Unassigned Machines", machines: [] });

    for (const row of floorRows) {
      const key =
        row.machine.floorId && floorMap.has(row.machine.floorId)
          ? row.machine.floorId
          : "unassigned";
      groups.get(key)!.machines.push(row);
    }

    return Array.from(groups.values()).filter(g => g.machines.length > 0);
  }, [data, floors, floorId]);

  const stats = useMemo(() => {
    const rows = floorId !== undefined
      ? (data ?? []).filter(r => r.machine.floorId === floorId)
      : data;
    if (!rows) return { vacant: 0, occupied: 0, urgent: 0, dirty: 0 };
    let vacant = 0;
    let occupied = 0;
    let urgent = 0;
    let dirty = 0;
    for (const row of rows) {
      if (row.session) {
        occupied++;
        if (row.session.urgent) urgent++;
        if (row.session.isolationTag === "dirty") dirty++;
      } else {
        vacant++;
      }
    }
    return { vacant, occupied, urgent, dirty };
  }, [data, floorId]);

  const assignMachine = (data ?? []).find(r => r.machine.id === assignTarget);
  const endMachine = endTarget
    ? (data ?? []).find(
        r =>
          r.session !== null &&
          r.session.id === (endTarget as { sessionId: number }).sessionId
      )
    : null;

  const handleAssign = (machineId: number) => setAssignTarget(machineId);

  const floorNameForScope = floorId !== undefined
    ? floors?.find(f => f.id === floorId)?.name
    : undefined;

  const [, navigate] = useLocation();

  // Waiting list scope: only show on a scoped (per-floor) board page
  const waitingFloorId = floorId !== undefined ? floorId : undefined;

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
    <div className="w-full px-4 sm:px-6 py-6">
        {/* Frosted-glass institute banner — SKTI building imagery */}
        <section className="glass-deep relative mb-4 overflow-hidden border border-[#1F2A52]/25">
          <img
            src="/manus-storage/skti-building_5c90942a.jpg"
            alt="SPMC Kidney & Transplant Institute building"
            className="absolute inset-0 h-full w-full object-cover object-top opacity-[0.35] saturate-[1.1]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#F7F9FB]/40 via-transparent to-transparent" />
          <div className="relative flex items-center gap-4 px-5 py-3.5 sm:px-6">
            <img
              src="/manus-storage/skti-seal-transparent_b9fdeed9.png"
              alt="SKTI seal"
              className="h-12 w-12 shrink-0 rounded-full object-cover drop-shadow-[0_2px_8px_rgba(22,39,70,0.35)] sm:h-14 sm:w-14"
            />
            <div className="min-w-0">
              <p className="font-display text-sm font-semibold tracking-wide text-[#1F2A52] sm:text-base">
                SPMC Kidney &amp; Transplant Institute
              </p>
              <p className="smallcaps-detail mt-0.5 text-[10px] text-[#7684A0] sm:text-[11px]">
                Hemodialysis Unit · SKTI Main Hallway
              </p>
            </div>
          </div>
        </section>
        {/* Editorial masthead */}
        <header className="flex flex-col gap-2">
          <div className="flex items-center justify-between border-b border-[#1F2A52]/80 pb-3">
            <p className="smallcaps-detail text-[#7684A0]">
              SPMC Kidney & Transplant Institute · Live Board
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
          </div>

          <div className="flex flex-wrap items-end justify-between gap-6 pt-5">
            <div>
              <h1 className="font-display text-4xl text-[#1F2A52] sm:text-5xl lg:text-6xl">
                {floorNameForScope ? floorNameForScope : "The Occupancy Board"}
              </h1>
              <p className="font-serif-light mt-2 max-w-xl text-base italic text-[#556680] sm:text-lg">
                {floorNameForScope
                  ? "A live register of the hemodialysis machines on this floor — which are in treatment, which stand vacant, and which cases demand immediate attention."
                  : "A live register of every hemodialysis machine, arranged by floor — which are in treatment, which stand vacant, and which cases demand immediate attention."}
              </p>
              {!scoped && floors && floors.length > 1 && (
                <p className="font-serif-light mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[#556680]">
                  {floors.map(f => (
                    <Link
                      key={f.id}
                      href={`/floor/${f.id}`}
                      className="underline decoration-[#2E9A9B]/60 underline-offset-4 hover:text-[#1F2A52]"
                    >
                      {f.name} board →
                    </Link>
                  ))}
                </p>
              )}
            </div>
            <div className="flex flex-col items-stretch gap-3 sm:flex-row">
              <div className="flex items-baseline gap-3 border-l border-[#D4DFE5] pl-4">
                <span className="font-display text-3xl text-[#3E8A6A]">
                  {stats.vacant}
                </span>
                <span className="smallcaps-detail text-[#7684A0]">Vacant</span>
              </div>
              <div className="flex items-baseline gap-3 border-l border-[#D4DFE5] pl-4">
                <span className="font-display text-3xl text-[#1F2A52]">
                  {stats.occupied}
                </span>
                <span className="smallcaps-detail text-[#7684A0]">In Use</span>
              </div>
              <div className="flex items-baseline gap-3 border-l border-[#D4DFE5] pl-4">
                <span className="font-display text-3xl text-[#9E1F2B]">
                  {stats.urgent}
                </span>
                <span className="smallcaps-detail text-[#7684A0]">Urgent</span>
              </div>
              <div className="flex items-baseline gap-3 border-l border-[#D4DFE5] pl-4">
                <span className="font-display text-3xl text-[#2E9A9B]">
                  {stats.dirty}
                </span>
                <span className="smallcaps-detail text-[#7684A0]">
                  Isolation
                </span>
              </div>
              {waitingFloorId !== undefined && <WaitingCount floorId={waitingFloorId} />}
            </div>
          </div>
        </header>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 border border-[#D4DFE5] bg-[#F4F7F8]" />
            <span className="smallcaps-detail text-[#556680]">Vacant</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 bg-[#3E8A6A]" />
            <span className="smallcaps-detail text-[#556680]">In Treatment</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 bg-[#9E1F2B]" />
            <span className="smallcaps-detail text-[#556680]">Urgent Case</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="smallcaps-detail text-[#3E8A6A]">Clean</span>
            <span className="text-[#D4DFE5]">·</span>
            <span className="smallcaps-detail text-[#2E9A9B]">Dirty</span>
            <span className="smallcaps-detail text-[#7684A0]">isolation tag</span>
          </span>
        </div>

        {/* Auth gate for actions */}
        {!canWrite && (
          <div className="glass-panel mt-5 flex items-center justify-between px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-[#7684A0]" />
              <p className="text-sm text-[#556680]">
                Sign in as clinical staff to assign sessions, control machines,
                or add machines.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => navigate("/staff-login")}
              className="bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A]"
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
            <div className="flex flex-col items-center gap-3 border border-dashed border-[#D4DFE5] py-16">
              <p className="font-serif-light text-xl italic text-[#556680]">
                No machines registered yet.
              </p>
              {canWrite && (
                <Button
                  size="sm"
                  onClick={() => setAddOpen(true)}
                  className="bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A]"
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

        {/* Staff footer controls (vacant count + Add Machine / Assign Next Vacant) */}
        {canWrite && !isLoading && (
          <div className="mt-6 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between border-t border-[#D4DFE5] pt-4">
            <p className="font-serif-light italic text-[#556680] text-sm sm:text-base">
              {stats.vacant} machine{stats.vacant === 1 ? "s" : ""} vacant ·{" "}
              {data?.filter(r => floorId !== undefined ? r.machine.floorId === floorId : true).length ?? 0} machine
              {data?.filter(r => floorId !== undefined ? r.machine.floorId === floorId : true).length === 1 ? "" : "s"} on the board
            </p>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddOpen(true)}
                className="h-11 sm:h-9 w-full sm:w-auto text-base sm:text-sm border-[#7684A0]/60 text-[#1F2A52] hover:bg-[#E8EFF1]"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Machine
              </Button>
              {stats.vacant > 0 && (
                <Button
                  size="sm"
                  onClick={() => {
                    // Stay inside the scoped board — never jump to another floor.
                    const rows = floorId !== undefined
                      ? data?.filter(r => r.machine.floorId === floorId)
                      : data;
                    const first = rows?.find(r => !r.session);
                    if (first) setAssignTarget(first.machine.id);
                  }}
                  className="h-11 sm:h-9 w-full sm:w-auto text-base sm:text-sm bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A]"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Assign Next Vacant
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Per-board waiting list (visible on each floor's board) */}
        {waitingFloorId !== undefined && (
          <WaitingListPanel floorId={waitingFloorId} />
        )}
        {/* Per-floor nurse patient assignments roster */}
        {waitingFloorId !== undefined && (
          <NurseAssignmentsPanel floorId={waitingFloorId} />
        )}

        {/* Charge nurse narrative report at the bottom of the board —
            written on the board during the shift; the End of Day Report
            reflects it read-only */}
        {waitingFloorId !== undefined && (
          <NarrativeReport
            floorId={waitingFloorId}
            floorName={floorNameForScope ?? ""}
            date={todayKey()}
            staff={staff ?? null}
            editable={canWrite}
          />
        )}

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
      </div>
  );
}

export function OccupancyBoard({ floorId }: { floorId?: number }) {
  return <OccupancyBoardContent floorId={floorId} />;
}

export default function Home() {
  return <DashboardLayout><OccupancyBoardContent /></DashboardLayout>;
}