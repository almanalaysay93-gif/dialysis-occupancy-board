import EndSessionDialog from "@/components/EndSessionDialog";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { BellRing, Droplets, Power } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

function formatHMS(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function durationLabel(min: number): string {
  if (min === 180) return "3 h";
  if (min === 360) return "6 h";
  if (min === 480) return "8 h";
  return `${Math.round(min / 60)} h`;
}

export default function Urgent() {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.machines.list.useQuery(undefined, {
    refetchInterval: 5_000,
  });

  const urgentRows = useMemo(
    () => (data ?? []).filter(r => r.session?.urgent),
    [data]
  );

  const toggleUrgent = trpc.sessions.toggleUrgent.useMutation({
    onSuccess: (_v, vars) => {
      const row = data?.find(r => r.session?.id === vars.sessionId);
      toast.success(
        `Urgent flag cleared on ${row?.machine.label ?? "machine"}`,
      );
      void utils.machines.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const [endTarget, setEndTarget] = useState<{
    sessionId: number;
    machineLabel: string;
  } | null>(null);

  return (
    <DashboardLayout>
      <div className="px-6 py-8 lg:px-12 lg:py-10">
        <header className="border-b border-[#2B2620]/80 pb-4">
          <p className="smallcaps-detail text-[#8A7A5F]">Priority Register</p>
          <h1 className="font-display mt-2 text-4xl text-[#2B2620] sm:text-5xl">
            Urgent Cases
          </h1>
          <p className="font-serif-light mt-3 max-w-xl text-lg italic text-[#6B6152]">
            Active sessions currently flagged as urgent — reviewed at a glance,
            one register.
          </p>
        </header>

        {!isAuthenticated && (
          <div className="mt-6 flex items-center justify-between border border-[#D9CFBA] bg-[#EFE9DC] px-5 py-4">
            <p className="text-sm text-[#6B6152]">
              Sign in as clinical staff to manage urgent flags.
            </p>
            <Button
              size="sm"
              onClick={() => startLogin()}
              className="bg-[#2B2620] text-[#F6F1E7] hover:bg-[#1A1611]"
            >
              Sign in
            </Button>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-4">
          {isLoading ? (
            <>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-[88px] animate-pulse bg-[#EFE9DC]" />
              ))}
            </>
          ) : urgentRows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 border border-dashed border-[#D9CFBA] py-16">
              <BellRing className="h-6 w-6 text-[#8A7A5F]" />
              <p className="font-serif-light text-xl italic text-[#6B6152]">
                No urgent cases on the floor at this moment.
              </p>
            </div>
          ) : (
            urgentRows.map(row => {
              const session = row.session!;
              const remaining = Math.max(
                0,
                session.endsAt.getTime() - Date.now()
              );
              return (
                <div
                  key={row.machine.id}
                  className="flex flex-wrap items-center gap-4 border border-[#A03A25]/50 bg-[#A03A25]/5 px-5 py-4"
                >
                  <div className="flex h-12 w-12 items-center justify-center bg-[#A03A25]">
                    <span className="font-display text-xl text-[#F6F1E7]">
                      {row.machine.label.replace("HD-", "")}
                    </span>
                  </div>
                  <div className="min-w-[180px]">
                    <p className="smallcaps-detail text-[#8A7A5F]">
                      {row.machine.location} · {row.machine.label}
                    </p>
                    <p className="font-serif-light mt-1 text-lg text-[#2B2620]">
                      Patient {session.patientId}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant="outline"
                      className="smallcaps-detail border-[#A03A25]/50 text-[#A03A25]"
                    >
                      Urgent
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`smallcaps-detail ${
                        session.isolationTag === "clean"
                          ? "border-[#4E7A48]/50 text-[#4E7A48]"
                          : "border-[#A0562F]/50 text-[#A0562F]"
                      }`}
                    >
                      <Droplets className="mr-1 h-2.5 w-2.5" />
                      {session.isolationTag}
                    </Badge>
                    <span className="smallcaps-detail flex items-center text-[#6B6152]">
                      {durationLabel(session.durationMinutes)}
                    </span>
                  </div>
                  <div className="ml-auto flex items-center gap-2 font-mono text-lg tabular-nums text-[#A03A25]">
                    {formatHMS(remaining)}
                    <span className="smallcaps-detail text-[#8A7A5F]">left</span>
                  </div>
                  {isAuthenticated && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          toggleUrgent.mutate({ sessionId: session.id })
                        }
                        className="h-9 border-[#A03A25]/50 text-[#A03A25] hover:bg-[#A03A25]/10"
                      >
                        Clear flag
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEndTarget({
                            sessionId: session.id,
                            machineLabel: row.machine.label,
                          })
                        }
                        className="h-9 border-[#D9CFBA] text-[#2B2620] hover:bg-[#EFE9DC]"
                      >
                        <Power className="mr-1.5 h-3.5 w-3.5" />
                        End session
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <EndSessionDialog
        open={endTarget !== null}
        sessionId={endTarget?.sessionId ?? null}
        machineLabel={endTarget?.machineLabel ?? ""}
        onClose={() => setEndTarget(null)}
        onEnded={() => setEndTarget(null)}
      />
    </DashboardLayout>
  );
}
