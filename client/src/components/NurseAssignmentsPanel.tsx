import { trpc } from "@/lib/trpc";
import { Activity, Bell, Clock, Droplet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type NurseAssignment = {
  nurse: string;
  kind: "session" | "waiting";
  id: number;
  machineId: number | null;
  machineLabel: string | null;
  patientId: string;
  displayLabel: string | null;
  endsAt: Date | null;
  durationMinutes: number;
  startedAt: Date | null;
  joinedAt: Date | null;
  urgent: boolean;
  isolationTag: "clean" | "dirty";
};

/** "4 h", "3 h 30 m", "45 m" — the planned length of a treatment. */
function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} m`;
  return m > 0 ? `${h} h ${m} m` : `${h} h`;
}

/**
 * Formats remaining time like "1 h 22 m" (crimson under 15 minutes, muted when done).
 */
export function formatRemaining(endsAt: Date, now: Date): { text: string; overdue: boolean; critical: boolean } {
  const ms = endsAt.getTime() - now.getTime();
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 0) return { text: minutes <= -60 ? "Ended" : "Overdue", overdue: minutes > 0, critical: false };
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return { text: m > 0 ? `${h} h ${m} m` : `${h} h`, overdue: false, critical: false };
  }
  return { text: `${minutes} m`, overdue: false, critical: minutes <= 15 };
}

/**
 * Per-floor nurse-patient roster: one row per patient grouped under the nurse
 * responsible for them, with the treatment time remaining shown live.
 */
export default function NurseAssignmentsPanel({ floorId }: { floorId: number }) {
  const { data: rows, isLoading } = trpc.waiting.nurseAssignments.useQuery(
    { floorId },
    { refetchInterval: 5_000 }
  );
  const [now, setNow] = useState(() => new Date());

  // Live countdown between poll refreshes
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const grouped = useMemo(() => {
    const groups = new Map<string, NurseAssignment[]>();
    for (const r of rows ?? []) {
      const arr = groups.get(r.nurse) ?? [];
      arr.push(r);
      groups.set(r.nurse, arr);
    }
    return Array.from(groups.entries());
  }, [rows]);

  const total = rows?.length ?? 0;

  return (
    <section className="glass-panel border border-[#1F2A52]/80">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D4DFE5] px-5 py-4">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-[#2E9A9B]" />
          <h2 className="font-display text-2xl text-[#1F2A52]">Nurse Assignments</h2>
          <span className="smallcaps-detail border border-[#D4DFE5] bg-[#F4F7F8] px-2 py-0.5 text-[#7684A0]">
            {total} patient{total === 1 ? "" : "s"} · {grouped.length} nurse{grouped.length === 1 ? "" : "s"} on duty
          </span>
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-sm bg-[#F4F7F8]" />
          ))}
        </div>
      ) : total === 0 ? (
        <div className="p-6 text-center">
          <Clock className="mx-auto mb-2 h-5 w-5 text-[#B9C4D4]" />
          <p className="font-serif-light italic text-[#556680]">
            No patients on treatment or waiting on this floor — the roster fills in as soon as a session is assigned or a patient joins the queue.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#D4DFE5]">
          {grouped.map(([nurse, patients]) => (
            <div key={nurse}>
              <div className="flex items-center gap-2 bg-[#F4F7F8] px-5 py-2">
                <Activity className="h-4 w-4 text-[#9E1F2B]" />
                <p className="smallcaps-detail text-[#1F2A52]">
                  {nurse}{" "}
                  <span className="font-normal text-[#7684A0]">
                    · {patients.length} patient{patients.length === 1 ? "" : "s"}
                  </span>
                </p>
              </div>
              <ul>
                {patients.map(p => {
                  const remaining = p.endsAt ? formatRemaining(p.endsAt, now) : null;
                  return (
                    <li
                      key={`${p.kind}-${p.id}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5"
                    >
                      <p className="w-28 font-display text-sm text-[#1F2A52]">
                        {p.machineLabel ?? (
                          <span className="smallcaps-detail text-[#7684A0]">Queued</span>
                        )}
                      </p>
                      <p className="flex-1 text-sm text-[#37425F]">
                        {p.displayLabel && p.displayLabel.trim()
                          ? p.displayLabel
                          : p.patientId}
                        {!p.displayLabel && (
                          <span className="ml-2 font-serif-light italic text-[#7684A0]">{p.patientId}</span>
                        )}
                      </p>
                      {p.urgent && (
                        <span className="inline-flex items-center gap-1 smallcaps-detail border border-[#9E1F2B]/40 bg-[#9E1F2B]/10 px-2 py-0.5 text-[#9E1F2B]">
                          <Bell className="h-3 w-3" />
                          Urgent
                        </span>
                      )}
                      {p.isolationTag === "dirty" && (
                        <span className="inline-flex items-center gap-1 smallcaps-detail border border-[#2E9A9B]/40 bg-[#2E9A9B]/10 px-2 py-0.5 text-[#1B6E6F]">
                          <Droplet className="h-3 w-3" />
                          Dirty
                        </span>
                      )}
                      {remaining ? (
                        <span
                          className={`smallcaps-detail border px-2 py-0.5 ${
                            remaining.overdue
                              ? "border-[#9E1F2B] bg-[#9E1F2B]/10 text-[#9E1F2B]"
                              : remaining.critical
                                ? "border-[#C98A1E] bg-[#C98A1E]/10 text-[#8A5F12]"
                                : "border-[#3E8A6A]/40 bg-[#3E8A6A]/8 text-[#3E8A6A]"
                          }`}
                        >
                          {remaining.overdue ? "⏰ " : ""}
                          {remaining.text} {remaining.overdue ? "" : "left"}
                        </span>
                      ) : (
                        <span className="smallcaps-detail border border-[#D4DFE5] bg-[#F4F7F8] px-2 py-0.5 text-[#556680]">
                          Waiting · {formatDuration(p.durationMinutes)} booked
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
