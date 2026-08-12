import AssignSessionDialog from "@/components/AssignSessionDialog";
import EndSessionDialog from "@/components/EndSessionDialog";
import MachineTile from "@/components/MachineTile";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { Activity, Plus } from "lucide-react";
import { useMemo, useState } from "react";

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const { data, isLoading } = trpc.machines.list.useQuery(undefined, {
    // Cross-device real-time sync: re-sync board state every 5 seconds
    refetchInterval: 5_000,
  });

  const [assignTarget, setAssignTarget] = useState<number | null>(null);
  const [endTarget, setEndTarget] = useState<{
    sessionId: number;
    machineLabel: string;
  } | null>(null);

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
          r.session !== null && r.session.id === (endTarget as { sessionId: number }).sessionId
      )
    : null;

  return (
    <DashboardLayout>
      <div className="px-6 py-8 lg:px-12 lg:py-10">
        {/* Editorial masthead */}
        <header className="flex flex-col gap-2">
          <div className="flex items-center justify-between border-b border-[#2B2620]/80 pb-4">
            <p className="smallcaps-detail text-[#8A7A5F]">
              Unit Floor · Live Board
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

          <div className="flex flex-wrap items-end justify-between gap-6 pt-6">
            <div>
              <h1 className="font-display text-5xl text-[#2B2620] sm:text-6xl lg:text-7xl">
                The Occupancy Board
              </h1>
              <p className="font-serif-light mt-3 max-w-xl text-lg italic text-[#6B6152] sm:text-xl">
                A live register of every hemodialysis machine on the floor —
                which are in treatment, which stand vacant, and which cases
                demand immediate attention.
              </p>
            </div>
            <div className="flex flex-col items-stretch gap-3 sm:flex-row">
              <div className="flex items-baseline gap-3 border-l border-[#D9CFBA] pl-4">
                <span className="font-display text-4xl text-[#4E7A48]">
                  {stats.vacant}
                </span>
                <span className="smallcaps-detail text-[#8A7A5F]">Vacant</span>
              </div>
              <div className="flex items-baseline gap-3 border-l border-[#D9CFBA] pl-4">
                <span className="font-display text-4xl text-[#2B2620]">
                  {stats.occupied}
                </span>
                <span className="smallcaps-detail text-[#8A7A5F]">In Use</span>
              </div>
              <div className="flex items-baseline gap-3 border-l border-[#D9CFBA] pl-4">
                <span className="font-display text-4xl text-[#A03A25]">
                  {stats.urgent}
                </span>
                <span className="smallcaps-detail text-[#8A7A5F]">Urgent</span>
              </div>
              <div className="flex items-baseline gap-3 border-l border-[#D9CFBA] pl-4">
                <span className="font-display text-4xl text-[#A0562F]">
                  {stats.dirty}
                </span>
                <span className="smallcaps-detail text-[#8A7A5F]">
                  Isolation
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Section rule */}
        <div className="mt-8 flex items-center gap-4">
          <span className="h-px flex-1 bg-[#D9CFBA]" />
          <span className="smallcaps-detail text-[#8A7A5F]">
            Machines · {data?.length ?? "—"}
          </span>
          <span className="h-px flex-1 bg-[#D9CFBA]" />
        </div>

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
          <div className="mt-6 flex items-center justify-between border border-[#D9CFBA] bg-[#EFE9DC] px-5 py-4">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-[#8A7A5F]" />
              <p className="text-sm text-[#6B6152]">
                Sign in as clinical staff to assign sessions and control
                machines.
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

        {/* Machine grid */}
        <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-[190px]" />
              ))
            : (data ?? []).map((row, i) => (
                <MachineTile
                  key={row.machine.id}
                  row={row}
                  index={i}
                  onAssign={machineId => setAssignTarget(machineId)}
                />
              ))}
        </section>

        {/* Vacant quick-action for authenticated staff */}
        {isAuthenticated && !isLoading && stats.vacant > 0 && (
          <div className="mt-8 flex items-center justify-between border-t border-[#D9CFBA] pt-5">
            <p className="font-serif-light italic text-[#6B6152]">
              {stats.vacant} machine{stats.vacant === 1 ? "" : "s"} available
              for immediate assignment.
            </p>
            <Button
              onClick={() => {
                const first = data?.find(r => !r.session);
                if (first) setAssignTarget(first.machine.id);
              }}
              className="bg-[#2B2620] text-[#F6F1E7] hover:bg-[#1A1611] font-serif-light"
            >
              <Plus className="mr-2 h-4 w-4" />
              Assign Next Vacant Machine
            </Button>
          </div>
        )}
      </div>

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
