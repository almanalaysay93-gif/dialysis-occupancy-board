import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Droplets,
  ShieldCheck,
  AlertTriangle,
  Flame,
  CheckCircle2,
  FileSpreadsheet,
  Activity,
  Thermometer,
  Gauge,
  Sparkles,
} from "lucide-react";
import {
  DISINFECTION_AGENTS,
  WATER_QC_SHIFTS,
  type DisinfectionAgent,
  type InspectorRole,
  type WaterQcShift,
} from "@/lib/clinical-record-options";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface WaterQualityQCModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function WaterQualityQCModal({
  open,
  onClose,
  onSuccess,
}: WaterQualityQCModalProps) {
  const todayDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" });
  const currentTime = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

  const [date, setDate] = useState(todayDate);
  const [time, setTime] = useState(currentTime);
  const [shift, setShift] = useState<WaterQcShift>(WATER_QC_SHIFTS[0]);
  const [inspectorName, setInspectorName] = useState("Engr. Mark Santos / Staff RN");
  const [inspectorRole, setInspectorRole] = useState<InspectorRole>("Biomedical Tech");

  // Pre-treatment & RO Parameters
  const [feedWaterTds, setFeedWaterTds] = useState("185");
  const [productWaterTds, setProductWaterTds] = useState("3.2");
  const [productConductivity, setProductConductivity] = useState("4.9");
  const [waterHardness, setWaterHardness] = useState("0");
  const [loopFeedPressure, setLoopFeedPressure] = useState("58");
  const [loopReturnPressure, setLoopReturnPressure] = useState("38");
  const [waterTemperature, setWaterTemperature] = useState("23.5");

  // Chlorine & Chloramine (Hemolysis Prevention)
  const [totalChlorine, setTotalChlorine] = useState("0.01");
  const [chloramineBreakthrough, setChloramineBreakthrough] = useState(false);

  // Disinfection
  const [heatCompleted, setHeatCompleted] = useState(true);
  const [heatPeakTemp, setHeatPeakTemp] = useState("87.5");
  const [heatHoldMinutes, setHeatHoldMinutes] = useState("35");
  const [chemicalAgent, setChemicalAgent] = useState<DisinfectionAgent>(DISINFECTION_AGENTS[0]);
  const [residualNegative, setResidualNegative] = useState(true);

  // Microbial & Endotoxin
  const [endotoxin, setEndotoxin] = useState("0.02");
  const [colonyCount, setColonyCount] = useState("3");

  const [notes, setNotes] = useState("");

  // The log belongs to a floor: each floor runs its own RO loop, so a reading
  // with no floor cannot be acted on.
  const { data: floors } = trpc.machines.listFloors.useQuery();
  const [floorId, setFloorId] = useState<number | null>(null);
  const effectiveFloorId = floorId ?? floors?.[0]?.id ?? null;

  const utils = trpc.useUtils();
  const createLog = trpc.waterQualityLogs.create.useMutation({
    onSuccess: () => {
      void utils.waterQualityLogs.list.invalidate();
      toast.success(`RO Water Quality & Disinfection Log saved (${overallStatus})`);
      if (onSuccess) onSuccess();
      onClose();
    },
    onError: error => toast.error(error.message),
  });

  // Rejection Rate Calculation
  const feedNum = Number(feedWaterTds) || 1;
  const prodNum = Number(productWaterTds) || 0;
  const computedRejection = Number(((1 - prodNum / feedNum) * 100).toFixed(1));
  const chlorineNum = Number(totalChlorine) || 0;

  // Determine Pass / Fail Status
  const isChlorineCritical = chlorineNum >= 0.1;
  const isRejectionLow = computedRejection < 95;
  const isConductivityHigh = Number(productConductivity) > 10;
  const isHeatFailed = heatCompleted && (Number(heatPeakTemp) < 85 || Number(heatHoldMinutes) < 30);
  const isChemicalResidualUnsafe = !residualNegative;

  let overallStatus: "PASSED" | "WARNING" | "CRITICAL_FAIL" = "PASSED";
  if (isChlorineCritical || isChemicalResidualUnsafe) {
    overallStatus = "CRITICAL_FAIL";
  } else if (isRejectionLow || isConductivityHigh || isHeatFailed) {
    overallStatus = "WARNING";
  }

  const handleSave = () => {
    if (effectiveFloorId === null) {
      toast.error("Select a floor before saving the QC log.");
      return;
    }
    if (isChlorineCritical) {
      toast.error("CRITICAL SAFETY ALERT: Total Chlorine exceeds 0.1 mg/L! Patient dialysis prohibited until carbon filters cycled.");
    }

    createLog.mutate({
      date,
      floorId: effectiveFloorId,
      technician: inspectorName,
      status: overallStatus,
      timeOfDay: time,
      shift,
      inspectorRole,
      feedTds: Number(feedWaterTds) || 0,
      productTds: Number(productWaterTds) || 0,
      productConductivity: Number(productConductivity) || 0,
      waterHardnessPpm: Number(waterHardness) || 0,
      loopFeedPressure: Number(loopFeedPressure) || 0,
      loopReturnPressure: Number(loopReturnPressure) || 0,
      waterTemperatureC: Number(waterTemperature) || 0,
      totalChlorine: chlorineNum,
      chloramineBreakthrough,
      heatDisinfectionCompleted: heatCompleted,
      heatPeakTemp: Number(heatPeakTemp) || 0,
      heatHoldMinutes: Number(heatHoldMinutes) || 0,
      chemicalAgentUsed: chemicalAgent,
      residualChemicalTestNegative: residualNegative,
      endotoxinLevel: Number(endotoxin) || 0,
      colonyCount: Number(colonyCount) || 0,
      // Legacy narrow columns, kept in step so older readers stay correct.
      tdsIn: Math.round(Number(feedWaterTds) || 0),
      tdsOut: Math.round(Number(productWaterTds) || 0),
      chlorineLevel: String(chlorineNum),
      hardness: String(Number(waterHardness) || 0),
      waterTemp: String(Number(waterTemperature) || 0),
      notes: notes || `RO Water Daily QC verified for ${shift}. Rejection: ${computedRejection}%. Chlorine: ${totalChlorine} mg/L. Safe for treatment.`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 text-cyan-600 dark:text-cyan-400">
            <Droplets className="h-6 w-6" />
            <DialogTitle className="text-xl font-display font-bold">
              Reverse Osmosis (RO) Water Quality &amp; Disinfection QC Log
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Daily Water Treatment System &amp; Disinfection Verification complying with <strong>ISO 23500 &amp; AAMI Hemodialysis Water Standards</strong>
          </DialogDescription>
        </DialogHeader>

        {/* Safety Status Banner */}
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs font-semibold ${
            overallStatus === "PASSED"
              ? "bg-emerald-500/10 border-emerald-500 text-emerald-800 dark:text-emerald-300"
              : overallStatus === "WARNING"
                ? "bg-amber-500/10 border-amber-500 text-amber-800 dark:text-amber-300"
                : "bg-red-500/20 border-red-600 text-red-800 dark:text-red-300 animate-pulse"
          }`}
        >
          <div className="flex items-center gap-2">
            {overallStatus === "PASSED" && <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" />}
            {overallStatus === "WARNING" && <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />}
            {overallStatus === "CRITICAL_FAIL" && <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />}
            <div>
              <span className="font-bold uppercase tracking-wider block">
                QC Status: {overallStatus}
              </span>
              <span className="text-[11px] opacity-90 font-normal">
                {overallStatus === "PASSED" && "All RO membranes, chlorine barrier, and disinfection parameters within safe limits for patient hook-up."}
                {overallStatus === "WARNING" && "One or more parameters outside standard range. Document corrective action."}
                {overallStatus === "CRITICAL_FAIL" && "CRITICAL DANGER: High chlorine or residual chemical detected. Do NOT hook patients!"}
              </span>
            </div>
          </div>

          <div className="text-right">
            <span className="font-mono text-base font-black">
              {computedRejection}%
            </span>
            <span className="text-[10px] block opacity-75 uppercase">Rejection Rate</span>
          </div>
        </div>

        <div className="space-y-5 py-2">
          {/* Metadata & Inspector Sign-off */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 p-3 rounded-lg border bg-slate-50 dark:bg-slate-900 text-xs">
            <div>
              <Label className="text-[11px]">Floor / RO Loop</Label>
              <select
                value={effectiveFloorId ?? ""}
                onChange={e => setFloorId(Number(e.target.value) || null)}
                className="w-full h-8 rounded-md border text-xs px-2 mt-1 bg-background"
              >
                {(floors ?? []).map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-[11px]">Log Date</Label>
              <Input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="h-8 text-xs mt-1"
              />
            </div>
            <div>
              <Label className="text-[11px]">Time</Label>
              <Input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="h-8 text-xs mt-1"
              />
            </div>
            <div>
              <Label className="text-[11px]">Shift</Label>
              <select
                value={shift}
                onChange={e => setShift(e.target.value as WaterQcShift)}
                className="w-full h-8 rounded-md border text-xs px-2 mt-1 bg-background"
              >
                <option value="Morning (05:00-13:00)">Morning (05:00-13:00)</option>
                <option value="Afternoon (13:00-21:00)">Afternoon (13:00-21:00)</option>
                <option value="Night (21:00-05:00)">Night (21:00-05:00)</option>
              </select>
            </div>
            <div>
              <Label className="text-[11px]">Inspector RN / Tech</Label>
              <Input
                value={inspectorName}
                onChange={e => setInspectorName(e.target.value)}
                className="h-8 text-xs mt-1"
              />
            </div>
          </div>

          {/* Section 1: Chemical & Chloramine Safety (Critical for Hemolysis) */}
          <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/5">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400 mb-2">
              <ShieldCheck className="h-4 w-4" />
              <Label className="text-xs font-bold uppercase tracking-wider">
                1. Total Chlorine &amp; Chloramine Safety (Hemolysis Prevention)
              </Label>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              Standard: Must be <strong>&lt; 0.10 mg/L (ppm)</strong>. Test performed before first patient treatment of the day.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <Label className="text-[11px] font-bold">Total Chlorine (mg/L)</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    value={totalChlorine}
                    onChange={e => setTotalChlorine(e.target.value)}
                    placeholder="0.01"
                    className={`h-8 font-mono font-bold ${
                      chlorineNum >= 0.1 ? "border-red-500 text-red-600 bg-red-50" : "border-emerald-500"
                    }`}
                  />
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">Target: &lt;0.10</span>
                </div>
              </div>

              <div>
                <Label className="text-[11px]">Carbon Bed 1 Status</Label>
                <div className="flex items-center gap-2 mt-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!chloramineBreakthrough}
                      onChange={e => setChloramineBreakthrough(!e.target.checked)}
                      className="accent-emerald-600 rounded"
                    />
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Intact (No Breakthrough)</span>
                  </label>
                </div>
              </div>

              <div>
                <Label className="text-[11px]">Water Hardness (ppm / gpg)</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    value={waterHardness}
                    onChange={e => setWaterHardness(e.target.value)}
                    placeholder="0"
                    className="h-8 font-mono"
                  />
                  <span className="text-[10px] text-muted-foreground">Target: &lt;10 ppm</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: RO Performance & Loop Pressures */}
          <div className="p-4 rounded-xl border bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-2 text-cyan-700 dark:text-cyan-400 mb-2">
              <Gauge className="h-4 w-4" />
              <Label className="text-xs font-bold uppercase tracking-wider">
                2. Reverse Osmosis (RO) Physical &amp; Electrical Parameters
              </Label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <Label className="text-[11px]">Feed Water TDS (ppm)</Label>
                <Input
                  value={feedWaterTds}
                  onChange={e => setFeedWaterTds(e.target.value)}
                  placeholder="185"
                  className="h-8 font-mono mt-1"
                />
              </div>
              <div>
                <Label className="text-[11px]">Product Water TDS (ppm)</Label>
                <Input
                  value={productWaterTds}
                  onChange={e => setProductWaterTds(e.target.value)}
                  placeholder="3.2"
                  className="h-8 font-mono mt-1"
                />
              </div>
              <div>
                <Label className="text-[11px]">Conductivity (µS/cm)</Label>
                <Input
                  value={productConductivity}
                  onChange={e => setProductConductivity(e.target.value)}
                  placeholder="4.9"
                  className="h-8 font-mono mt-1"
                />
              </div>
              <div>
                <Label className="text-[11px]">Water Temp (°C)</Label>
                <Input
                  value={waterTemperature}
                  onChange={e => setWaterTemperature(e.target.value)}
                  placeholder="23.5"
                  className="h-8 font-mono mt-1"
                />
              </div>
              <div>
                <Label className="text-[11px]">Loop Feed Pressure (PSI)</Label>
                <Input
                  value={loopFeedPressure}
                  onChange={e => setLoopFeedPressure(e.target.value)}
                  placeholder="58"
                  className="h-8 font-mono mt-1"
                />
              </div>
              <div>
                <Label className="text-[11px]">Loop Return Pressure (PSI)</Label>
                <Input
                  value={loopReturnPressure}
                  onChange={e => setLoopReturnPressure(e.target.value)}
                  placeholder="38"
                  className="h-8 font-mono mt-1"
                />
              </div>
              <div>
                <Label className="text-[11px]">Endotoxin Level (EU/mL)</Label>
                <Input
                  value={endotoxin}
                  onChange={e => setEndotoxin(e.target.value)}
                  placeholder="0.02"
                  className="h-8 font-mono mt-1"
                />
              </div>
              <div>
                <Label className="text-[11px]">Colony Count (CFU/mL)</Label>
                <Input
                  value={colonyCount}
                  onChange={e => setColonyCount(e.target.value)}
                  placeholder="3"
                  className="h-8 font-mono mt-1"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Daily Disinfection Cycles */}
          <div className="p-4 rounded-xl border bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-2">
              <Flame className="h-4 w-4" />
              <Label className="text-xs font-bold uppercase tracking-wider">
                3. Loop &amp; Machine Disinfection Verification
              </Label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={heatCompleted}
                    onChange={e => setHeatCompleted(e.target.checked)}
                    className="accent-emerald-600 rounded"
                  />
                  <span className="text-xs font-bold">Thermal Heat Cycle Run</span>
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <Input
                    value={heatPeakTemp}
                    onChange={e => setHeatPeakTemp(e.target.value)}
                    placeholder="87.5°C"
                    className="h-7 text-xs font-mono"
                  />
                  <Input
                    value={heatHoldMinutes}
                    onChange={e => setHeatHoldMinutes(e.target.value)}
                    placeholder="35 min"
                    className="h-7 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <Label className="text-[11px]">Chemical Disinfection Agent</Label>
                <select
                  value={chemicalAgent}
                  onChange={e => setChemicalAgent(e.target.value as DisinfectionAgent)}
                  className="w-full h-8 rounded-md border text-xs px-2 mt-1 bg-background"
                >
                  <option value="Citrosteril">Citrosteril (Citric Acid)</option>
                  <option value="Peracetic Acid (Renalin)">Peracetic Acid (Renalin)</option>
                  <option value="Sodium Hypochlorite">Sodium Hypochlorite (Bleach)</option>
                  <option value="None (Thermal Only)">None (Thermal Only)</option>
                </select>
              </div>

              <div>
                <Label className="text-[11px]">Residual Chemical Strip Check</Label>
                <label className="flex items-center gap-2 cursor-pointer mt-2">
                  <input
                    type="checkbox"
                    checked={residualNegative}
                    onChange={e => setResidualNegative(e.target.checked)}
                    className="accent-emerald-600 rounded"
                  />
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    Negative (0.0 ppm Verified)
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Corrective Action / Notes */}
          <div>
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block">
              QC Engineer Notes &amp; Observations
            </Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Record any filter replacements, backwash cycles, or biomedical service notes..."
              rows={2}
              className="text-xs resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={createLog.isPending}
            className="bg-cyan-700 text-white hover:bg-cyan-800"
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            {createLog.isPending ? "Saving..." : "Sign & Save Daily QC Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
