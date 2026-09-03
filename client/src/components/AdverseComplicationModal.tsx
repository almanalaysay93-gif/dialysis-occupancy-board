import { useState } from "react";
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
  AlertTriangle,
  HeartPulse,
  Droplets,
  Activity,
  Flame,
  CheckCircle2,
  Stethoscope,
  ShieldAlert,
  Zap,
} from "lucide-react";
import type {
  ComplicationOutcome,
  ComplicationSeverity,
  ComplicationType,
} from "@/lib/clinical-record-options";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface AdverseComplicationModalProps {
  open: boolean;
  onClose: () => void;
  machineLabel: string;
  machineId?: number;
  sessionId?: number;
  patientId: string;
  patientDisplayAlias?: string;
  floorId?: number;
  onSuccess?: () => void;
}

const COMMON_COMPLICATIONS = [
  {
    type: "Hypotension (IDH)" as const,
    label: "Intradialytic Hypotension (IDH)",
    desc: "Systolic BP < 90 or drop > 20 mmHg with dizziness/nausea",
    icon: HeartPulse,
    color: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
    defaultInterventions: [
      "Normal Saline 150mL Bolus",
      "UF Rate reduced to 0 mL/hr",
      "Trendelenburg Position",
      "Oxygen via nasal cannula (2-3 L/min)",
    ],
  },
  {
    type: "Muscle Cramps" as const,
    label: "Severe Muscle Cramps",
    desc: "Painful muscle spasms (calves, feet, or abdominal wall)",
    icon: Zap,
    color: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    defaultInterventions: [
      "Local muscle stretch and massage",
      "UF Rate temporarily reduced",
      "Normal Saline 100mL IV bolus",
    ],
  },
  {
    type: "Dialyzer / Line Clotting" as const,
    label: "Dialyzer / Circuit Clotting",
    desc: "Venous chamber dark blood, TMP > 200 mmHg, fiber bundle clotted",
    icon: Droplets,
    color: "border-purple-500/50 bg-purple-500/10 text-purple-700 dark:text-purple-300",
    defaultInterventions: [
      "Checked venous chamber pressure & line kinks",
      "Extra Heparin bolus administered",
      "Attempted saline flush / rinseback",
    ],
  },
  {
    type: "Vascular Access Dysfunction / Infiltration" as const,
    label: "Vascular Access Problem / Infiltration",
    desc: "Hematoma, poor arterial pull (<200 mL/min), venous resistance",
    icon: Activity,
    color: "border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    defaultInterventions: [
      "Needle repositioned / re-cannulated",
      "Applied ice compress on hematoma site",
      "Switched arterial and venous catheter ports",
    ],
  },
  {
    type: "Disequilibrium Syndrome" as const,
    label: "Dialysis Disequilibrium Syndrome (DDS)",
    desc: "Acute headache, restlessness, blurred vision, or vomiting",
    icon: AlertTriangle,
    color: "border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    defaultInterventions: [
      "Slowed Blood Flow Rate (Qb reduced by 30%)",
      "Turned off Ultrafiltration",
      "Notified Nephrologist for IV Mannitol / Hypertonic Dextrose",
    ],
  },
  {
    type: "Pyrogenic / Febrile Reaction" as const,
    label: "Pyrogenic / Febrile Rigor",
    desc: "Shaking chills, rigor, sudden temperature spike during treatment",
    icon: Flame,
    color: "border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    defaultInterventions: [
      "Dialysate temperature decreased to 35.5°C",
      "Vital signs monitored every 15 minutes",
      "Blood cultures taken from access and dialyzer lines",
      "Antipyretic (Paracetamol) administered as per order",
    ],
  },
];

