import React, { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Dumbbell,
  Filter,
  Layers,
  PauseCircle,
  PieChart as PieChartIcon,
  Printer,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export type MonthlyReportDay = {
  date: string;
  sessionsEnded: number;
  patientsCatered: number;
  machinesUtilized: number;
  totalMachinesOnFloor: number;
  urgency: { normal: number; urgent: number; veryUrgent: number };
  isolation: { clean: number; dirty: number };
  totalTreatmentHours: number;
  waitingAdds: number;
  totalPausedMinutes: number;
};

export type MonthlyBoardReport = {
  floorId: number;
  floorName: string | null;
  month: string;
  days: MonthlyReportDay[];
  totals: {
    sessionsEnded: number;
    peakMachinesUtilized: number;
    totalMachinesOnFloor: number;
    patientsCatered: number;
    urgency: { normal: number; urgent: number; veryUrgent: number };
    isolation: { clean: number; dirty: number };
    totalTreatmentHours: number;
    waitingAdds: { normal: number; urgent: number; veryUrgent: number; total: number };
    totalPausedMinutes: number;
    daysWithActivity: number;
  };
};

interface MonthlySummaryViewProps {
  monthly: MonthlyBoardReport[] | null;
  month: string;
  onMonthChange: (month: string) => void;
  isLoading: boolean;
  onPrint: () => void;
}

const COLORS = {
  navy: "#1F2A52",
  teal: "#2E9A9B",
  tealDark: "#17696A",
  crimson: "#9E1F2B",
  amber: "#D97706",
  cleanGreen: "#10B981",
  dirtyOrange: "#F97316",
  indigo: "#4F46E5",
  gray: "#94A3B8",
};

export default function MonthlySummaryView({
  monthly,
  month,
  onMonthChange,
  isLoading,
  onPrint,
}: MonthlySummaryViewProps) {
  const [selectedFloorId, setSelectedFloorId] = useState<string>("all");
  const [activeChartTab, setActiveChartTab] = useState<"sessions" | "hours" | "casemix">("sessions");

  const monthLabel = useMemo(() => {
    try {
      return new Date(`${month}-15T12:00:00+08:00`).toLocaleDateString([], {
        month: "long",
        year: "numeric",
        timeZone: "Asia/Manila",
      });
    } catch {
      return month;
    }
  }, [month]);

  // Aggregate totals across boards (or for the selected board)
  const stats = useMemo(() => {
    if (!monthly || monthly.length === 0) return null;
    const boards = selectedFloorId === "all" ? monthly : monthly.filter(b => String(b.floorId) === selectedFloorId);
    if (boards.length === 0) return null;

    const totalSessions = boards.reduce((a, b) => a + b.totals.sessionsEnded, 0);
    const totalPatients = boards.reduce((a, b) => a + b.totals.patientsCatered, 0);
    const totalHours = Math.round(boards.reduce((a, b) => a + b.totals.totalTreatmentHours, 0) * 10) / 10;
    const totalFleetMachines = boards.reduce((a, b) => a + b.totals.totalMachinesOnFloor, 0);
    const peakMachines = Math.max(...boards.map(b => b.totals.peakMachinesUtilized), 0);
    const normalCases = boards.reduce((a, b) => a + b.totals.urgency.normal, 0);
    const urgentCases = boards.reduce((a, b) => a + b.totals.urgency.urgent, 0);
    const veryUrgentCases = boards.reduce((a, b) => a + b.totals.urgency.veryUrgent, 0);
    const cleanIso = boards.reduce((a, b) => a + b.totals.isolation.clean, 0);
    const dirtyIso = boards.reduce((a, b) => a + b.totals.isolation.dirty, 0);
    const waitingTotal = boards.reduce((a, b) => a + b.totals.waitingAdds.total, 0);
    const waitingUrgent = boards.reduce((a, b) => a + b.totals.waitingAdds.urgent + b.totals.waitingAdds.veryUrgent, 0);
    const totalPausedMinutes = boards.reduce((a, b) => a + b.totals.totalPausedMinutes, 0);
    const activeDays = Math.max(...boards.map(b => b.totals.daysWithActivity), 0);
    const totalDaysInMonth = boards[0]?.days.length ?? 0;

    return {
      totalSessions,
      totalPatients,
      totalHours,
      totalFleetMachines,
      peakMachines,
      normalCases,
      urgentCases,
      veryUrgentCases,
      totalUrgent: urgentCases + veryUrgentCases,
      cleanIso,
      dirtyIso,
      waitingTotal,
      waitingUrgent,
      totalPausedMinutes,
      activeDays,
      totalDaysInMonth,
    };
  }, [monthly, selectedFloorId]);

  // Daily timeline data for charts
  const dailyChartData = useMemo(() => {
    if (!monthly || monthly.length === 0) return [];
    const boards = selectedFloorId === "all" ? monthly : monthly.filter(b => String(b.floorId) === selectedFloorId);
    if (boards.length === 0) return [];

    const daysCount = boards[0]?.days.length ?? 0;
    const res = [];
    for (let i = 0; i < daysCount; i++) {
      const dateStr = boards[0].days[i]?.date;
      if (!dateStr) continue;
      const d = new Date(`${dateStr}T12:00:00+08:00`);
      const dayNum = d.getDate();
      const shortDay = d.toLocaleDateString([], { weekday: "short", timeZone: "Asia/Manila" });

      let sessions = 0;
      let patients = 0;
      let machines = 0;
      let hours = 0;
      let urgent = 0;
      let veryUrgent = 0;
      let normal = 0;
      let clean = 0;
      let dirty = 0;
      let waiting = 0;
      let pauseMin = 0;

      for (const b of boards) {
        const item = b.days[i];
        if (item) {
          sessions += item.sessionsEnded;
          patients += item.patientsCatered;
          machines += item.machinesUtilized;
          hours += item.totalTreatmentHours;
          urgent += item.urgency.urgent;
          veryUrgent += item.urgency.veryUrgent;
          normal += item.urgency.normal;
          clean += item.isolation.clean;
          dirty += item.isolation.dirty;
          waiting += item.waitingAdds;
          pauseMin += item.totalPausedMinutes;
        }
      }

      res.push({
        date: dateStr,
        day: `${dayNum} ${shortDay}`,
        dayNum,
        sessions,
        patients,
        machines,
        hours: Math.round(hours * 10) / 10,
        urgent,
        veryUrgent,
        normal,
        clean,
        dirty,
        waiting,
        pauseMin,
      });
    }
    return res;
  }, [monthly, selectedFloorId]);

  // Board comparison data
  const boardComparisonData = useMemo(() => {
    if (!monthly) return [];
    return monthly.map(b => ({
      name: b.floorName ?? `Floor ${b.floorId}`,
      sessions: b.totals.sessionsEnded,
      patients: b.totals.patientsCatered,
      hours: b.totals.totalTreatmentHours,
      machines: b.totals.totalMachinesOnFloor,
      peakMachines: b.totals.peakMachinesUtilized,
      urgentCases: b.totals.urgency.urgent + b.totals.urgency.veryUrgent,
      clean: b.totals.isolation.clean,
      dirty: b.totals.isolation.dirty,
      waiting: b.totals.waitingAdds.total,
      pauseHours: Math.round((b.totals.totalPausedMinutes / 60) * 10) / 10,
    }));
  }, [monthly]);

  // Pie chart datasets
  const urgencyPieData = useMemo(() => {
    if (!stats) return [];
    return [
      { name: "Normal / Routine", value: stats.normalCases, color: COLORS.teal },
      { name: "Urgent", value: stats.urgentCases, color: COLORS.amber },
      { name: "Very Urgent", value: stats.veryUrgentCases, color: COLORS.crimson },
    ].filter(d => d.value > 0);
  }, [stats]);

  const isolationPieData = useMemo(() => {
    if (!stats) return [];
    return [
      { name: "Clean (Non-infectious)", value: stats.cleanIso, color: COLORS.cleanGreen },
      { name: "Dirty / Infectious", value: stats.dirtyIso, color: COLORS.dirtyOrange },
    ].filter(d => d.value > 0);
  }, [stats]);

  const formatMin = (min: number) => {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <div className="w-full space-y-6">
      {/* Header Controls & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-sm border border-[#1F2A52]/15 bg-gradient-to-r from-[#1F2A52]/8 via-[#F7F9FB] to-[#2E9A9B]/8 p-4 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-[#1F2A52]" />
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1F2A52]">
              Select Month
            </span>
          </div>
          <input
            type="month"
            value={month}
            onChange={e => onMonthChange(e.target.value)}
            className="h-9 rounded-sm border border-[#D4DFE5] bg-white px-3 text-sm font-medium text-[#1F2A52] shadow-xs outline-none focus:border-[#2E9A9B]"
          />

          <div className="flex items-center gap-2 pl-2">
            <Filter className="h-4 w-4 text-[#7684A0]" />
            <select
              value={selectedFloorId}
              onChange={e => setSelectedFloorId(e.target.value)}
              className="h-9 rounded-sm border border-[#D4DFE5] bg-white px-3 text-sm text-[#1F2A52] shadow-xs outline-none focus:border-[#2E9A9B]"
            >
              <option value="all">All Boards (Institute-Wide Summary)</option>
              {monthly?.map(b => (
                <option key={b.floorId} value={String(b.floorId)}>
                  {b.floorName ?? `Floor ${b.floorId}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Button
          size="sm"
          className="h-9 bg-[#9E1F2B] text-white shadow-xs hover:bg-[#7a1822]"
          onClick={onPrint}
        >
          <Printer className="mr-1.5 h-4 w-4" />
          Print Monthly Report as PDF
        </Button>
      </div>

      {/* Print-Only Top Header */}
      <div className="hidden border-b-2 border-[#9E1F2B] pb-4 print:block">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#7684A0]">
          Southern Philippines Medical Center — SPMCKTI
        </p>
        <h1 className="font-display text-2xl text-[#1F2A52]">
          Monthly Hemodialysis Performance &amp; Occupancy Summary
        </h1>
        <p className="mt-1 text-sm text-[#556680]">
          Period: <span className="font-semibold text-[#1F2A52]">{monthLabel}</span> ·{" "}
          {selectedFloorId === "all" ? "All 5 Dialysis Centers" : monthly?.find(b => String(b.floorId) === selectedFloorId)?.floorName} · Asia/Manila Standard Time
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : !stats ? (
        <Card className="border border-dashed border-[#D4DFE5] bg-[#F7F9FB] p-8 text-center">
          <p className="text-sm text-[#7684A0]">No monthly data found for {monthLabel}.</p>
        </Card>
      ) : (
        <>
          {/* Top Monthly KPI Metric Cards */}
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {/* Card 1: Completed Sessions */}
            <div className="relative overflow-hidden rounded-sm border border-[#1F2A52]/20 bg-[#1F2A52] p-4 text-white shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">
                  Total Sessions
                </span>
                <Dumbbell className="h-4 w-4 text-[#2E9A9B]" />
              </div>
              <p className="mt-2 font-display text-3xl tracking-tight">{stats.totalSessions}</p>
              <div className="mt-2 flex items-center justify-between text-[11px] text-white/70">
                <span>{stats.activeDays} days with activity</span>
                <span>Avg {(stats.totalSessions / (stats.activeDays || 1)).toFixed(1)}/day</span>
              </div>
            </div>

            {/* Card 2: Patients Catered */}
            <div className="relative overflow-hidden rounded-sm border border-[#2E9A9B]/30 bg-gradient-to-br from-[#2E9A9B]/10 to-[#2E9A9B]/5 p-4 text-[#1F2A52] shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#17696A]">
                  Patients Catered
                </span>
                <Users className="h-4 w-4 text-[#17696A]" />
              </div>
              <p className="mt-2 font-display text-3xl tracking-tight text-[#1F2A52]">{stats.totalPatients}</p>
              <div className="mt-2 flex items-center justify-between text-[11px] text-[#556680]">
                <span>Distinct Patients Treated</span>
                <span>{stats.waitingTotal} added to queue</span>
              </div>
            </div>

            {/* Card 3: Treatment Hours Delivered */}
            <div className="relative overflow-hidden rounded-sm border border-[#D4DFE5] bg-white p-4 text-[#1F2A52] shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7684A0]">
                  Treatment Hours
                </span>
                <Clock className="h-4 w-4 text-[#2E9A9B]" />
              </div>
              <p className="mt-2 font-display text-3xl tracking-tight text-[#1F2A52]">
                {stats.totalHours.toLocaleString()} <span className="text-base font-normal text-[#7684A0]">hrs</span>
              </p>
              <div className="mt-2 flex items-center justify-between text-[11px] text-[#556680]">
                <span>Total Fleet: {stats.totalFleetMachines} machines</span>
                <span>Peak {stats.peakMachines} active</span>
              </div>
            </div>

            {/* Card 4: Clinical Triage & Urgency */}
            <div className="relative overflow-hidden rounded-sm border border-[#9E1F2B]/30 bg-gradient-to-br from-[#9E1F2B]/10 to-[#9E1F2B]/5 p-4 text-[#1F2A52] shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9E1F2B]">
                  Urgent / Emergent
                </span>
                <ShieldAlert className="h-4 w-4 text-[#9E1F2B]" />
              </div>
              <p className="mt-2 font-display text-3xl tracking-tight text-[#9E1F2B]">
                {stats.totalUrgent}{" "}
                <span className="text-sm font-normal text-[#556680]">
                  ({stats.totalSessions > 0 ? ((stats.totalUrgent / stats.totalSessions) * 100).toFixed(0) : 0}%)
                </span>
              </p>
              <div className="mt-2 flex items-center justify-between text-[11px] text-[#556680]">
                <span>Urgent: {stats.urgentCases}</span>
                <span>Very Urgent: {stats.veryUrgentCases}</span>
              </div>
            </div>
          </div>

          {/* Secondary Stats Row: Isolation, Queue, Pause Time */}
          <div className="grid gap-3.5 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-sm border border-[#D4DFE5] bg-[#FBFCFD] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-[#10B981]" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7684A0]">
                    Clean vs Dirty Isolation
                  </p>
                  <p className="font-display text-lg text-[#1F2A52]">
                    {stats.cleanIso} Clean <span className="text-[#7684A0]">/</span> {stats.dirtyIso} Infectious
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-[#10B981]/15 px-2 py-0.5 text-xs font-semibold text-[#059669]">
                {stats.totalSessions > 0 ? ((stats.cleanIso / stats.totalSessions) * 100).toFixed(0) : 100}% clean
              </span>
            </div>

            <div className="flex items-center justify-between rounded-sm border border-[#D4DFE5] bg-[#FBFCFD] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <Users className="h-4 w-4 text-[#4F46E5]" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7684A0]">
                    Waiting List Influx
                  </p>
                  <p className="font-display text-lg text-[#1F2A52]">
                    {stats.waitingTotal} Patients Added
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-[#4F46E5]/15 px-2 py-0.5 text-xs font-semibold text-[#4F46E5]">
                {stats.waitingUrgent} urgent queue
              </span>
            </div>

            <div className="flex items-center justify-between rounded-sm border border-[#D4DFE5] bg-[#FBFCFD] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <PauseCircle className="h-4 w-4 text-[#D97706]" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7684A0]">
                    Machine Pause / Idle Time
                  </p>
                  <p className="font-display text-lg text-[#1F2A52]">
                    {formatMin(stats.totalPausedMinutes)}
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-[#D97706]/15 px-2 py-0.5 text-xs font-semibold text-[#B45309]">
                {(stats.totalPausedMinutes / (stats.activeDays || 1)).toFixed(0)}m / active day
              </span>
            </div>
          </div>

          {/* Interactive Visual Charts Section */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Main Daily Timeline Trend Chart (Span 2 cols) */}
            <Card className="rounded-sm border border-[#D4DFE5] bg-white shadow-xs lg:col-span-2">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-[#E4EBF0] bg-[#F7F9FB] px-4 py-3">
                <div>
                  <CardTitle className="font-display text-base text-[#1F2A52]">
                    Daily Activity &amp; Operational Throughput Trend
                  </CardTitle>
                  <CardDescription className="text-xs text-[#7684A0]">
                    Daily completed dialysis sessions, distinct patients, and treatment hours for {monthLabel}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-1 rounded-sm border border-[#D4DFE5] bg-white p-0.5 text-xs print:hidden">
                  <button
                    onClick={() => setActiveChartTab("sessions")}
                    className={`rounded-xs px-2.5 py-1 font-medium transition-colors ${
                      activeChartTab === "sessions"
                        ? "bg-[#1F2A52] text-white"
                        : "text-[#556680] hover:bg-[#F2F6F9]"
                    }`}
                  >
                    Sessions &amp; Patients
                  </button>
                  <button
                    onClick={() => setActiveChartTab("hours")}
                    className={`rounded-xs px-2.5 py-1 font-medium transition-colors ${
                      activeChartTab === "hours"
                        ? "bg-[#1F2A52] text-white"
                        : "text-[#556680] hover:bg-[#F2F6F9]"
                    }`}
                  >
                    Hours &amp; Fleet
                  </button>
                  <button
                    onClick={() => setActiveChartTab("casemix")}
                    className={`rounded-xs px-2.5 py-1 font-medium transition-colors ${
                      activeChartTab === "casemix"
                        ? "bg-[#1F2A52] text-white"
                        : "text-[#556680] hover:bg-[#F2F6F9]"
                    }`}
                  >
                    Urgency Mix
                  </button>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    {activeChartTab === "sessions" ? (
                      <AreaChart data={dailyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="sessionsGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COLORS.navy} stopOpacity={0.4} />
                            <stop offset="95%" stopColor={COLORS.navy} stopOpacity={0.0} />
                          </linearGradient>
                          <linearGradient id="patientsGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COLORS.teal} stopOpacity={0.4} />
                            <stop offset="95%" stopColor={COLORS.teal} stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                        <XAxis dataKey="dayNum" tickLine={false} tick={{ fontSize: 11, fill: "#6B7280" }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6B7280" }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#1F2A52",
                            borderColor: "#1F2A52",
                            borderRadius: "4px",
                            color: "#fff",
                            fontSize: "12px",
                          }}
                          labelFormatter={(label, payload) => payload?.[0]?.payload?.date ?? label}
                        />
                        <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                        <Area
                          type="monotone"
                          dataKey="sessions"
                          name="Completed Sessions"
                          stroke={COLORS.navy}
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#sessionsGrad)"
                        />
                        <Area
                          type="monotone"
                          dataKey="patients"
                          name="Patients Treated"
                          stroke={COLORS.teal}
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#patientsGrad)"
                        />
                      </AreaChart>
                    ) : activeChartTab === "hours" ? (
                      <BarChart data={dailyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                        <XAxis dataKey="dayNum" tickLine={false} tick={{ fontSize: 11, fill: "#6B7280" }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6B7280" }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#1F2A52",
                            borderColor: "#1F2A52",
                            borderRadius: "4px",
                            color: "#fff",
                            fontSize: "12px",
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                        <Bar dataKey="hours" name="Treatment Hours (hrs)" fill={COLORS.teal} radius={[2, 2, 0, 0]} />
                        <Bar dataKey="machines" name="Active Machines" fill={COLORS.indigo} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    ) : (
                      <BarChart data={dailyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                        <XAxis dataKey="dayNum" tickLine={false} tick={{ fontSize: 11, fill: "#6B7280" }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6B7280" }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#1F2A52",
                            borderColor: "#1F2A52",
                            borderRadius: "4px",
                            color: "#fff",
                            fontSize: "12px",
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                        <Bar dataKey="normal" name="Normal" stackId="a" fill={COLORS.teal} />
                        <Bar dataKey="urgent" name="Urgent" stackId="a" fill={COLORS.amber} />
                        <Bar dataKey="veryUrgent" name="Very Urgent" stackId="a" fill={COLORS.crimson} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Case-Mix & Isolation Distribution Pie Charts */}
            <Card className="rounded-sm border border-[#D4DFE5] bg-white shadow-xs">
              <CardHeader className="border-b border-[#E4EBF0] bg-[#F7F9FB] px-4 py-3">
                <CardTitle className="font-display text-base text-[#1F2A52]">
                  Clinical Triage &amp; Isolation Mix
                </CardTitle>
                <CardDescription className="text-xs text-[#7684A0]">
                  Proportional breakdown of clinical urgency and barrier isolation tags
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                {/* Urgency Distribution */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1F2A52]">
                    Case Urgency Breakdown
                  </p>
                  <div className="h-32 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={urgencyPieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={28}
                          outerRadius={50}
                          paddingAngle={3}
                        >
                          {urgencyPieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#1F2A52",
                            borderColor: "#1F2A52",
                            borderRadius: "4px",
                            color: "#fff",
                            fontSize: "12px",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-[#556680]">
                    {urgencyPieData.map(item => (
                      <span key={item.name} className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                        {item.name}: <strong className="text-[#1F2A52]">{item.value}</strong>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[#E4EBF0] pt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1F2A52]">
                    Isolation Barrier Mix
                  </p>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-[#059669]">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#10B981]" />
                      Clean: <strong>{stats.cleanIso}</strong>
                    </span>
                    <span className="flex items-center gap-1.5 text-[#C2410C]">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#F97316]" />
                      Infectious / Dirty: <strong>{stats.dirtyIso}</strong>
                    </span>
                  </div>
                  <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[#E5E7EB]">
                    <div
                      className="h-full bg-[#10B981]"
                      style={{
                        width: `${stats.totalSessions > 0 ? (stats.cleanIso / stats.totalSessions) * 100 : 100}%`,
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Cross-Board Comparison Matrix Table (Supervisors / All Boards) */}
          {selectedFloorId === "all" && boardComparisonData.length > 1 && (
            <Card className="rounded-sm border border-[#D4DFE5] bg-white shadow-xs">
              <CardHeader className="border-b border-[#E4EBF0] bg-[#F7F9FB] px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="font-display text-base text-[#1F2A52]">
                      Cross-Center Performance Matrix
                    </CardTitle>
                    <CardDescription className="text-xs text-[#7684A0]">
                      Monthly workload, machine allocation, and clinical acuity comparison across all 5 centers
                    </CardDescription>
                  </div>
                  <span className="rounded-xs border border-[#1F2A52]/20 bg-[#1F2A52]/5 px-2 py-1 text-xs font-semibold text-[#1F2A52]">
                    5 Dialysis Units
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#D4DFE5] bg-[#F2F6F9] text-[#1F2A52]">
                        <th className="px-3.5 py-2.5 font-semibold">Dialysis Unit</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Machines</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Sessions</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Patients</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Peak Used</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Hours</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Urgent</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Isolation (C/D)</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Queue Added</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold">Pause Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E4EBF0] text-[#374151]">
                      {boardComparisonData.map((board, idx) => (
                        <tr key={idx} className="hover:bg-[#F9FAFB]">
                          <td className="px-3.5 py-2.5 font-medium text-[#1F2A52]">{board.name}</td>
                          <td className="px-3 py-2.5 text-right text-[#556680]">{board.machines}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-[#1F2A52]">{board.sessions}</td>
                          <td className="px-3 py-2.5 text-right text-[#556680]">{board.patients}</td>
                          <td className="px-3 py-2.5 text-right text-[#556680]">
                            {board.peakMachines} <span className="text-[10px] text-[#7684A0]">/ {board.machines}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-[#17696A] font-medium">{board.hours} h</td>
                          <td className="px-3 py-2.5 text-right text-[#9E1F2B] font-medium">{board.urgentCases}</td>
                          <td className="px-3 py-2.5 text-right text-[#556680]">
                            {board.clean} / {board.dirty}
                          </td>
                          <td className="px-3 py-2.5 text-right text-[#4F46E5] font-medium">{board.waiting}</td>
                          <td className="px-3.5 py-2.5 text-right text-[#556680]">{board.pauseHours} h</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-[#1F2A52] bg-[#F7F9FB] font-semibold text-[#1F2A52]">
                        <td className="px-3.5 py-2.5">Institute Total</td>
                        <td className="px-3 py-2.5 text-right">{stats.totalFleetMachines}</td>
                        <td className="px-3 py-2.5 text-right">{stats.totalSessions}</td>
                        <td className="px-3 py-2.5 text-right">{stats.totalPatients}</td>
                        <td className="px-3 py-2.5 text-right">{stats.peakMachines}</td>
                        <td className="px-3 py-2.5 text-right text-[#17696A]">{stats.totalHours} h</td>
                        <td className="px-3 py-2.5 text-right text-[#9E1F2B]">{stats.totalUrgent}</td>
                        <td className="px-3 py-2.5 text-right">
                          {stats.cleanIso} / {stats.dirtyIso}
                        </td>
                        <td className="px-3 py-2.5 text-right text-[#4F46E5]">{stats.waitingTotal}</td>
                        <td className="px-3.5 py-2.5 text-right">{formatMin(stats.totalPausedMinutes)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Detailed Day-by-Day Monthly Log Table */}
          <Card className="rounded-sm border border-[#D4DFE5] bg-white shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between border-b border-[#E4EBF0] bg-[#F7F9FB] px-4 py-3">
              <div>
                <CardTitle className="font-display text-base text-[#1F2A52]">
                  Daily Operations Log &amp; Census Breakdown
                </CardTitle>
                <CardDescription className="text-xs text-[#7684A0]">
                  Day-by-day record of sessions, patients, active machines, and treatment hours for {monthLabel}
                </CardDescription>
              </div>
              <span className="text-xs text-[#7684A0]">{dailyChartData.length} Calendar Days</span>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[460px] overflow-y-auto overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[#F2F6F9] shadow-xs">
                    <tr className="border-b border-[#D4DFE5] text-[#1F2A52]">
                      <th className="px-3.5 py-2.5 font-semibold">Date</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Sessions</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Patients</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Machines Used</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Hours</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Normal</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Urgent</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Very Urgent</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Clean / Dirty</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Queue Added</th>
                      <th className="px-3.5 py-2.5 text-right font-semibold">Pause</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4EBF0] text-[#374151]">
                    {dailyChartData.map(day => {
                      const hasActivity = day.sessions > 0;
                      return (
                        <tr
                          key={day.date}
                          className={`hover:bg-[#F9FAFB] ${
                            !hasActivity ? "opacity-50" : ""
                          }`}
                        >
                          <td className="px-3.5 py-2 font-medium text-[#1F2A52]">
                            <span className="font-semibold">{day.day}</span>
                            <span className="ml-1 text-[10px] text-[#7684A0]">({day.date})</span>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-[#1F2A52]">{day.sessions}</td>
                          <td className="px-3 py-2 text-right text-[#556680]">{day.patients}</td>
                          <td className="px-3 py-2 text-right text-[#556680]">{day.machines}</td>
                          <td className="px-3 py-2 text-right text-[#17696A] font-medium">{day.hours} h</td>
                          <td className="px-3 py-2 text-right text-[#556680]">{day.normal}</td>
                          <td className="px-3 py-2 text-right text-[#D97706] font-medium">{day.urgent}</td>
                          <td className="px-3 py-2 text-right text-[#9E1F2B] font-medium">{day.veryUrgent}</td>
                          <td className="px-3 py-2 text-right text-[#556680]">
                            {day.clean} / {day.dirty}
                          </td>
                          <td className="px-3 py-2 text-right text-[#4F46E5] font-medium">{day.waiting}</td>
                          <td className="px-3.5 py-2 text-right text-[#556680]">{formatMin(day.pauseMin)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
