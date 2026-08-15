import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ClipboardList, Dumbbell, PenLine, Printer, Trash2, UserRound, Users } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";

const REPORT_PERIODS: { key: string; label: string }[] = [
  { key: "session1", label: "Session 1 · 5:00 – 10:00 AM" },
  { key: "transition1", label: "Transition 1 · Hooking & Terminating · 9:00 – 11:00 AM" },
  { key: "session2", label: "Session 2 · 10:00 AM – 2:00 PM" },
  { key: "transition2", label: "Transition 2 · Hooking & Terminating · 1:00 – 3:00 PM" },
  { key: "session3", label: "Session 3 · 2:00 – 6:00 PM" },
  { key: "transition3", label: "Transition 3 · Hooking & Terminating · 5:00 – 8:00 PM" },
  { key: "session4", label: "Session 4 · 6:00 – 10:00 PM" },
];

const SUPERVISOR_PERIODS: { key: string; label: string }[] = [
  { key: "supShift1", label: "Supervisor Shift · 7:00 AM – 3:00 PM" },
  { key: "supShift2", label: "Supervisor Shift · 3:00 – 11:00 PM" },
  { key: "supShift3", label: "Supervisor Shift · 11:00 PM – 7:00 AM" },
];
const SUPERVISOR_SHIFTS: { key: string; label: string }[] = [
  { key: "07-15", label: "7:00 AM – 3:00 PM" },
  { key: "15-23", label: "3:00 – 11:00 PM" },
  { key: "23-07", label: "11:00 PM – 7:00 AM" },
];
const REPORT_SHIFTS: { key: string; label: string }[] = [
  { key: "05-13", label: "5:00 AM – 1:00 PM" },
  { key: "13-21", label: "1:00 – 9:00 PM" },
  { key: "21-05", label: "9:00 PM – 5:00 AM" },
  { key: "07-15", label: "7:00 AM – 3:00 PM" },
  { key: "15-23", label: "3:00 – 11:00 PM" },
  { key: "23-07", label: "11:00 PM – 7:00 AM" },
];

type ReportBoard = {
  floorName: string | null;
  reportDate: string;
  totalMachinesOnFloor: number;
  sessionsEnded: number;
  machinesUtilized: { used: number; total: number };
  patientsCatered: number;
  urgency: { normal: number; urgent: number; veryUrgent: number };
  isolation: { clean: number; dirty: number };
  totalTreatmentHours: number;
  waitingAdds: { normal: number; urgent: number; veryUrgent: number; total: number };
  machineMetrics: Record<
    string,
    { machineLabel?: string; pausedMinutes: number; idleMinutes: number; occupiedMinutes: number }
  >;
  pauseSummary: { totalPausedMinutes: number; machinesPaused: number };
};

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  });
}

function localDateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * One per-floor report section. The useQuery call lives inside this
 * component so each floor keeps a stable hook position across renders —
 * calling useQuery inside a .map() in the parent would break React's
 * rules of hooks and crash with "Rendered more hooks than during the
 * previous render".
 */
