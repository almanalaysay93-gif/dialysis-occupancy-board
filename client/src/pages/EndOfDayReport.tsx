import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ClipboardList, Dumbbell, PenLine, Printer, Trash2, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
        <div className="w-full px-4 sm:px-6 py-6">
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

        {(floors ?? []).length > 0 && (
          <SupervisorNarrativeSection
            floors={floors}
            date={date}
            staff={staff}
            multi={isMulti}
          />
        )}

        {staff?.role === "auditor" && (
          <NarrativeHistorySection floors={floors} date={date} />
        )}
      </div>
        </>
      )}
    </DashboardLayout>
  );
}

function SupervisorNarrativeSection({
  floors,
  date,
  staff,
  multi,
}: {
  floors: { id: number; name: string }[] | undefined;
  date: string;
  staff: { role: string; displayName?: string } | null;
  /** true for supervisors (sees all boards), false for a nurse (owns one board) */
  multi: boolean;
}) {
  const utils = trpc.useUtils();
  // Resolve which boards this viewer can see. A nurse is scoped to their own
  // board (their staff.me only resolves it); a supervisor reads all boards.
  const floorList = (floors ?? []).filter(f => !multi || staff?.role === "supervisor");
  const visibleFloors = multi
    ? floorList
    : floorList.slice(0, 1);

  // One narrative list per visible board (each is a stable per-floor query).
  const listQueries = visibleFloors.map(f =>
    trpc.narratives.list.useQuery({ floorId: f.id, reportDate: date }, { retry: false })
  );
  const isLoading = listQueries.some(q => q.isLoading);
  const isError = listQueries.some(q => q.isError);
  const error = listQueries.find(q => q.isError)?.error;
  // Only the supervisor writes; everyone else (nurses, guests, OAuth users)
  // views these supervisor narratives read-only.
  const canWriteSupervisor = staff?.role === "supervisor";

  const [openPeriod, setOpenPeriod] = useState<string | null>(null);
  const [openFloorId, setOpenFloorId] = useState<number | null>(null);
  const [openAuthor, setOpenAuthor] = useState(() => staff?.displayName ?? "");
  // Entry being edited — when set the dialog pre-fills and updates it instead
  // of creating a new one.
  const [editEntry, setEditEntry] = useState<{
    id: number;
    floorId: number;
    author: string;
    body: string;
    periodKey: string;
  } | null>(null);
  const dialogOpen = openPeriod !== null && openFloorId !== null;

  const createMutation = trpc.narratives.create.useMutation({
    onSuccess: () => {
      toast.success("Supervisor narrative saved");
      void utils.narratives.list.invalidate({ reportDate: date });
    },
    onError: e => toast.error(e.message),
  });
  const removeMutation = trpc.narratives.remove.useMutation({
    onSuccess: () => {
      toast.success("Supervisor narrative removed");
      void utils.narratives.list.invalidate({ reportDate: date });
    },
    onError: e => toast.error(e.message),
  });

  // Map of `${floorId}:${periodKey}` -> entry, collected across the visible
  // boards so each shift row can show every area's entry side by side.
  const entriesByBoardPeriod = useMemo(() => {
    const map = new Map<
      string,
      { id: number; floorId: number; periodKey: string; author: string; body: string; updatedAt: Date }
    >();
    for (const narratives of listQueries.map(q => q.data ?? [])) {
      for (const entry of narratives) {
        if (entry.periodKey && SUPERVISOR_PERIODS.some(p => p.key === entry.periodKey)) {
          map.set(`${entry.floorId}:${entry.periodKey}`, entry as never);
        }
      }
    }
    return map;
  }, [listQueries.map(q => q.data)]);

  return (
    <Card className="mt-5 border border-[#1F2A52]/15 bg-[#1F2A52]/[0.03] print:break-inside-avoid">
      <CardHeader className="border-b border-[#D4DFE5]/70 pb-4">
        <CardTitle className="font-display text-base text-[#1F2A52]">Supervisor Narrative Report</CardTitle>
        <p className="text-xs text-[#556680]">
          {canWriteSupervisor
            ? "Supervisor shift handover notes — 7 AM–3 PM, 3 PM–11 PM, and 11 PM–7 AM, with a note per area (SKTI Main, RDU Annex, RDU Main). Write one per area per shift on duty."
            : "Supervisor shift handover notes recorded for this day — supervisors write, everyone else views."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {dialogOpen && (
          <SupervisorNarrativeDialog
            visibleFloors={visibleFloors}
            periodKey={openPeriod!}
            floorId={openFloorId!}
            date={date}
            authorName={openAuthor}
            existing={
              editEntry
                ? { id: editEntry.id, floorId: editEntry.floorId, author: editEntry.author, body: editEntry.body }
                : null
            }
            onOpenChange={open => {
              if (!open) {
                setOpenPeriod(null);
                setOpenFloorId(null);
                setEditEntry(null);
              }
            }}
          />
        )}
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : isError ? (
          <p className="px-3.5 py-3 text-xs text-[#9E1F2B]">
            Supervisor narratives could not be loaded ({String(error?.message ?? "network error")}) — try signing in as staff or refresh the page.
          </p>
        ) : (
          SUPERVISOR_PERIODS.map(period => {
            return (
              <div key={period.key} className="rounded-sm border border-[#D4DFE5] bg-[#FBFCFD]">
                {/* Shift row header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E4EBF0] bg-[#F2F6F9] px-3.5 py-2.5">
                  <p className="font-serif-light text-[13px] font-semibold text-[#1F2A52]">
                    {period.label}
                  </p>
                  {canWriteSupervisor && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 border-[#2E9A9B]/50 text-[#1d6b6c]"
                      onClick={() => {
                        // Default to the first board without an entry for this shift.
                        const target =
                          visibleFloors.find(
                            f => !entriesByBoardPeriod.has(`${f.id}:${period.key}`)
                          ) ?? visibleFloors[0];
                        setOpenPeriod(period.key);
                        setOpenFloorId(target?.id ?? null);
                        setOpenAuthor(staff?.displayName ?? "");
                      }}
                    >
                      Write narrative
                    </Button>
                  )}
                </div>
                {/* Area sub-tables */}
                <div>
                  {visibleFloors.map((f, idx) => {
                    const entry = entriesByBoardPeriod.get(`${f.id}:${period.key}`);
                    return (
                      <div
                        key={f.id}
                        className={idx > 0 ? "border-t border-[#E4EBF0]" : undefined}
                      >
                        {entry ? (
                          <div className="flex items-start justify-between gap-3 px-3.5 py-3">
                            <div>
                              <p className="text-[10px] uppercase tracking-[0.14em] text-[#2E9A9B]">
                                {f.name}
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
                              <div className="flex shrink-0 items-center gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 border-[#2E9A9B]/50 text-[#1d6b6c]"
                                  onClick={() => {
                                    setOpenPeriod(entry.periodKey);
                                    setOpenFloorId(entry.floorId);
                                    setEditEntry({
                                      id: entry.id,
                                      floorId: entry.floorId,
                                      author: entry.author,
                                      body: entry.body,
                                      periodKey: entry.periodKey,
                                    });
                                    setOpenAuthor(entry.author);
                                  }}
                                  title="Edit this narrative"
                                >
                                  <PenLine className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 border-[#D4DFE5] text-[#1F2A52]"
                                  onClick={() => void removeMutation.mutate({ id: entry.id, floorId: f.id })}
                                  title="Delete this narrative"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-[#7684A0]">
                              {f.name}
                            </p>
                            <span className="text-[10px] uppercase tracking-[0.12em] text-[#9E1F2B]/70">No entry</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Popup dialog for writing a supervisor narrative for a shift + area.
 */
function SupervisorNarrativeDialog({
  visibleFloors,
  periodKey,
  floorId,
  date,
  authorName,
  existing,
  onOpenChange,
}: {
  visibleFloors: { id: number; name: string }[];
  periodKey: string;
  floorId: number;
  date: string;
  authorName: string;
  /** Existing entry when editing a saved narrative. */
  existing?: { id: number; floorId: number; author: string; body: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  // Draft auto-save key: a draft survives dialog close, refresh, and device
  // restarts — clearing it only on a successful save.
  const draftKey = useMemo(
    () =>
      `narrative-supervisor-draft:${date}:${periodKey}:${floorId}`,
    [date, periodKey, floorId]
  );
  const [areaId, setAreaId] = useState(() => existing?.floorId ?? floorId);
  const [author, setAuthor] = useState(() => existing?.author ?? authorName);
  const [body, setBody] = useState(() => {
    if (existing) return existing.body;
    try {
      return localStorage.getItem(draftKey) ?? "";
    } catch {
      return "";
    }
  });
  const draftSaved = useRef(false);
  const lastBody = useRef(body);
  useEffect(() => {
    lastBody.current = body;
    // Debounce: write the draft 400ms after the last keystroke so typing
    // doesn't thrash localStorage.
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, body);
        draftSaved.current = true;
      } catch {
        draftSaved.current = false;
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [body, draftKey]);

  const createMutation = trpc.narratives.create.useMutation({
    onSuccess: () => {
      toast.success("Narrative saved");
      void utils.narratives.list.invalidate({ reportDate: date });
    },
    onError: e => toast.error(e.message),
  });
  const updateMutation = trpc.narratives.update.useMutation({
    onSuccess: () => {
      toast.success("Narrative updated");
      void utils.narratives.list.invalidate({ reportDate: date });
    },
    onError: e => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-left font-display text-lg text-[#1F2A52]">
            Supervisor Narrative
          </DialogTitle>
          <DialogDescription className="text-left">
            {SUPERVISOR_PERIODS.find(p => p.key === periodKey)?.label ?? periodKey} ·{" "}
            {visibleFloors.find(f => f.id === areaId)?.name ?? "Area"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <label className="text-[10px] uppercase tracking-[0.14em] text-[#556680]">Area</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {visibleFloors.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setAreaId(f.id)}
                  className={
                    f.id === areaId
                      ? "h-7 rounded-sm border border-[#2E9A9B] bg-[#2E9A9B]/15 px-2.5 text-[11px] font-medium text-[#1d6b6c]"
                      : "h-7 rounded-sm border border-[#D4DFE5] bg-white px-2.5 text-[11px] text-[#556680] hover:border-[#2E9A9B]/50"
                  }
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.14em] text-[#556680]">Your name</label>
            <input
              value={author}
              onChange={e => setAuthor(e.target.value)}
              className="mt-1.5 h-9 w-full rounded-sm border border-[#D4DFE5] bg-white px-2 text-sm text-[#1F2A52] outline-none focus:border-[#2E9A9B]"
              placeholder="e.g., Al John Manalaysay"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.14em] text-[#556680]">Narrative</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={5}
              maxLength={4000}
              className="mt-1.5 w-full resize-y rounded-sm border border-[#D4DFE5] bg-white px-2.5 py-2 text-sm leading-relaxed text-[#1F2A52] outline-none focus:border-[#2E9A9B]"
              placeholder={`Write the supervisor narrative for ${SUPERVISOR_PERIODS.find(p => p.key === periodKey)?.label ?? "this shift"} · ${visibleFloors.find(f => f.id === areaId)?.name ?? "the area"}…`}
            />
          </div>
        </div>
        {body.trim() && !existing && (
          <p className="-mt-1 text-[10px] text-[#7684A0]">
            {draftSaved.current ? "Draft saved — nothing is lost if you close this." : "Draft saving…"}
          </p>
        )}
        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            className="border-[#D4DFE5] text-[#556680]"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-[#2E9A9B] text-white hover:bg-[#278788] disabled:opacity-60"
            disabled={!body.trim() || !author.trim() || createMutation.isPending || updateMutation.isPending}
            onClick={() => {
              if (!body.trim() || !author.trim()) return;
              const onFinish = () => {
                try {
                  localStorage.removeItem(draftKey);
                } catch {
                  // localStorage unavailable — keep the draft key harmless.
                }
                onOpenChange(false);
              };
              if (existing) {
                updateMutation.mutate({ id: existing.id, floorId: existing.floorId, body: body.trim() }, { onSuccess: onFinish });
              } else {
                createMutation.mutate(
                  {
                    floorId: areaId,
                    reportDate: date,
                    periodKey,
                    shiftKey: null,
                    author: author.trim(),
                    body: body.trim(),
                  },
                  { onSuccess: onFinish }
                );
              }
            }}
          >
            {createMutation.isPending || updateMutation.isPending ? "Saving…" : existing ? "Update narrative" : "Save narrative"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    onSuccess: () => {
      toast.success("Narrative saved");
      void utils.narratives.list.invalidate({ floorId, reportDate: date });
    },
    onError: e => toast.error(e.message),
  });
  const updateMutation = trpc.narratives.update.useMutation({
    onSuccess: () => {
      toast.success("Narrative updated");
      void utils.narratives.list.invalidate({ floorId, reportDate: date });
    },
    onError: e => toast.error(e.message),
  });
  const removeMutation = trpc.narratives.remove.useMutation({
    onSuccess: () => {
      toast.success("Narrative removed");
      void utils.narratives.list.invalidate({ floorId, reportDate: date });
    },
    onError: e => toast.error(e.message),
  });

  // Charge nurses write the board narratives; supervisors only view them.
  const canWriteBoard = editable && staff?.role !== "supervisor";

  const [openPeriod, setOpenPeriod] = useState<string | null>(null);
  const [openShift, setOpenShift] = useState<string>("05-13");
  const [openAuthor, setOpenAuthor] = useState(() => staff?.displayName ?? "");
  // Entry being edited in the inline form — updates instead of creating.
  const [editEntry, setEditEntry] = useState<{
    id: number;
    periodKey: string;
    author: string;
    body: string;
  } | null>(null);
  // Draft auto-save: the writer's draft survives form close, refresh, and
  // device restarts; cleared only on a successful save.
  const draftKey = useMemo(
    () => `narrative-board-draft:${floorId}:${date}`,
    [floorId, date]
  );
  const [openBody, setOpenBody] = useState(() => {
    try {
      return localStorage.getItem(draftKey) ?? "";
    } catch {
      return "";
    }
  });
  const draftSaved = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, openBody);
        draftSaved.current = true;
      } catch {
        draftSaved.current = false;
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [openBody, draftKey]);

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
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-[#2E9A9B]/50 text-[#1d6b6c]"
                          onClick={() => {
                            setOpenPeriod(period.key);
                            setEditEntry({ id: entry.id, periodKey: period.key, author: entry.author, body: entry.body });
                            setOpenBody(entry.body);
                            setOpenAuthor(entry.author);
                            setOpenShift(entry.shiftKey ?? "05-13");
                          }}
                          title="Edit this narrative"
                        >
                          <PenLine className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-[#D4DFE5] text-[#1F2A52]"
                          onClick={() => void removeMutation.mutate({ id: entry.id, floorId })}
                          title="Delete this narrative"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
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
                          setEditEntry(null);
                          try {
                            setOpenBody(localStorage.getItem(draftKey) ?? "");
                          } catch {
                            setOpenBody("");
                          }
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
            {openBody.trim() && !editEntry && (
              <p className="mt-1.5 text-[10px] text-[#7684A0]">
                {draftSaved.current ? "Draft saved — nothing is lost if you close this." : "Draft saving…"}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                className="bg-[#2E9A9B] text-white hover:bg-[#1d6b6c]"
                disabled={!openBody.trim() || !openAuthor.trim() || createMutation.isPending || updateMutation.isPending}
                onClick={() => {
                  if (!openBody.trim() || !openAuthor.trim()) return;
                  const onFinish = () => {
                    try {
                      localStorage.removeItem(draftKey);
                    } catch {
                      // localStorage unavailable — leave the draft key harmless.
                    }
                    setOpenPeriod(null);
                    setEditEntry(null);
                  };
                  if (editEntry) {
                    updateMutation.mutate({ id: editEntry.id, floorId, body: openBody.trim() }, { onSuccess: onFinish });
                  } else {
                    createMutation.mutate(
                      {
                        floorId,
                        reportDate: date,
                        periodKey: openPeriod,
                        shiftKey: openShift,
                        author: openAuthor.trim(),
                        body: openBody.trim(),
                      },
                      { onSuccess: onFinish }
                    );
                  }
                }}
              >
                {createMutation.isPending || updateMutation.isPending ? "Saving…" : editEntry ? "Update narrative" : "Save narrative"}
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

/**
 * Narrative Edit History: auditor-only view of every narrative change
 * (create / update / delete), showing who changed it and when.
 */
function NarrativeHistorySection({
  floors,
  date,
}: {
  floors: { id: number; name: string }[] | undefined;
  date: string;
}) {
  const historyQuery = trpc.narratives.history.useQuery(
    { reportDate: date },
    { refetchInterval: 10_000 }
  );

  const floorName = (floorId: number | null) =>
    (floors ?? []).find(f => f.id === floorId)?.name ?? `Floor ${floorId ?? "?"}`;
  const periodLabel = (key: string) =>
    REPORT_PERIODS.find(p => p.key === key)?.label ??
    SUPERVISOR_PERIODS.find(p => p.key === key)?.label ??
    key;

  return (
    <Card className="mt-5 border border-[#1F2A52]/15 bg-[#1F2A52]/[0.03] print:break-inside-avoid">
      <CardHeader className="border-b border-[#D4DFE5]/70 pb-4">
        <CardTitle className="font-display text-base text-[#1F2A52]">Narrative Edit History</CardTitle>
        <p className="text-xs text-[#556680]">
          Audit trail of every narrative that was written, changed, or removed on {dateLabel(date)}. The auditor
          account alone can view this.
        </p>
      </CardHeader>
      <CardContent className="pt-4">
        {historyQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : historyQuery.isError ? (
          <p className="py-3 text-xs text-[#9E1F2B]">
            The edit history could not be loaded ({String(historyQuery.error?.message ?? "network error")}).
          </p>
        ) : !(historyQuery.data ?? []).length ? (
          <p className="py-4 text-center text-xs text-[#7684A0]">
            No narrative changes were recorded for this date.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#D4DFE5] text-left text-[10px] uppercase tracking-[0.12em] text-[#7684A0]">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Area</th>
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3">Change</th>
                  <th className="py-2 pr-3">Made by</th>
                  <th className="py-2">Content</th>
                </tr>
              </thead>
              <tbody>
                {(historyQuery.data ?? []).map(row => (
                  <tr key={row.id} className="border-b border-[#D4DFE5]/60 align-top">
                    <td className="whitespace-nowrap py-2 pr-3 text-[#556680]">
                      {new Date(row.createdAt).toLocaleString([], { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-2 pr-3 font-medium text-[#1F2A52]">{floorName(row.floorId)}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-[#556680]">{periodLabel(row.periodKey)}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={
                          "rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] " +
                          (row.action === "create"
                            ? "bg-[#2E9A9B]/10 text-[#1d6b6c]"
                            : row.action === "update"
                              ? "bg-[#B8860B]/10 text-[#8a6408]"
                              : "bg-[#9E1F2B]/10 text-[#9E1F2B]")
                        }
                      >
                        {row.action}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-[#556680]">
                      {row.actor}
                      {row.actorRole ? ` · ${row.actorRole}` : ""}
                    </td>
                    <td className="max-w-md whitespace-pre-wrap py-2 text-[#556680]">
                      {row.bodySnapshot ?? (row.action === "delete" ? "(narrative removed)" : "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00+08:00`).toLocaleDateString([], {
    timeZone: "Asia/Manila",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
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
