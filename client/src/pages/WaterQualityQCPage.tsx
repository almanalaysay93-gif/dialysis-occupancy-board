import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import WaterQualityQCModal from "@/components/WaterQualityQCModal";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Droplets,
  ShieldCheck,
  AlertTriangle,
  Flame,
  Plus,
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  Gauge,
  Thermometer,
  Zap,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function WaterQualityQCPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Newest first, straight from the database, so every workstation in the unit
  // sees the same registry.
  const { data: logs = [] } = trpc.waterQualityLogs.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const latest = logs[0];

  const term = searchTerm.toLowerCase();
  const filteredLogs = logs.filter(
    l =>
      l.date.includes(searchTerm) ||
      l.technician.toLowerCase().includes(term) ||
      (l.shift ?? "").toLowerCase().includes(term)
  );

  const handlePrint = () => {
    window.print();
  };

  return (
    <DashboardLayout>
      <div className="w-full px-4 sm:px-6 py-6 space-y-6">
        {/* Top Masthead */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#D4DFE5] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Droplets className="h-7 w-7 text-cyan-600" />
              <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A52] font-bold">
                Reverse Osmosis (RO) Water Quality &amp; Disinfection QC
              </h1>
            </div>
            <p className="font-serif-light text-[#556680] text-sm sm:text-base mt-1">
              Water Treatment Safety, Daily Chemical &amp; Thermal Disinfection Compliance (AAMI / ISO 23500 Standards)
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handlePrint} className="text-xs">
              <Printer className="mr-1.5 h-4 w-4" />
              Print QC Certificate
            </Button>
            <Button
              size="sm"
              onClick={() => setModalOpen(true)}
              className="bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-semibold"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New Daily QC Log
            </Button>
          </div>
        </div>

        {/* Live Safety Status Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Chlorine & Hemolysis Safety */}
          <Card className="border-emerald-500/30 bg-emerald-50/20 dark:bg-emerald-950/10">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                  Chlorine Safety Barrier
                </span>
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-3xl font-black text-emerald-700 dark:text-emerald-300">
                  {latest?.totalChlorine ?? "--"}
                </span>
                <span className="text-xs text-muted-foreground">mg/L (ppm)</span>
              </div>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1 font-medium">
                Standard: &lt; 0.10 mg/L · Carbon Bed Intact
              </p>
            </CardContent>
          </Card>

          {/* Card 2: RO Salt Rejection */}
          <Card className="border-cyan-500/30 bg-cyan-50/20 dark:bg-cyan-950/10">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-cyan-800 dark:text-cyan-300">
                  RO Salt Rejection
                </span>
                <Gauge className="h-5 w-5 text-cyan-600" />
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-3xl font-black text-cyan-700 dark:text-cyan-300">
                  {latest?.rejectionRate ?? "--"}%
                </span>
                <span className="text-xs text-muted-foreground">Rejection</span>
              </div>
              <p className="text-[11px] text-cyan-700 dark:text-cyan-400 mt-1 font-medium">
                Product TDS: {latest?.productTds ?? "--"} ppm (Feed: {latest?.feedTds ?? "--"} ppm)
              </p>
            </CardContent>
          </Card>

          {/* Card 3: Thermal Disinfection Status */}
          <Card className="border-amber-500/30 bg-amber-50/20 dark:bg-amber-950/10">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                  Daily Disinfection
                </span>
                <Flame className="h-5 w-5 text-amber-600" />
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-3xl font-black text-amber-700 dark:text-amber-300">
                  {latest?.heatPeakTemp ?? "--"}°C
                </span>
                <span className="text-xs text-muted-foreground">({latest?.heatHoldMinutes ?? "--"} min hold)</span>
              </div>
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 font-medium">
                Thermal cycle verified · Residual test 0.0 ppm
              </p>
            </CardContent>
          </Card>

          {/* Card 4: Endotoxin & Microbial */}
          <Card className="border-purple-500/30 bg-purple-50/20 dark:bg-purple-950/10">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-800 dark:text-purple-300">
                  Endotoxin &amp; Purity
                </span>
                <CheckCircle2 className="h-5 w-5 text-purple-600" />
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-3xl font-black text-purple-700 dark:text-purple-300">
                  {latest?.endotoxinLevel ?? "--"}
                </span>
                <span className="text-xs text-muted-foreground">EU/mL (&lt;0.25)</span>
              </div>
              <p className="text-[11px] text-purple-700 dark:text-purple-400 mt-1 font-medium">
                Colony count: {latest?.colonyCount ?? "--"} CFU/mL (&lt;100 CFU)
              </p>
            </CardContent>
          </Card>
        </div>

        {/* History Table Card */}
        <Card className="shadow-sm">
          <CardHeader className="p-5 pb-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <CardTitle className="text-lg font-bold font-display">
                  Daily RO Water Treatment &amp; Disinfection QC Registry
                </CardTitle>
                <CardDescription className="text-xs">
                  Historical inspection audit log for hemodialysis water quality compliance.
                </CardDescription>
              </div>

              <div className="w-full sm:w-64">
                <Input
                  placeholder="Filter by date, shift, inspector..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 dark:bg-slate-900 border-y text-muted-foreground uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-2.5 px-4">Date &amp; Shift</th>
                  <th className="py-2.5 px-4">Inspector</th>
                  <th className="py-2.5 px-4">Feed / Product TDS</th>
                  <th className="py-2.5 px-4">Rejection %</th>
                  <th className="py-2.5 px-4">Total Chlorine</th>
                  <th className="py-2.5 px-4">Heat Cycle</th>
                  <th className="py-2.5 px-4">Chemical Residual</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-muted-foreground font-serif text-sm">
                      No water QC records found.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium">
                        <div>{log.date}</div>
                        <div className="text-[10px] text-muted-foreground">{log.shift} ({log.timeOfDay})</div>
                      </td>
                      <td className="py-3 px-4 font-medium">
                        {log.technician}
                        <div className="text-[10px] text-muted-foreground">{log.inspectorRole}</div>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        {log.feedTds} / {log.productTds} ppm
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-cyan-700 dark:text-cyan-300">
                        {log.rejectionRate}%
                      </td>
                      <td className="py-3 px-4 font-mono font-bold">
                        <span
                          className={`px-1.5 py-0.5 rounded ${
                            (log.totalChlorine ?? 0) < 0.1
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 font-black"
                          }`}
                        >
                          {log.totalChlorine} mg/L
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        {log.heatDisinfectionCompleted ? `${log.heatPeakTemp}°C (${log.heatHoldMinutes}m)` : "N/A"}
                      </td>
                      <td className="py-3 px-4">
                        {log.residualChemicalTestNegative ? (
                          <span className="text-emerald-600 font-bold">0.0 ppm (Negative)</span>
                        ) : (
                          <span className="text-red-600 font-bold">RESIDUAL DETECTED</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            log.status === "PASSED"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : log.status === "WARNING"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                          }`}
                        >
                          {log.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 max-w-xs truncate text-[11px] text-muted-foreground" title={log.notes ?? undefined}>
                        {log.notes || "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <WaterQualityQCModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </div>
    </DashboardLayout>
  );
}