function ReportBoardSection({
  floorId,
  date,
}: {
  floorId: number;
  date: string;
}) {
  const { data, isLoading, error, refetch } = trpc.endOfDay.summary.useQuery(
    { date, floorId },
    { refetchInterval: false }
  );
  if (isLoading) return <Skeleton className="h-72" />;
  if (error) {
    return (
      <Card className="border-[#9E1F2B]/40 bg-[#FBF5F5]">
        <CardContent className="flex items-center justify-between gap-4 py-5">
          <p className="text-sm text-[#9E1F2B]">
            Could not load this board: {error.message}
          </p>
          <Button
            size="sm"
            className="bg-[#9E1F2B] text-white hover:bg-[#7a1822]"
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!data) return <Skeleton className="h-72" />;
  return <ReportBoardCard board={data} />;
}

/**
 * End of Day report: per-board summary of machines utilized, patients catered,
 * urgency breakdown, isolation tags and same-day waiting-list additions.
 * Printable via the browser's print dialog.
 */
export default function EndOfDayReport() {
  const [date, setDate] = useState(() => localDateStr(0));

  // Staff session scoping: the summary query already restricts nurses to
  // their own board. Supervisors see every board (one section per floor,
  // each with its own stable query hook); nurses (one board) and guests use
  // the single unscoped query.
  const { data: floors } = trpc.machines.listFloors.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const singleQuery = trpc.endOfDay.summary.useQuery(
    { date },
    { refetchInterval: false }
  );
  const staffMe = trpc.staff.me.useQuery(undefined, { retry: false });
  const staff = staffMe.data ?? null;
  const utils = trpc.useUtils();

  const isMulti = staff?.role === "supervisor";
  const isGuest = staff?.role === "guest";
  const isLoading = isMulti
    ? (floors ?? []).length === 0 || floors === undefined
    : singleQuery.isLoading;
  const refresh = () => {
    if (isMulti) {
      (floors ?? []).forEach(f => void utils.endOfDay.summary.invalidate({ date, floorId: f.id }));
    }
    void singleQuery.refetch();
    void utils.machines.listFloors.invalidate();
  };
  const boards: ReportBoard[] = !isMulti && singleQuery.data ? [singleQuery.data] : [];
  const dateLabel = formatDateLabel(new Date(`${date}T12:00:00+08:00`));

  return (
    <DashboardLayout>
      {isGuest ? (
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 border border-dashed border-[#D4DFE5] bg-[#F4F7F8] px-6 py-16 text-center">
          <ClipboardList className="h-8 w-8 text-[#7684A0]" />
          <p className="font-serif-light text-lg text-[#556680]">
            End of Day reports are reserved for clinical staff.
          </p>
          <Link
            href="/staff-login"
            className="text-sm font-medium text-[#2E9A9B] underline underline-offset-4"
          >
            Sign in as staff to view reports
          </Link>
        </div>
      ) : (
        <>
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-[#7684A0]">
              <ClipboardList className="h-3.5 w-3.5" />
              Clinical Summary
            </div>
            <h1 className="font-display text-3xl tracking-tight text-[#1F2A52]">
              End of Day Report
            </h1>
            <p className="mt-1 text-sm text-[#556680]">
              Sessions concluded, machines utilized and patients catered on the
              board{isMulti ? "s" : ""} for {dateLabel}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              max={localDateStr(0)}
              onChange={e => {
                setDate(e.target.value || localDateStr(0));
              }}
              className="h-9 rounded-sm border border-[#D4DFE5] bg-white px-2 text-sm text-[#1F2A52] outline-none focus:border-[#2E9A9B]"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-9 border-[#D4DFE5] text-[#1F2A52]"
              onClick={() => window.print()}
            >
              <Printer className="mr-1.5 h-4 w-4" />
              Print
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 border-[#D4DFE5] text-[#1F2A52]"
              onClick={refresh}
            >
              Refresh
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
        )}

        {!isLoading && !isMulti && singleQuery.error && (
          <Card className="mt-8 border-[#9E1F2B]/40 bg-[#FBF5F5]">
            <CardContent className="flex items-center justify-between gap-4 py-5">
              <p className="text-sm text-[#9E1F2B]">
                The report could not be loaded: {singleQuery.error.message}
              </p>
              <Button
                size="sm"
                className="bg-[#9E1F2B] text-white hover:bg-[#7a1822]"
                onClick={() => void singleQuery.refetch()}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && !isMulti && !singleQuery.data && (
          <Card className="mt-8 border-[#D4DFE5]">
            <CardContent className="flex flex-col items-center gap-3 py-10">
              <Dumbbell className="h-8 w-8 text-[#7684A0]" />
              <p className="font-serif-light text-lg italic text-[#556680]">
                No sessions were concluded on {dateLabel} — the report stays
                empty until a treatment ends.
              </p>
              <Button size="sm" variant="outline" asChild className="border-[#D4DFE5] text-[#1F2A52]">
                <Link href="/">Back to the board</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {!isMulti && singleQuery.data && (
          <div className="mt-8 grid gap-5 lg:grid-cols-2 print:grid-cols-1">
            <div className="flex flex-col gap-5">
              <ReportBoardCard board={singleQuery.data} />
              {singleQuery.data.floorName && (
                <NarrativeSection
                  floorId={(floors ?? []).find(f => f.name === singleQuery.data.floorName)?.id ?? 0}
                  floorName={singleQuery.data.floorName}
                  date={date}
                  staff={staff}
                />
              )}
            </div>
          </div>
        )}

        {isMulti && (
          <div className="mt-8 grid gap-5 lg:grid-cols-2 print:grid-cols-1">
            {(floors ?? []).map(f => (
              <ReportBoardSection key={f.id} floorId={f.id} date={date} />
            ))}
          </div>
        )}

        {isMulti &&
          (floors ?? []).map(f => (
            <NarrativeSection
              key={`narrative-${f.id}`}
              floorId={f.id}
              floorName={f.name}
              date={date}
              staff={staff}
            />
          ))}

        {isMulti &&
          (floors ?? []).map(f => (
            <SupervisorNarrativeSection
              key={`sup-narrative-${f.id}`}
              floorId={f.id}
              floorName={f.name}
              date={date}
              staff={staff}
            />
          ))}

        {!isMulti && singleQuery.data && singleQuery.data.floorName && (
          <SupervisorNarrativeSection
            floorId={(floors ?? []).find(f => f.name === singleQuery.data.floorName)?.id ?? 0}
            floorName={singleQuery.data.floorName}
            date={date}
            staff={staff}
          />
        )}
      </div>
        </>
      )}
    </DashboardLayout>
  );
}

function SupervisorNarrativeSection({
  floorId,
  floorName,
  date,
  staff,
}: {
  floorId: number;
  floorName: string | null;
  date: string;
  staff: { role: string; displayName?: string } | null;
}) {
  const utils = trpc.useUtils();
  const listQuery = trpc.narratives.list.useQuery(
    { floorId, reportDate: date },
    { retry: false }
  );
  const narratives = listQuery.data;
  const isLoading = listQuery.isLoading;
  const isError = listQuery.isError;
  const error = listQuery.error;
  // Only the supervisor writes; everyone else (nurses, guests, OAuth users)
  // views these supervisor narratives read-only.
  const canWriteSupervisor = staff?.role === "supervisor";

  const [openPeriod, setOpenPeriod] = useState<string | null>(null);
  const [openAuthor, setOpenAuthor] = useState(() => staff?.displayName ?? "");
  const [openBody, setOpenBody] = useState("");

  const createMutation = trpc.narratives.create.useMutation({
    onSuccess: () => void utils.narratives.list.invalidate({ floorId, reportDate: date }),
  });
  const removeMutation = trpc.narratives.remove.useMutation({
    onSuccess: () => void utils.narratives.list.invalidate({ floorId, reportDate: date }),
  });

  const entriesByPeriod = useMemo(() => {
    const map = new Map<string, { id: number; shiftKey?: string | null; author: string; body: string; updatedAt: Date }>();
    for (const entry of narratives ?? []) {
      if (
        entry.periodKey &&
        SUPERVISOR_PERIODS.some(p => p.key === entry.periodKey)
      ) {
        map.set(entry.periodKey, entry);
      }
    }
    return map;
  }, [narratives]);

  return (
    <Card className="mt-5 border border-[#1F2A52]/15 bg-[#1F2A52]/[0.03] print:break-inside-avoid">
      <CardHeader className="border-b border-[#D4DFE5]/70 pb-4">
        <CardTitle className="font-display text-base text-[#1F2A52]">
          Supervisor Narrative Report{floorName ? ` · ${floorName}` : ""}
        </CardTitle>
        <p className="text-xs text-[#556680]">
          {canWriteSupervisor
            ? "Supervisor shift handover notes — 7 AM–3 PM, 3 PM–11 PM, and 11 PM–7 AM. Write one per shift on duty."
            : "Supervisor shift handover notes recorded for this day — supervisors write, everyone else views."}
        </p>
      </CardHeader>
      <CardContent className="space-y-2 pt-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : isError ? (
          <p className="px-3.5 py-3 text-xs text-[#9E1F2B]">
            Supervisor narratives could not be loaded ({String(error?.message ?? "network error")}) — try signing in as staff or refresh the page.
          </p>
        ) : (
          SUPERVISOR_PERIODS.map(period => {
            const entry = entriesByPeriod.get(period.key);
            return (
              <div
                key={period.key}
                className="rounded-sm border border-[#D4DFE5] bg-[#FBFCFD]"
              >
                {entry ? (
                  <div className="flex items-start justify-between gap-3 px-3.5 py-3">
                    <div>
                      <p className="font-serif-light text-[13px] font-semibold text-[#1F2A52]">
                        {period.label}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#556680]">
                        {entry.body}
                      </p>
                      <p className="mt-1.5 text-[10px] text-[#7684A0]">
                        by {entry.author} · updated{" "}
                        {new Date(entry.updatedAt).toLocaleString([], {
                          timeZone: "Asia/Manila",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    {canWriteSupervisor && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 border-[#D4DFE5] text-[#1F2A52]"
                        onClick={() => void removeMutation.mutate({ id: entry.id, floorId })}
                        title="Delete this narrative"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                    <p className="text-[13px] font-serif-light text-[#7684A0]">{period.label}</p>
                    {canWriteSupervisor ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 border-[#2E9A9B]/50 text-[#1d6b6c]"
                        onClick={() => {
                          setOpenPeriod(period.key);
                          setOpenBody("");
                          setOpenAuthor(staff?.displayName ?? "");
                        }}
                      >
                        Write narrative
                      </Button>
                    ) : (
                      <span className="text-[10px] uppercase tracking-[0.12em] text-[#9E1F2B]/70">No entry</span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {canWriteSupervisor && openPeriod && (
          <div className="rounded-sm border border-[#2E9A9B]/40 bg-[#EFF8F8] p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#1d6b6c]">
              {SUPERVISOR_PERIODS.find(p => p.key === openPeriod)?.label}
            </p>
            <div className="mt-3 grid gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-[0.14em] text-[#556680]">Your name</label>
                <input
                  value={openAuthor}
                  onChange={e => setOpenAuthor(e.target.value)}
                  className="mt-1 h-9 w-full rounded-sm border border-[#D4DFE5] bg-white px-2 text-sm text-[#1F2A52] outline-none focus:border-[#2E9A9B]"
                  placeholder="e.g., Al John Manalaysay"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.14em] text-[#556680]">Narrative</label>
                <textarea
                  value={openBody}
                  onChange={e => setOpenBody(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  className="mt-1 w-full resize-y rounded-sm border border-[#D4DFE5] bg-white px-2.5 py-2 text-sm leading-relaxed text-[#1F2A52] outline-none focus:border-[#2E9A9B]"
                  placeholder="Write the supervisor shift narrative for this period…"
                />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-[#D4DFE5] text-[#556680]"
                onClick={() => setOpenPeriod(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-[#2E9A9B] text-white hover:bg-[#278788] disabled:opacity-60"
                disabled={!openBody.trim() || createMutation.isPending}
                onClick={() => {
                  if (!openBody.trim() || !openAuthor.trim() || !openPeriod) return;
                  createMutation.mutate(
                    {
                      floorId,
                      reportDate: date,
                      periodKey: openPeriod,
                      shiftKey: SUPERVISOR_PERIODS.find(p => p.key === openPeriod)?.label ? null : null,
                      author: openAuthor.trim(),
                      body: openBody.trim(),
                    },
                    {
                      onSuccess: () => {
                        setOpenPeriod(null);
                        setOpenBody("");
                      },
                    }
                  );
                }}
              >
                {createMutation.isPending ? "Saving…" : "Save narrative"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReportBoardCard({ board }: { board: ReportBoard }) {
  const utilizationPct =
    board.totalMachinesOnFloor > 0
      ? Math.round((board.machinesUtilized.used / board.totalMachinesOnFloor) * 100)
      : 0;
  const urgentTotal = board.urgency.urgent + board.urgency.veryUrgent;
  const waitingTotal = board.waitingAdds.total;

  return (
    <Card className="border border-[#1F2A52]/15 shadow-sm print:break-inside-avoid">
      <CardHeader className="border-b border-[#D4DFE5]/70 pb-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-display text-xl text-[#1F2A52]">
            {board.floorName ?? "All boards"}
          </CardTitle>
          <span className="smallcaps-detail border border-[#D4DFE5] bg-[#F4F7F8] px-2 py-0.5 text-[#7684A0]">
            {board.reportDate}
          </span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#E8EFF1]">
          <div
            className="h-full rounded-full bg-[#2E9A9B] transition-all"
            style={{ width: `${utilizationPct}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-[#7684A0]">
          {board.machinesUtilized.used} of {board.machinesUtilized.total} machines
          used today ({utilizationPct}% utilization)
        </p>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div className="grid grid-cols-3 gap-3">
          <StatTile
            icon={Dumbbell}
            label="Machines utilized"
            value={String(board.machinesUtilized.used)}
            tone="navy"
          />
          <StatTile
            icon={Users}
            label="Patients catered"
            value={String(board.patientsCatered)}
            tone="teal"
          />
          <StatTile
            icon={ClipboardList}
            label="Sessions ended"
            value={String(board.sessionsEnded)}
            tone="navy"
          />
        </div>

        <div>
          <p className="smallcaps-detail text-[11px] tracking-[0.18em] text-[#7684A0]">
            Priority breakdown · waiting list
          </p>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <BreakdownCell label="Normal" value={board.waitingAdds.normal} color="bg-[#3E8A6A]" />
            <BreakdownCell label="Urgent" value={board.waitingAdds.urgent} color="bg-[#C8A63B]" />
            <BreakdownCell
              label="Very Urgent"
              value={board.waitingAdds.veryUrgent}
              color="bg-[#9E1F2B]"
            />
          </div>
          <p className="mt-2 text-xs text-[#556680]">
            {waitingTotal} patient{waitingTotal === 1 ? "" : "s"} added to the waiting list ·{" "}
            {urgentTotal} urgent session{urgentTotal === 1 ? "" : "s"} among{" "}
            {board.sessionsEnded} concluded treatment{board.sessionsEnded === 1 ? "" : "s"}.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-sm border border-[#D4DFE5] bg-[#FBFCFD] px-3.5 py-3">
            <p className="smallcaps-detail text-[10px] tracking-[0.18em] text-[#7684A0]">
              Isolation tags
            </p>
            <p className="mt-1 font-display text-lg text-[#1F2A52]">
              {board.isolation.clean} clean{" "}
              <span className="text-sm text-[#7684A0]">· {board.isolation.dirty} dirty</span>
            </p>
          </div>
          <div className="rounded-sm border border-[#D4DFE5] bg-[#FBFCFD] px-3.5 py-3">
            <p className="smallcaps-detail text-[10px] tracking-[0.18em] text-[#7684A0]">
              Sessions by urgency
            </p>
            <p className="mt-1 font-display text-lg text-[#1F2A52]">
              {board.urgency.normal} routine{" "}
              <span className="text-sm text-[#7684A0]">· {board.urgency.urgent} urgent</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-[#D4DFE5]/70 pt-3">
          <UserRound className="h-3.5 w-3.5 text-[#2E9A9B]" />
          <p className="text-xs text-[#556680]">
            Total treatment time today: {board.totalTreatmentHours} hours
            {board.pauseSummary.totalPausedMinutes > 0 &&
              ` · ${board.pauseSummary.totalPausedMinutes} paused minutes across ${board.pauseSummary.machinesPaused} machine${board.pauseSummary.machinesPaused === 1 ? "" : "s"}`}
          </p>
        </div>

        {board.machineMetrics && Object.keys(board.machineMetrics).length > 0 && (
          <div className="border-t border-[#D4DFE5]/70 pt-3">
            <p className="smallcaps-detail text-[11px] tracking-[0.18em] text-[#7684A0]">
              Machine time · pause &amp; idle minutes
            </p>
            <div className="mt-2 max-h-56 overflow-y-auto print:max-h-none">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-[#7684A0]">
                    <th className="py-1.5 pr-2 font-medium">Machine</th>
                    <th className="px-2 py-1.5 font-medium">In treatment</th>
                    <th className="px-2 py-1.5 font-medium">Paused</th>
                    <th className="pl-2 py-1.5 font-medium">Idle (vacant)</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.entries(board.machineMetrics) as [
                    string,
                    { machineLabel: string; pausedMinutes: number; idleMinutes: number; occupiedMinutes: number },
                  ][])
                    .sort((a, b) => a[1].idleMinutes - b[1].idleMinutes)
                    .map(([label, m]) => (
                      <tr key={label} className="border-t border-[#D4DFE5]/50">
                        <td className="py-1 pr-2 font-medium text-[#1F2A52]">{m.machineLabel}</td>
                        <td className="px-2 py-1 text-[#556680]">{fmtMinutes(m.occupiedMinutes)}</td>
                        <td className="px-2 py-1 text-[#9E1F2B]">{fmtMinutes(m.pausedMinutes)}</td>
                        <td className="pl-2 py-1 text-[#556680]">{fmtMinutes(m.idleMinutes)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[10px] text-[#7684A0]">
              Idle = hours the board was running treatments but this machine sat
              vacant. Machines with no activity today are not listed.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function fmtMinutes(total: number): string {
  if (total <= 0) return "0 min";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0) return `${h}h ${m > 0 ? `${m}m` : ""}`.trim();
  return `${m} min`;
}

function NarrativeSection({
  floorId,
  floorName,
  date,
  staff,
}: {
  floorId: number;
  floorName: string;
  date: string;
  staff: { role: string; displayName?: string | null; name?: string } | null;
}) {
  return <NarrativeReport floorId={floorId} floorName={floorName} date={date} staff={staff} editable={false} />;
}

/**
 * Charge-nurse narrative report: shared between the board pages (editable,
 * nurses write it during the shift) and the End of Day Report (read-only
 * reflection of what was written).
 */
export function NarrativeReport({
  floorId,
  floorName,
  date,
  staff,
  editable,
}: {
  floorId: number;
  floorName: string;
  date: string;
  staff: { role: string; displayName?: string | null; name?: string } | null;
  editable: boolean;
}) {
  if (!floorId) return null;
  const utils = trpc.useUtils();
  const { data: narratives, isLoading, isError, error } = trpc.narratives.list.useQuery(
    { floorId, reportDate: date },
    { refetchInterval: editable ? 15_000 : false }
  );
  const createMutation = trpc.narratives.create.useMutation({
    onSuccess: () => void utils.narratives.list.invalidate({ floorId, reportDate: date }),
  });
  const removeMutation = trpc.narratives.remove.useMutation({
    onSuccess: () => void utils.narratives.list.invalidate({ floorId, reportDate: date }),
  });

  // Charge nurses write the board narratives; supervisors only view them.
  const canWriteBoard = editable && staff?.role !== "supervisor";

  const [openPeriod, setOpenPeriod] = useState<string | null>(null);
  const [openShift, setOpenShift] = useState<string>("05-13");
  const [openAuthor, setOpenAuthor] = useState(() => staff?.displayName ?? "");
  const [openBody, setOpenBody] = useState("");

  const entriesByPeriod = useMemo(() => {
    const map = new Map<string, { id: number; periodKey: string; shiftKey: string | null; author: string; body: string; updatedAt: Date }>();
    (narratives ?? []).forEach(n => map.set(n.periodKey, n as never));
    return map;
  }, [narratives]);

  const authorName = staff?.displayName ?? "";
  if (!authorName && openAuthor === "") setOpenAuthor("");

  return (
    <Card className="border border-[#1F2A52]/15 shadow-sm print:break-inside-avoid">
      <CardHeader className="border-b border-[#D4DFE5]/70 pb-4">
        <div className="flex items-center gap-2">
          <PenLine className="h-4 w-4 text-[#2E9A9B]" />
          <CardTitle className="font-display text-lg text-[#1F2A52]">
            Narrative Report · {floorName}
          </CardTitle>
        </div>
        <p className="text-xs text-[#556680]">
          {canWriteBoard
            ? "Charge nurse narratives for each session and hooking/terminating transition of the day — write during the shift."
            : "Charge nurse narratives recorded for this day — supervisors view only."}
        </p>
      </CardHeader>
      <CardContent className="space-y-2 pt-4">
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : isError ? (
          <p className="px-3.5 py-3 text-xs text-[#9E1F2B]">
            Narratives could not be loaded ({String(error?.message ?? "network error")}) — try signing in as clinical staff or refresh the page.
          </p>
        ) : !canWriteBoard && narratives !== undefined ? (
          // Read-only rendering for supervisors / anyone without write rights.
          REPORT_PERIODS.map(period => {
            const entry = entriesByPeriod.get(period.key);
            return (
              <div
                key={period.key}
                className="rounded-sm border border-[#D4DFE5] bg-[#FBFCFD]"
              >
                {entry ? (
                  <div className="flex items-start justify-between gap-3 px-3.5 py-3">
                    <div>
                      <p className="font-serif-light text-[13px] font-semibold text-[#1F2A52]">
                        {period.label}
                      </p>
                      {entry.shiftKey && (
                        <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-[#7684A0]">
                          Shift {REPORT_SHIFTS.find(s => s.key === entry.shiftKey)?.label ?? entry.shiftKey}
                        </p>
                      )}
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#556680]">
                        {entry.body}
                      </p>
                      <p className="mt-1.5 text-[10px] text-[#7684A0]">
                        by {entry.author} · updated{" "}
                        {new Date(entry.updatedAt).toLocaleString([], { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    {canWriteBoard && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 border-[#D4DFE5] text-[#1F2A52]"
                        onClick={() => void removeMutation.mutate({ id: entry.id, floorId })}
                        title="Delete this narrative"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                    <p className="text-[13px] font-serif-light text-[#7684A0]">{period.label}</p>
                    {canWriteBoard ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 border-[#2E9A9B]/50 text-[#1d6b6c]"
                        onClick={() => {
                          setOpenPeriod(period.key);
                          setOpenBody("");
                          setOpenAuthor(authorName);
                          setOpenShift("05-13");
                        }}
                      >
                        Write narrative
                      </Button>
                    ) : (
                      <span className="text-[10px] uppercase tracking-[0.12em] text-[#9E1F2B]/70">No entry</span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : canWriteBoard ? (
          // Writable rendering for charge nurses on the board pages.
          REPORT_PERIODS.map(period => {
            const entry = entriesByPeriod.get(period.key);
            return (
              <div
                key={period.key}
                className="rounded-sm border border-[#D4DFE5] bg-[#FBFCFD]"
              >
                {entry ? (
                  <div className="flex items-start justify-between gap-3 px-3.5 py-3">
                    <div>
                      <p className="font-serif-light text-[13px] font-semibold text-[#1F2A52]">
                        {period.label}
                      </p>
                      {entry.shiftKey && (
                        <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-[#7684A0]">
                          Shift {REPORT_SHIFTS.find(s => s.key === entry.shiftKey)?.label ?? entry.shiftKey}
                        </p>
                      )}
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#556680]">
                        {entry.body}
                      </p>
                      <p className="mt-1.5 text-[10px] text-[#7684A0]">
                        by {entry.author} · updated{" "}
                        {new Date(entry.updatedAt).toLocaleString([], { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 border-[#D4DFE5] text-[#1F2A52]"
                      onClick={() => void removeMutation.mutate({ id: entry.id, floorId })}
                      title="Delete this narrative"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                    <p className="text-[13px] font-serif-light text-[#7684A0]">{period.label}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 border-[#2E9A9B]/50 text-[#1d6b6c]"
                      onClick={() => {
                        setOpenPeriod(period.key);
                        setOpenBody("");
                        setOpenAuthor(authorName);
                        setOpenShift("05-13");
                      }}
                    >
                      Write narrative
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        ) : null}

        {canWriteBoard && openPeriod && (
          <div className="rounded-sm border border-[#2E9A9B]/40 bg-[#EFF8F8] p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#1d6b6c]">
              {REPORT_PERIODS.find(p => p.key === openPeriod)?.label}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[10px] uppercase tracking-[0.14em] text-[#556680]">
                  Shift on duty
                </label>
                <select
                  value={openShift}
                  onChange={e => setOpenShift(e.target.value)}
                  className="mt-1 h-9 w-full rounded-sm border border-[#D4DFE5] bg-white px-2 text-sm text-[#1F2A52] outline-none focus:border-[#2E9A9B]"
                >
                  {REPORT_SHIFTS.map(s => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.14em] text-[#556680]">
                  Charge nurse (author)
                </label>
                <input
                  value={openAuthor}
                  onChange={e => setOpenAuthor(e.target.value)}
                  placeholder="e.g. RN Maria Cruz"
                  className="mt-1 h-9 w-full rounded-sm border border-[#D4DFE5] bg-white px-2 text-sm text-[#1F2A52] outline-none focus:border-[#2E9A9B]"
                />
              </div>
            </div>
            <label className="mt-3 block text-[10px] uppercase tracking-[0.14em] text-[#556680]">
              Narrative · what happened during this period
            </label>
            <textarea
              value={openBody}
              onChange={e => setOpenBody(e.target.value)}
              placeholder="Patients hooked / terminated, transfers, incidents, supply issues, equipment notes…"
              rows={4}
              className="mt-1 w-full rounded-sm border border-[#D4DFE5] bg-white px-2 py-1.5 text-sm text-[#1F2A52] outline-none focus:border-[#2E9A9B]"
            />
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                className="bg-[#2E9A9B] text-white hover:bg-[#1d6b6c]"
                disabled={!openBody.trim() || !openAuthor.trim() || createMutation.isPending}
                onClick={() => {
                  if (!openBody.trim() || !openAuthor.trim()) return;
                  createMutation.mutate(
                    {
                      floorId,
                      reportDate: date,
                      periodKey: openPeriod,
                      shiftKey: openShift,
                      author: openAuthor.trim(),
                      body: openBody.trim(),
                    },
                    {
                      onSuccess: () => {
                        setOpenPeriod(null);
                      },
                    }
                  );
                }}
              >
                {createMutation.isPending ? "Saving…" : "Save narrative"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-[#D4DFE5] text-[#556680]"
                onClick={() => setOpenPeriod(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Dumbbell;
  label: string;
  value: string;
  tone: "navy" | "teal";
}) {
  return (
    <div
      className={`rounded-sm border px-3.5 py-3 ${
        tone === "navy"
          ? "border-[#1F2A52]/20 bg-[#1F2A52] text-[#F4F7F8]"
          : "border-[#2E9A9B]/30 bg-[#2E9A9B]/8 text-[#1d6b6c]"
      }`}
    >
      <Icon className="h-4 w-4 opacity-80" />
      <p className="mt-1 font-display text-2xl leading-none">{value}</p>
      <p
        className={`mt-1 text-[10px] uppercase tracking-[0.14em] ${
          tone === "navy" ? "text-[#F4F7F8]/70" : "text-[#556680]"
        }`}
      >
        {label}
      </p>
    </div>
  );
}

function BreakdownCell({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-[#D4DFE5] bg-[#FBFCFD] px-3 py-2.5">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span className="flex-1 text-[11px] text-[#556680]">{label}</span>
      <span className="font-display text-lg text-[#1F2A52]">{value}</span>
    </div>
  );
}
