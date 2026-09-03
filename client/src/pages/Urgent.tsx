import EndSessionDialog from "@/components/EndSessionDialog";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCanWrite } from "@/hooks/useCanWrite";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { ScrollReveal } from "@/components/ScrollReveal";
import { BellRing, Droplets, Power, Siren, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

type UrgentSession = {
  kind: "session";
  sessionId: number;
  machineId: number;
  machineLabel: string;
  location: string;
  floorId: number | null;
  floorName: string | null;
  patientId: string;
  durationMinutes: number;
  endsAt: Date;
  isolationTag: "clean" | "dirty";
};

type UrgentWaiting = {
  kind: "waiting";
  waitingId: number;
  patientId: string;
  floorId: number;
  floorName: string | null;
  priority: string;
  joinedAt: Date;
};

function formatHMS(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function durationLabel(min: number): string {
  if (min === 180) return "3 h";
  if (min === 240) return "4 h";
  if (min === 360) return "6 h";
  if (min === 480) return "8 h";
  return `${Math.round(min / 60)} h`;
}

function boardLink(floorId: number | null): string {
  if (floorId === null) return "/";
  return `/floor/${floorId}`;
}

export default function Urgent() {
  const utils = trpc.useUtils();
  const { canWrite, isGuest } = useCanWrite();

  const { data, isLoading, error } = trpc.waiting.urgentRegister.useQuery(undefined, {
    refetchInterval: isGuest ? false : 8_000,
    enabled: !isGuest,
  });

  const urgentSessions = useMemo<UrgentSession[]>(
    () => (data?.urgentSessions ?? []) as UrgentSession[],
    [data?.urgentSessions]
  );

  const veryUrgentWaiting = useMemo<UrgentWaiting[]>(
    () => (data?.veryUrgentWaiting ?? []) as UrgentWaiting[],
    [data?.veryUrgentWaiting]
  );

  const toggleUrgent = trpc.sessions.toggleUrgent.useMutation({
    onSuccess: (_v, vars) => {
      const row = urgentSessions.find(s => s.sessionId === vars.sessionId);
      toast.success(
        `Urgent flag cleared on ${row?.machineLabel ?? "machine"}`,
      );
      void utils.waiting.urgentRegister.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const removeWaiting = trpc.waiting.remove.useMutation({
    onSuccess: (_v, vars) => {
      toast.success("Patient removed from the waiting register");
      void utils.waiting.urgentRegister.invalidate();
      void utils.waiting.list.invalidate({ floorId: vars.floorId });
    },
    onError: e => toast.error(e.message),
  });

  const [endTarget, setEndTarget] = useState<{
    sessionId: number;
    machineLabel: string;
  } | null>(null);

  const grouped = useMemo(() => {
    const byFloor = new Map<string | null, UrgentSession[]>();
    for (const s of urgentSessions) {
      const key = s.floorId !== null && s.floorName ? s.floorName : null;
      if (!byFloor.has(key)) byFloor.set(key, []);
      byFloor.get(key)!.push(s);
    }
    return byFloor;
  }, [urgentSessions]);

  const hasContent =
    !isLoading && urgentSessions.length + veryUrgentWaiting.length > 0;

  return (
    <DashboardLayout>
      <div className="w-full px-4 sm:px-6 py-6">
        <header className="border-b border-[#1F2A52]/80 pb-4">
          <p className="smallcaps-detail text-[#7684A0]">SPMCKTI · Priority Register</p>
          <h1 className="font-display mt-2 text-4xl text-[#1F2A52] sm:text-5xl">
            Urgent Cases
          </h1>
          <p className="font-serif-light mt-3 max-w-xl text-lg italic text-[#556680]">
            Every urgent case across all boards — active sessions flagged
            urgent on each floor, and very-urgent patients still waiting.
          </p>
        </header>

        {isGuest ? (
          <div className="glass-panel mt-6 flex flex-col items-center gap-3 px-6 py-14 text-center">
            <BellRing className="h-8 w-8 text-[#7684A0]" />
            <p className="font-serif-light text-lg text-[#556680]">
              The Urgent Cases register is reserved for clinical staff.
            </p>
            <Link href="/staff-login" className="text-sm font-medium text-[#2E9A9B] underline underline-offset-4">
              Sign in as staff to view urgent cases
            </Link>
          </div>
        ) : !canWrite && (
          <div className="glass-panel mt-6 flex items-center justify-between px-5 py-4">
            <p className="text-sm text-[#556680]">
              Sign in as clinical staff to manage urgent flags.
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-9 border-[#D4DFE5] text-[#1F2A52]"
                asChild
              >
                <a href="/staff-login">Staff sign in</a>
              </Button>
              <Button
                size="sm"
                onClick={() => startLogin()}
                className="bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A]"
              >
                Sign in
              </Button>
            </div>
          </div>
        )}

        <div className="mt-8">
        <ScrollReveal>
        <div className="flex flex-col gap-6">
          {isLoading ? (
            <>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-[88px] animate-pulse bg-[#E8EFF1]" />
              ))}
            </>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 border border-[#9E1F2B]/40 bg-[#9E1F2B]/5 py-14">
              <Siren className="h-6 w-6 text-[#9E1F2B]" />
              <p className="font-serif-light text-xl italic text-[#556680]">
                Could not load the urgent register — {error.message}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void utils.waiting.urgentRegister.invalidate()}
                className="h-9 border-[#9E1F2B]/50 text-[#9E1F2B] hover:bg-[#9E1F2B]/10"
              >
                Retry
              </Button>
            </div>
          ) : !hasContent ? (
            <div className="flex flex-col items-center gap-3 border border-dashed border-[#D4DFE5] py-16">
              <BellRing className="h-6 w-6 text-[#7684A0]" />
              <p className="font-serif-light text-xl italic text-[#556680]">
                No urgent cases on any board at this moment.
              </p>
            </div>
          ) : (
            <>
              {urgentSessions.length > 0 && (
                <section aria-label="Urgent sessions in treatment">
                  <p className="smallcaps-detail mb-3 text-[#7684A0]">
                    <Siren className="mr-1 inline h-3.5 w-3.5 text-[#9E1F2B]" />
                    Urgent sessions in treatment — {urgentSessions.length}
                  </p>
                  <div className="flex flex-col gap-3">
                    {Array.from(grouped.entries()).map(([floorName, sessions]) => (
                      <div key={floorName ?? "no-board"}>
                        <p className="mb-2 font-serif-light text-sm italic text-[#556680]">
                          <a
                            href={boardLink(sessions[0]?.floorId ?? null)}
                            className="text-[#1F2A52] underline underline-offset-2 hover:text-[#9E1F2B]"
                          >
                            {floorName ?? "Unassigned floor"}
                          </a>{" "}
                          · {sessions.length} urgent
                        </p>
                        {sessions.map(session => (
                          <UrgentSessionRow
                            key={session.sessionId}
                            session={session}
                            isAuthenticated={canWrite}
                            onClearFlag={() =>
                              toggleUrgent.mutate({ sessionId: session.sessionId })
                            }
                            onEnd={() =>
                              setEndTarget({
                                sessionId: session.sessionId,
                                machineLabel: session.machineLabel,
                              })
                            }
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {veryUrgentWaiting.length > 0 && (
                <section aria-label="Very urgent patients waiting">
                  <p className="smallcaps-detail mb-3 text-[#7684A0]">
                    <Users className="mr-1 inline h-3.5 w-3.5 text-[#9E1F2B]" />
                    Very-urgent patients waiting — {veryUrgentWaiting.length}
                  </p>
                  <div className="flex flex-col gap-3">
                    {veryUrgentWaiting.map(w => (
                      <div
                        key={w.waitingId}
                        className="urgent-waiting flex flex-wrap items-center gap-4 border border-[#9E1F2B]/50 bg-[#9E1F2B]/5 px-5 py-4"
                      >
                        <div className="flex h-12 w-12 items-center justify-center bg-[#9E1F2B]">
                          <Users className="h-5 w-5 text-[#F4F7F8]" />
                        </div>
                        <div className="min-w-[180px]">
                          <p className="smallcaps-detail text-[#7684A0]">
                            Waiting for{" "}
                            <a
                              href={boardLink(w.floorId)}
                              className="text-[#1F2A52] underline underline-offset-2 hover:text-[#9E1F2B]"
                            >
                              {w.floorName ?? `Board ${w.floorId}`}
                            </a>
                          </p>
                          <p className="font-serif-light mt-1 text-lg text-[#1F2A52]">
                            Patient {w.patientId}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge
                            variant="outline"
                            className="smallcaps-detail border-[#9E1F2B]/50 text-[#9E1F2B]"
                          >
                            Very Urgent
                          </Badge>
                          <span className="smallcaps-detail text-[#556680]">
                            Waiting since{" "}
                            {new Date(w.joinedAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <div className="ml-auto flex items-center gap-2 font-mono text-sm tabular-nums text-[#9E1F2B]">
                          {formatHMS(Math.max(0, Date.now() - w.joinedAt.getTime()))}
                          <span className="smallcaps-detail text-[#7684A0]">
                            waiting
                          </span>
                        </div>
                        {canWrite && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={removeWaiting.isPending}
                            onClick={() =>
                              removeWaiting.mutate({
                                entryId: w.waitingId,
                                floorId: w.floorId,
                              })
                            }
                            className="h-9 border-[#D4DFE5] text-[#1F2A52] hover:bg-[#E8EFF1]"
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
        </ScrollReveal>
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

function UrgentSessionRow({
  session,
  isAuthenticated,
  onClearFlag,
  onEnd,
}: {
  session: UrgentSession;
  isAuthenticated: boolean;
  onClearFlag: () => void;
  onEnd: () => void;
}) {
  const remaining = Math.max(0, session.endsAt.getTime() - Date.now());
  return (
    <div className="flex flex-wrap items-center gap-4 border border-[#9E1F2B]/50 bg-[#9E1F2B]/5 px-5 py-4">
      <div className="flex h-12 w-12 items-center justify-center bg-[#9E1F2B]">
        <span className="font-display text-xl text-[#F4F7F8]">
          {session.machineLabel.replace("HD-", "")}
        </span>
      </div>
      <div className="min-w-[180px]">
        <p className="smallcaps-detail text-[#7684A0]">
          {session.location} · {session.machineLabel}
        </p>
        <p className="font-serif-light mt-1 text-lg text-[#1F2A52]">
          Patient {session.patientId}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge
          variant="outline"
          className="smallcaps-detail border-[#9E1F2B]/50 text-[#9E1F2B]"
        >
          Urgent
        </Badge>
        <Badge
          variant="outline"
          className={`smallcaps-detail ${
            session.isolationTag === "clean"
              ? "border-[#3E8A6A]/50 text-[#3E8A6A]"
              : "border-[#2E9A9B]/50 text-[#2E9A9B]"
          }`}
        >
          <Droplets className="mr-1 h-2.5 w-2.5" />
          {session.isolationTag}
        </Badge>
        <span className="smallcaps-detail flex items-center text-[#556680]">
          {durationLabel(session.durationMinutes)}
        </span>
        <a
          href={boardLink(session.floorId)}
          className="smallcaps-detail text-[#1F2A52] underline underline-offset-2 hover:text-[#9E1F2B]"
        >
          {session.floorName ?? `Board ${session.floorId}`}
        </a>
      </div>
      <div className="ml-auto flex items-center gap-2 font-mono text-lg tabular-nums text-[#9E1F2B]">
        {formatHMS(remaining)}
        <span className="smallcaps-detail text-[#7684A0]">left</span>
      </div>
      {isAuthenticated && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onClearFlag}
            className="h-9 border-[#9E1F2B]/50 text-[#9E1F2B] hover:bg-[#9E1F2B]/10"
          >
            Clear flag
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onEnd}
            className="h-9 border-[#D4DFE5] text-[#1F2A52] hover:bg-[#E8EFF1]"
          >
            <Power className="mr-1.5 h-3.5 w-3.5" />
            End session
          </Button>
        </div>
      )}
    </div>
  );
}