export default function AdverseComplicationModal({
  open,
  onClose,
  machineLabel,
  machineId,
  sessionId,
  patientId,
  patientDisplayAlias,
  floorId,
  onSuccess,
}: AdverseComplicationModalProps) {
  const [selectedType, setSelectedType] = useState<ComplicationType>("Hypotension (IDH)");
  const [severity, setSeverity] = useState<ComplicationSeverity>("Moderate");
  const [preEventBp, setPreEventBp] = useState("130/80");
  const [eventBp, setEventBp] = useState("85/55");
  const [heartRate, setHeartRate] = useState("96");
  const [spo2, setSpo2] = useState("98");
  const [bfr, setBfr] = useState("300");
  const [ufr, setUfr] = useState("800");
  const [treatmentMin, setTreatmentMin] = useState("120");
  const [salineBolus, setSalineBolus] = useState("150");
  const [physician, setPhysician] = useState("Dr. Mendoza (Nephrologist on Duty)");
  const [outcome, setOutcome] = useState<ComplicationOutcome>("Resolved (Session Continued)");
  const [nurseName, setNurseName] = useState("Nurse on Duty, RN");
  const [notes, setNotes] = useState("");

  const [activeInterventions, setActiveInterventions] = useState<string[]>([
    "Normal Saline 150mL Bolus",
    "UF Rate reduced to 0 mL/hr",
    "Trendelenburg Position",
  ]);

  const handleTypeChange = (type: ComplicationType) => {
    setSelectedType(type);
    const found = COMMON_COMPLICATIONS.find(c => c.type === type);
    if (found) {
      setActiveInterventions(found.defaultInterventions);
    }
  };

  const toggleIntervention = (item: string) => {
    if (activeInterventions.includes(item)) {
      setActiveInterventions(activeInterventions.filter(i => i !== item));
    } else {
      setActiveInterventions([...activeInterventions, item]);
    }
  };

  const utils = trpc.useUtils();
  const logComplication = trpc.sessionComplications.create.useMutation({
    onSuccess: () => {
      void utils.sessionComplications.list.invalidate();
      toast.success(`Adverse event (${selectedType}) logged successfully for ${machineLabel}`);
      if (onSuccess) onSuccess();
      onClose();
    },
    onError: error => toast.error(error.message),
  });

  const handleSave = () => {
    if (!patientId) {
      toast.error("Patient ID is required");
      return;
    }
    // The record hangs off the treatment session. Without one there is nothing
    // to attach the event to, and a stray row would never be found again.
    if (!sessionId) {
      toast.error("No active session on this machine. Start a session before logging a complication.");
      return;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" });
    const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

    logComplication.mutate({
      sessionId,
      complicationType: selectedType,
      onsetMinutes: Number(treatmentMin) || 60,
      intervention: activeInterventions.join("; ") || null,
      resolved: outcome === "Resolved (Session Continued)",
      machineLabel,
      machineId: machineId ?? null,
      floorId: floorId ?? null,
      patientId,
      patientDisplayAlias: patientDisplayAlias ?? null,
      date: dateStr,
      timeOfDay: timeStr,
      nurseName: nurseName || "Staff Nurse, RN",
      severity,
      preEventBp,
      eventBp,
      heartRate: Number(heartRate) || 80,
      spo2: Number(spo2) || 98,
      bfr: Number(bfr) || 300,
      ufr: Number(ufr) || 500,
      interventions: activeInterventions,
      salineBolusVolumeMl: Number(salineBolus) || 0,
      physicianNotified: physician,
      outcome,
      notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-6 w-6" />
            <DialogTitle className="text-xl font-display font-bold">
              Clinical Adverse Complication Logger
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Rapid clinical documentation of hemodialysis intradialytic complications for <strong>{machineLabel}</strong> (Patient ID: <strong>{patientId}</strong>)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Machine & Patient Banner */}
          <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-900 border flex flex-wrap items-center justify-between text-xs gap-3">
            <div>
              <span className="text-muted-foreground">Machine:</span>{" "}
              <strong className="font-mono text-sm">{machineLabel}</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Patient:</span>{" "}
              <strong className="font-mono">{patientId}</strong> {patientDisplayAlias && `(${patientDisplayAlias})`}
            </div>
            <div>
              <span className="text-muted-foreground">Time:</span>{" "}
              <strong>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Nurse:</span>{" "}
              <Input
                value={nurseName}
                onChange={e => setNurseName(e.target.value)}
                className="h-7 w-36 inline-block ml-1 text-xs"
              />
            </div>
          </div>

          {/* Quick Select Complication Type */}
          <div>
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 block">
              1. Select Adverse Complication Event
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {COMMON_COMPLICATIONS.map(c => {
                const isSelected = selectedType === c.type;
                const Icon = c.icon;
                return (
                  <button
                    key={c.type}
                    type="button"
                    onClick={() => handleTypeChange(c.type)}
                    className={`p-3 rounded-lg border text-left transition-all flex flex-col justify-between ${
                      isSelected
                        ? "border-destructive bg-destructive/10 ring-2 ring-destructive/30"
                        : "hover:bg-slate-50 dark:hover:bg-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="h-4 w-4 shrink-0 text-destructive" />
                      <span className="font-bold text-xs leading-tight">{c.label}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground line-clamp-2 leading-tight">
                      {c.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Severity & Vital Signs at Event */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl border bg-slate-50/50 dark:bg-slate-900/50">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 block">
                2. Clinical Severity &amp; Timing
              </Label>
              <div className="flex items-center gap-2 mb-3">
                {(["Mild", "Moderate", "Severe / Critical"] as const).map(sev => (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => setSeverity(sev)}
                    className={`flex-1 py-1.5 px-2 rounded text-xs font-bold transition-all ${
                      severity === sev
                        ? sev === "Severe / Critical"
                          ? "bg-red-600 text-white"
                          : "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                        : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <Label className="text-[11px]">Pre-Event Baseline BP</Label>
                  <Input
                    value={preEventBp}
                    onChange={e => setPreEventBp(e.target.value)}
                    placeholder="130/80"
                    className="h-8 font-mono text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-red-600 font-bold">Event Nadir BP</Label>
                  <Input
                    value={eventBp}
                    onChange={e => setEventBp(e.target.value)}
                    placeholder="80/50"
                    className="h-8 font-mono text-xs mt-1 border-red-400 focus-visible:ring-red-400"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Heart Rate (BPM)</Label>
                  <Input
                    value={heartRate}
                    onChange={e => setHeartRate(e.target.value)}
                    placeholder="96"
                    className="h-8 font-mono text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">SpO2 (%)</Label>
                  <Input
                    value={spo2}
                    onChange={e => setSpo2(e.target.value)}
                    placeholder="98"
                    className="h-8 font-mono text-xs mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Dialysis Parameters at Event */}
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 block">
                3. Dialysis Parameters at Event
              </Label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <Label className="text-[11px]">Treatment Elapsed (Min)</Label>
                  <Input
                    value={treatmentMin}
                    onChange={e => setTreatmentMin(e.target.value)}
                    placeholder="120"
                    className="h-8 font-mono text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Saline Bolus Given (mL)</Label>
                  <Input
                    value={salineBolus}
                    onChange={e => setSalineBolus(e.target.value)}
                    placeholder="150"
                    className="h-8 font-mono text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Blood Flow Rate (Qb mL/min)</Label>
                  <Input
                    value={bfr}
                    onChange={e => setBfr(e.target.value)}
                    placeholder="300"
                    className="h-8 font-mono text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Ultrafiltration Rate (mL/hr)</Label>
                  <Input
                    value={ufr}
                    onChange={e => setUfr(e.target.value)}
                    placeholder="800"
                    className="h-8 font-mono text-xs mt-1"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-[11px]">Nephrologist / Physician Notified</Label>
                  <Input
                    value={physician}
                    onChange={e => setPhysician(e.target.value)}
                    placeholder="Dr. Mendoza / ROD"
                    className="h-8 text-xs mt-1"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Interventions Applied */}
          <div>
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 block">
              4. Immediate Nursing Interventions Applied
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                "Normal Saline 150mL Bolus",
                "UF Rate reduced to 0 mL/hr",
                "Patient placed in Trendelenburg position",
                "Oxygen via nasal cannula (2-3 L/min)",
                "Local muscle stretch and massage",
                "Dialysate temperature lowered to 35.5°C",
                "Physician on duty consulted",
                "Blood lines checked for kinks / clotting",
              ].map(intervention => {
                const checked = activeInterventions.includes(intervention);
                return (
                  <label
                    key={intervention}
                    className={`flex items-center gap-2 p-2 rounded-md border text-xs cursor-pointer transition-all ${
                      checked ? "bg-emerald-500/10 border-emerald-500 font-semibold" : "hover:bg-slate-50 dark:hover:bg-slate-900"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleIntervention(intervention)}
                      className="accent-emerald-600 rounded"
                    />
                    <span>{intervention}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Resolution Outcome */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block">
                5. Clinical Outcome
              </Label>
              <select
                value={outcome}
                onChange={e => setOutcome(e.target.value as ComplicationOutcome)}
                className="w-full h-9 rounded-md border text-xs px-3 bg-background"
              >
                <option value="Resolved (Session Continued)">Resolved (Session Continued)</option>
                <option value="UF Target Reduced">UF Target Reduced</option>
                <option value="Session Terminated Early">Session Terminated Early</option>
                <option value="Transferred to ER / Hospital Bed">Transferred to ER / Hospital Bed</option>
              </select>
            </div>
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block">
                Clinical Narrative / Doctor's Orders
              </Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Details of patient response, doctor's prescription changes, or post-event vital signs..."
                rows={2}
                className="text-xs resize-none"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={logComplication.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            {logComplication.isPending ? "Saving..." : "Log Complication Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
