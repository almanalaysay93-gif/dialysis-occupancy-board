import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ClipboardList, Dumbbell, Printer, UserRound, Users } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";

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
            <ReportBoardCard board={singleQuery.data} />
          </div>
        )}

        {isMulti && (
          <div className="mt-8 grid gap-5 lg:grid-cols-2 print:grid-cols-1">
            {(floors ?? []).map(f => (
              <ReportBoardSection key={f.id} floorId={f.id} date={date} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
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
            Priority breakdown
          </p>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <BreakdownCell label="Normal" value={board.urgency.normal} color="bg-[#3E8A6A]" />
            <BreakdownCell label="Urgent" value={board.urgency.urgent} color="bg-[#C8A63B]" />
            <BreakdownCell
              label="Very Urgent"
              value={board.urgency.veryUrgent}
              color="bg-[#9E1F2B]"
            />
          </div>
          <p className="mt-2 text-xs text-[#556680]">
            {urgentTotal} urgent or very urgent session{urgentTotal === 1 ? "" : "s"} among{" "}
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
              Waiting list adds
            </p>
            <p className="mt-1 font-display text-lg text-[#1F2A52]">
              {waitingTotal} added{" "}
              <span className="text-sm text-[#7684A0]">
                · {board.waitingAdds.urgent} urgent, {board.waitingAdds.veryUrgent} very urgent
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-[#D4DFE5]/70 pt-3">
          <UserRound className="h-3.5 w-3.5 text-[#2E9A9B]" />
          <p className="text-xs text-[#556680]">
            Total treatment time today: {board.totalTreatmentHours} hours
          </p>
        </div>
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
