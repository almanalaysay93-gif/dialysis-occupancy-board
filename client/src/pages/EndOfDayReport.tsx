import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { BarChart3, ClipboardList, Dumbbell, FileDown, Filter, PenLine, Printer, Trash2, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import MonthlySummaryView from "@/components/MonthlySummaryView";
import { MachineMetricsExportDialog } from "@/components/MachineMetricsExportDialog";
import { ScrollReveal } from "@/components/ScrollReveal";
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
import { NarrativeReport, REPORT_PERIODS, REPORT_SHIFTS } from "@/components/NarrativeReport";

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
  sessions: {
    patientId: string;
    machineLabel: string;
    durationMinutes: number;
    startedAt: Date;
    endedAt: Date;
    urgent: boolean;
    isolationTag: string;
    nurse: string | null;
  }[];
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

function manilaMonthStr(offsetMonths: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
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
  board,
}: {
  floorId: number;
  date: string;
  /** Pre-fetched per-floor summary (supervisor bulk call). Skips its own query. */
  board?: ReportBoard | null;
}) {
  const { data, isLoading, error, refetch } = trpc.endOfDay.summary.useQuery(
    { date, floorId },
    { refetchInterval: false, enabled: board === undefined }
  );
  const resolved = board ?? data;
  if (!resolved && isLoading) return <Skeleton className="h-72" />;
  if (error) {
    return (
      <Card className="glass-panel border-[#9E1F2B]/40 bg-[#FBF5F5]/80">
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
  if (!resolved) return <Skeleton className="h-72" />;
  return <ReportBoardCard board={resolved} />;
}

/**
 * End of Day report: per-board summary of machines utilized, patients catered,
 * urgency breakdown, isolation tags and same-day waiting-list additions.
 * Printable via the browser's print dialog.
 */
export default function EndOfDayReport() {
  const [date, setDate] = useState(() => localDateStr(0));
  const [month, setMonth] = useState(() => manilaMonthStr(0));
  // Shift filter for narrative tables (server-side period-overlap filter).
  const [shiftKey, setShiftKey] = useState<string>("all");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  // Staff session scoping: the summary query already restricts nurses to
  // their own board. Supervisors see every board — one call
  // (endOfDay.reportPage) returns the staff session, all floors' summaries,
  // narratives, machine metrics and the end-of-month aggregate in a SINGLE
  // HTTP request. The production path pays a fixed ~3s overhead per request
  // (serverless cold path + network), so collapsing 4-5 requests into one
  // roughly halves the perceived page load time. Nurses (one board) and
  // guests use the single unscoped query as before.
  const staffMe = trpc.staff.me.useQuery(undefined, { retry: false });
  const staff = staffMe.data ?? null;
  const utils = trpc.useUtils();

  // Nurses (single board) and the read-only staff view keep the original
  // unscoped summary query; supervisors never touch it.
  const singleQuery = trpc.endOfDay.summary.useQuery(
    { date },
    { refetchInterval: false, enabled: staff?.role !== "supervisor" }
  );

  const pageQuery = trpc.endOfDay.reportPage.useQuery(
    { date, month, shiftKey },
    { refetchInterval: 30_000, enabled: staff?.role === "supervisor" }
  );
  const floors = pageQuery.data?.daily.floors;

  // Kick all heavy report queries off the moment the page mounts so their
  // responses are already cached by the time the sections render.
  useEffect(() => {
    void utils.staff.me.prefetch();
    void utils.endOfDay.reportPage.prefetch({ date, month, shiftKey });
    void utils.endOfDay.summary.prefetch({ date });
  }, [utils, date, month, shiftKey]);

  const isMulti = staff?.role === "supervisor";
  const isGuest = staff?.role === "guest";
  const isLoading = isMulti
    ? ((floors ?? []).length === 0 || floors === undefined || pageQuery.isLoading)
    : singleQuery.isLoading;
  const refresh = () => {
    if (isMulti) {
      void utils.endOfDay.reportPage.invalidate({ date, month, shiftKey });
    } else {
      void singleQuery.refetch();
    }
    void utils.machines.listFloors.invalidate();
  };
  const boards: ReportBoard[] = !isMulti && singleQuery.data ? [singleQuery.data] : [];
  const dateLabel = formatDateLabel(new Date(`${date}T12:00:00+08:00`));
  const shiftLabel =
    shiftKey && shiftKey !== "all"
      ? `Filtered by Shift · ${REPORT_SHIFTS.find(s => s.key === shiftKey)?.label ?? shiftKey}`
      : null;
  // The End of Month report is reserved for the supervisor — non-supervisors
  // never call the endpoint and never see its controls.
  const isSupervisor = staff?.role === "supervisor";
  const monthly = isSupervisor ? (pageQuery.data?.monthly ?? null) : null;
  const monthlyLoading = isSupervisor && pageQuery.isLoading;
  // Print-mode toggle: when true, the daily report (and controls) is hidden in
  // the print layout so "Export Month PDF" yields a clean month-only PDF.
  const [printMonthOnly, setPrintMonthOnly] = useState(false);
  const [activeReportTab, setActiveReportTab] = useState<"daily" | "monthly">("daily");
  // Reset printMonthOnly when the browser print / PDF dialog closes
  useEffect(() => {
    const handleAfterPrint = () => setPrintMonthOnly(false);
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  return (
    <DashboardLayout>
      {isGuest ? (
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 border border-dashed border-[#D4DFE5] bg-[#F4F7F8] px-6 py-16 text-center">
          <span className="glass-icon h-12 w-12 p-2.5"><ClipboardList className="h-6 w-6 text-[#7684A0]" /></span>
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
          {/* Report Mode Tabs (Screen Only) */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[#D4DFE5] pb-4 print:hidden">
            <div className="flex items-center gap-1.5 rounded-sm bg-[#E8EFF1] p-1">
              <button
                type="button"
                onClick={() => {
                  setActiveReportTab("daily");
                  setPrintMonthOnly(false);
                }}
                className={`flex items-center gap-2 rounded-xs px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-all ${
                  activeReportTab === "daily"
                    ? "bg-[#1F2A52] text-white shadow-xs"
                    : "text-[#556680] hover:text-[#1F2A52]"
                }`}
              >
                <ClipboardList className="h-4 w-4" />
                Daily Report
              </button>
              {isSupervisor && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveReportTab("monthly");
                    setPrintMonthOnly(false);
                  }}
                  className={`flex items-center gap-2 rounded-xs px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-all ${
                    activeReportTab === "monthly"
                      ? "bg-[#9E1F2B] text-white shadow-xs"
                      : "text-[#556680] hover:text-[#9E1F2B]"
                  }`}
                >
                  <BarChart3 className="h-4 w-4" />
                  Monthly Summary &amp; Analytics
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 border-[#D4DFE5] text-[#1F2A52] hover:bg-[#E8EFF1] gap-1.5"
                onClick={() => setExportDialogOpen(true)}
                aria-label="Export Machine Metrics as Excel"
              >
                <FileDown className="h-4 w-4 text-[#2E9A9B]" />
                Export Metrics (.xlsx)
              </Button>
              {activeReportTab === "daily" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 border-[#D4DFE5] text-[#1F2A52] hover:bg-[#E8EFF1]"
                  onClick={() => {
                    setPrintMonthOnly(false);
                    window.print();
                  }}
                  aria-label="Print Daily Report as PDF"
                >
                  <Printer className="mr-1.5 h-4 w-4 text-[#2E9A9B]" />
                  Print Daily Report as PDF
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-9 bg-[#9E1F2B] text-white hover:bg-[#7a1822]"
                  onClick={() => {
                    setPrintMonthOnly(true);
                    setTimeout(() => window.print(), 50);
                  }}
                  aria-label="Print Monthly Report as PDF"
                >
                  <Printer className="mr-1.5 h-4 w-4" />
                  Print Monthly Report as PDF
                </Button>
              )}
            </div>
          </div>

          {/* Monthly Summary View (Screen & Print) */}
          {(activeReportTab === "monthly" || printMonthOnly) && (
            <div className={printMonthOnly ? "block" : activeReportTab === "monthly" ? "block print:hidden" : "hidden"}>
              <MonthlySummaryView
                monthly={monthly}
                month={month}
                onMonthChange={setMonth}
                isLoading={monthlyLoading}
                onPrint={() => {
                  setPrintMonthOnly(true);
                  setTimeout(() => window.print(), 50);
                }}
              />
            </div>
          )}

          {/* Daily Report View (Screen & Print) */}
          {(activeReportTab === "daily" && !printMonthOnly) && (
            <div className={printMonthOnly ? "hidden" : "block"}>
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
                <div className="flex items-center gap-2 print:screen-only">
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
                    className="h-9 border-[#D4DFE5] text-[#1F2A52] hover:bg-[#E8EFF1]"
                    onClick={() => {
                      setPrintMonthOnly(false);
                      window.print();
                    }}
                    aria-label="Print Daily Report as PDF"
                  >
                    <Printer className="mr-1.5 h-4 w-4 text-[#2E9A9B]" />
                    Print Daily Report as PDF
                  </Button>
                </div>
              </div>

              {isSupervisor && (
                <div className="mt-3 flex flex-wrap items-center gap-3 print:screen-only">
                  <label
                    htmlFor="shift-selector"
                    className="text-xs font-medium uppercase tracking-[0.18em] text-[#7684A0]"
                  >
                    Narrative Shift Filter
                  </label>
                  <select
                    id="shift-selector"
                    value={shiftKey}
                    onChange={e => setShiftKey(e.target.value)}
                    className="h-9 rounded-sm border border-[#D4DFE5] bg-white px-2 text-sm text-[#1F2A52] outline-none focus:border-[#2E9A9B]"
                  >
                    <option value="all">All Shifts</option>
                    {REPORT_SHIFTS.map(s => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-[#556680]">
                    Shows narrative entries whose session/transition window overlaps
                    the selected shift (supervisor shifts included).
                  </span>
                </div>
              )}

              {/* Active shift filter banner */}
              {shiftLabel && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-sm border border-[#2E9A9B]/40 bg-[#2E9A9B]/10 px-3 py-1.5 text-xs font-medium text-[#17696A]">
                  <Filter className="h-3.5 w-3.5" />
                  {shiftLabel}
                </div>
              )}

              {/* Daily report content */}
              <div>
                {isLoading && (
                  <div className="mt-8 grid gap-8 md:grid-cols-2">
                    <Skeleton className="h-72" />
                    <Skeleton className="h-72" />
                  </div>
                )}

                {!isLoading && !isMulti && singleQuery.error && (
                  <Card className="glass-panel mt-8 border-[#9E1F2B]/40 bg-[#FBF5F5]/80">
                    <CardContent className="flex items-center justify-between gap-4 py-5">
                      <p className="text-sm text-[#9E1F2B]">
                        The report could not be loaded: {singleQuery.error.message}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void singleQuery.refetch()}
                      >
                        Retry
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {!isLoading && !isMulti && !singleQuery.data && (
                  <Card className="glass-panel mt-8 border-[#D4DFE5]/70">
                    <CardContent className="flex flex-col items-center gap-3 py-10">
                      <span className="glass-icon h-12 w-12 p-2.5"><Dumbbell className="h-6 w-6 text-[#7684A0]" /></span>
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
                  <ScrollReveal>
                    <div className="mt-8 grid gap-8 lg:grid-cols-2 print:grid-cols-1">
                      <div className="flex flex-col gap-8">
                        <DailySummaryTable boards={[singleQuery.data]} />
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
                  </ScrollReveal>
                )}

                {isMulti && (
                  <ScrollReveal>
                    <div className="mt-8">
                      <DailySummaryTable
                        boards={(floors ?? [])
                          .map(f => pageQuery.data?.daily.summaries[String(f.id)] ?? null)
                          .filter(
                            (b): b is ReportBoard =>
                              b !== null &&
                              "floorName" in b &&
                              "machinesUtilized" in b &&
                              "urgency" in b
                          )}
                      />
                    </div>
                  </ScrollReveal>
                )}

                <ScrollReveal>
                  {isMulti && (
                    <div className="mt-10 grid flex-col gap-10 lg:grid lg:grid-cols-2 print:grid-cols-1">
                      {(floors ?? []).map(f => (
                        <NarrativeSection
                          key={`narrative-${f.id}`}
                          floorId={f.id}
                          floorName={f.name}
                          date={date}
                          staff={staff}
                          entries={pageQuery.data?.daily.narratives[String(f.id)]}
                        />
                      ))}
                    </div>
                  )}
                </ScrollReveal>

                <ScrollReveal>
                  {(floors ?? []).length > 0 && (
                    <div className="mt-10">
                      <SupervisorNarrativeSection
                        floors={floors}
                        date={date}
                        staff={staff}
                        multi={isMulti}
                        floorNarratives={pageQuery.data?.daily.narratives}
                      />
                    </div>
                  )}

                  {staff?.role === "auditor" && (
                    <div className="mt-10">
                      <NarrativeHistorySection floors={floors} date={date} />
                    </div>
                  )}
                </ScrollReveal>
              </div>
            </div>
          )}
        </div>
        </>
      )}
      <MachineMetricsExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        floorId={staff?.assignedFloorId ?? undefined}
        floorName={staff?.assignedFloorId ? undefined : "All Floors"}
      />
    </DashboardLayout>
  );
}

function SupervisorNarrativeSection({
  floors,
  date,
  staff,
  multi,
  floorNarratives,
}: {
  floors: { id: number; name: string }[] | undefined;
  date: string;
  staff: { role: string; displayName?: string } | null;
  /** true for supervisors (sees all boards), false for a nurse (owns one board) */
  multi: boolean;
  /** Bulk-fetched day-wide narratives (supervisor /report call). Skips the per-floor queries. */
  floorNarratives?: Record<string, { id: number; floorId: number; periodKey: string; shiftKey: string | null; author: string; body: string; updatedAt: Date }[]>;
}) {
  const utils = trpc.useUtils();
  // Resolve which boards this viewer can see. A nurse is scoped to their own
  // board (their staff.me only resolves it); a supervisor reads all boards.
  const floorList = (floors ?? []).filter(f => !multi || staff?.role === "supervisor");
  const visibleFloors = multi
    ? floorList
    : floorList.slice(0, 1);

  // One narrative list per visible board (each is a stable per-floor query).
  // When the parent already fetched day-wide narratives (bulkSummary), these
  // are disabled — the entries arrive via the floorNarratives prop instead.
  const listQueries = visibleFloors.map(f =>
    trpc.narratives.list.useQuery(
      { floorId: f.id, reportDate: date },
      { retry: false, enabled: floorNarratives === undefined }
    )
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
    const sources = floorNarratives
      ? Object.values(floorNarratives)
      : listQueries.map(q => q.data ?? []);
    for (const narratives of sources) {
      for (const entry of narratives) {
        if (entry.periodKey && SUPERVISOR_PERIODS.some(p => p.key === entry.periodKey)) {
          map.set(`${entry.floorId}:${entry.periodKey}`, entry as never);
        }
      }
    }
    return map;
  }, [floorNarratives, listQueries.map(q => q.data)]);

  return (
    <Card className="glass-deep print:bg-white print:backdrop-none print:shadow-none print:border print:border-[#D4DFE5] print:break-inside-avoid">
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

/**
 * Unified daily summary: ONE table across all boards with a Totals row.
 * Used by supervisors (all boards) and nurses/guests (their single board).
 * Prints cleanly with the rest of the daily report PDF.
 */
function DailySummaryTable({ boards }: { boards: ReportBoard[] }) {
  const totals = {
    machinesUsed: 0,
    machinesTotal: 0,
    sessionsEnded: 0,
    patientsCatered: 0,
    normal: 0,
    urgent: 0,
    veryUrgent: 0,
    waitingTotal: 0,
    clean: 0,
    dirty: 0,
    treatmentHours: 0,
    pausedMinutes: 0,
  };
  const allFloors = boards.length > 1;
  for (const b of boards) {
    totals.machinesUsed += b.machinesUtilized.used;
    totals.machinesTotal += b.machinesUtilized.total;
    totals.sessionsEnded += b.sessionsEnded;
    totals.patientsCatered += b.patientsCatered;
    totals.normal += b.urgency.normal;
    totals.urgent += b.urgency.urgent;
    totals.veryUrgent += b.urgency.veryUrgent;
    totals.waitingTotal += b.waitingAdds.total;
    totals.clean += b.isolation.clean;
    totals.dirty += b.isolation.dirty;
    totals.treatmentHours += b.totalTreatmentHours;
    totals.pausedMinutes += b.pauseSummary.totalPausedMinutes;
  }
  const utilizationPct =
    totals.machinesTotal > 0 ? Math.round((totals.machinesUsed / totals.machinesTotal) * 100) : 0;

  return (
    <div className="glass-panel print:bg-white print:backdrop-none print:shadow-none print:border print:border-[#D4DFE5] print:break-inside-avoid">
      <div className="border-b border-[#D4DFE5]/70 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-xl text-[#1F2A52]">
            {allFloors ? "All boards" : boards[0]?.floorName ?? "Daily summary"}
          </h3>
          <span className="smallcaps-detail border border-[#D4DFE5] bg-[#F4F7F8] px-2 py-0.5 text-[#7684A0]">
            {boards[0]?.reportDate}
          </span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#E8EFF1]">
          <div
            className="h-full rounded-full bg-[#2E9A9B] transition-all"
            style={{ width: `${utilizationPct}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-[#7684A0]">
          {totals.machinesUsed} of {totals.machinesTotal} machines used today ({utilizationPct}% utilization)
          {totals.pausedMinutes > 0 && ` · ${totals.pausedMinutes} paused minutes across the center`}
        </p>
      </div>
      <div className="overflow-x-auto px-5 py-4">
        <table className="w-full min-w-0 table-fixed print:w-full print:text-[11px] text-sm">
          <colgroup>
            {allFloors && <col className="w-[15%]" />}
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[7%]" />
            <col className="w-[7%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[7%]" />
            <col className="w-[7%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[#7684A0] border-b border-[#D4DFE5]">
              {allFloors && <th className="py-2 pr-3 font-medium whitespace-nowrap print:text-[10px]">Board</th>}
              <th className="px-1 py-2 font-medium text-right">Machines used</th>
              <th className="px-1 py-2 font-medium text-right">Patients</th>
              <th className="px-1 py-2 font-medium text-right">Sessions</th>
              <th className="px-1 py-2 font-medium text-right">Normal</th>
              <th className="px-1 py-2 font-medium text-right">Urgent</th>
              <th className="px-1 py-2 font-medium text-right">V. urgent</th>
              <th className="px-1 py-2 font-medium text-right">Waiting</th>
              <th className="px-1 py-2 font-medium text-right">Clean</th>
              <th className="px-1 py-2 font-medium text-right">Dirty</th>
              <th className="pl-1 py-2 font-medium text-right">Tx time</th>
            </tr>
          </thead>
          <tbody>
            {boards.map(b => (
              <tr key={b.floorName ?? "board"} className="border-b border-[#D4DFE5]/50">
                {allFloors && (
                  <td className="py-2.5 pr-3 font-medium text-[#1F2A52] whitespace-nowrap print:text-[11px]">
                    {b.floorName ?? "—"}
                  </td>
                )}
                <td className="px-1 py-2.5 text-right text-[#1F2A52]">
                  {b.machinesUtilized.used}
                  <span className="text-[#7684A0]">/{b.machinesUtilized.total}</span>
                </td>
                <td className="px-1 py-2.5 text-right text-[#1F2A52]">{b.patientsCatered}</td>
                <td className="px-1 py-2.5 text-right text-[#1F2A52]">{b.sessionsEnded}</td>
                <td className="px-1 py-2.5 text-right text-[#3E8A6A]">{b.urgency.normal}</td>
                <td className="px-1 py-2.5 text-right text-[#C8A63B]">{b.urgency.urgent}</td>
                <td className="px-1 py-2.5 text-right text-[#9E1F2B]">{b.urgency.veryUrgent}</td>
                <td className="px-1 py-2.5 text-right text-[#1F2A52]">{b.waitingAdds.total}</td>
                <td className="px-1 py-2.5 text-right text-[#3E8A6A]">{b.isolation.clean}</td>
                <td className="px-1 py-2.5 text-right text-[#2E9A9B]">{b.isolation.dirty}</td>
                <td className="pl-1 py-2.5 text-right text-[#1F2A52]">
                  {b.totalTreatmentHours} h
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-[#1F2A52]/70">
              {allFloors && (
                <td className="py-2.5 pr-3 font-display text-base font-semibold text-[#1F2A52] whitespace-nowrap">
                  Total
                </td>
              )}
              <td className="px-1 py-2.5 text-right font-display text-base font-semibold text-[#1F2A52] print:text-sm">
                {totals.machinesUsed}
                <span className="text-sm text-[#7684A0] print:text-xs">/{totals.machinesTotal}</span>
              </td>
              <td className="px-1 py-2.5 text-right font-display text-base font-semibold text-[#1F2A52] print:text-sm">
                {totals.patientsCatered}
              </td>
              <td className="px-1 py-2.5 text-right font-display text-base font-semibold text-[#1F2A52] print:text-sm">
                {totals.sessionsEnded}
              </td>
              <td className="px-1 py-2.5 text-right font-display text-base font-semibold text-[#3E8A6A] print:text-sm">
                {totals.normal}
              </td>
              <td className="px-1 py-2.5 text-right font-display text-base font-semibold text-[#C8A63B] print:text-sm">
                {totals.urgent}
              </td>
              <td className="px-1 py-2.5 text-right font-display text-base font-semibold text-[#9E1F2B] print:text-sm">
                {totals.veryUrgent}
              </td>
              <td className="px-1 py-2.5 text-right font-display text-base font-semibold text-[#1F2A52] print:text-sm">
                {totals.waitingTotal}
              </td>
              <td className="px-1 py-2.5 text-right font-display text-base font-semibold text-[#3E8A6A] print:text-sm">
                {totals.clean}
              </td>
              <td className="px-1 py-2.5 text-right font-display text-base font-semibold text-[#2E9A9B] print:text-sm">
                {totals.dirty}
              </td>
              <td className="pl-1 py-2.5 text-right font-display text-base font-semibold text-[#1F2A52] print:text-sm">
                {Math.round(totals.treatmentHours * 10) / 10} h
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
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
    <Card className="glass-panel print:bg-white print:backdrop-none print:shadow-none print:border print:border-[#D4DFE5] print:break-inside-avoid">
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
              <table className="glass-table w-full text-xs">
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
  entries,
}: {
  floorId: number;
  floorName: string;
  date: string;
  staff: { role: string; displayName?: string | null; name?: string } | null;
  /** Pre-fetched narratives for this floor (supervisor bulk call). Skips its own query. */
  entries?: { id: number; periodKey: string; shiftKey: string | null; author: string; body: string; updatedAt: Date }[];
}) {
  return <NarrativeReport floorId={floorId} floorName={floorName} date={date} staff={staff} editable={false} entries={entries} />;
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
    <Card className="glass-deep print:bg-white print:backdrop-none print:shadow-none print:border print:border-[#D4DFE5] print:break-inside-avoid">
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
            <table className="glass-table w-full text-xs">
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


