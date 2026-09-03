import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ClipboardCheck,
  Users,
  AlertTriangle,
  HeartPulse,
  Droplets,
  ShieldCheck,
  Printer,
  FileDown,
  CheckCircle2,
  Lock,
  History,
  Activity,
  Stethoscope,
  Plus,
  Trash2,
} from "lucide-react";
import {
  ENDORSEMENT_SHIFTS,
  VASCULAR_ACCESS_TYPES,
  type EndorsementShift,
  type SpecialWatchEntry,
  type VascularAccessType,
} from "@/lib/clinical-record-options";
import { toast } from "sonner";

interface ShiftHandoffPanelProps {
  floorId?: number;
  floorName?: string;
}

export default function ShiftHandoffPanel({
  floorId,
  floorName = "All Floors",
}: ShiftHandoffPanelProps) {
  const { data: staff } = trpc.staff.me.useQuery(undefined, { refetchInterval: 15_000 });
  const { data: machines } = trpc.machines.list.useQuery(undefined, { refetchInterval: 8_000 });
  const { data: floors } = trpc.machines.listFloors.useQuery(undefined, { refetchInterval: 30_000 });

  const activeFloorNum = floorId ?? floors?.[0]?.id ?? 1;
  const { data: waiting } = trpc.waiting.list.useQuery(
    { floorId: activeFloorNum },
    { refetchInterval: 8_000 }
  );

  const todayKey = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" });

  // State for Endorsement Form
  const [shiftDate, setShiftDate] = useState(todayKey);
  const [shiftType, setShiftType] = useState<EndorsementShift>(ENDORSEMENT_SHIFTS[0]);
  const [outgoingNurse, setOutgoingNurse] = useState(staff?.displayName || "Nurse Outgoing, RN");
  const [incomingNurse, setIncomingNurse] = useState("Nurse Incoming, RN");

  // SBAR State
  const [situation, setSituation] = useState(
    "All morning sessions initiated on schedule. 2 patients experienced mild intradialytic hypotension; recovered with saline bolus. Census full with 3 waiting admissions."
  );
  const [background, setBackground] = useState(
    "Unit operating at peak capacity. 18 AV Fistulas, 4 PermCaths. Dialyzer reprocessing completed for 22 units in reuse room. RO Water system completed morning heat cycle (87.5°C)."
  );
  const [assessment, setAssessment] = useState(
    "Patient in HD-04 (P-4821) had Nadir BP 84/52 at 2nd hour; UF goal reduced by 500mL. Patient in HD-12 had calf cramps; relieved by stretching and 100mL saline."
  );
  const [recommendations, setRecommendations] = useState(
    "1. Check post-dialysis standing BP for HD-04.\n2. Collect post-BUN lab for HD-08 at 12:45.\n3. Machine HD-06 flagged for technician preventive maintenance after shift 2."
  );

  // Safety Checklist
  const [checklist, setChecklist] = useState({
    crashCartChecked: true,
    waterQcVerified: true,
    heparinNarcoticsCounted: true,
    dialyzerReprocessingLogged: true,
    isolationBarriersChecked: true,
    biomedicalWorkOrdersLogged: true,
  });

  // Watch Patients
  const [patientWatchList, setPatientWatchList] = useState<SpecialWatchEntry[]>([
    {
      patientId: "P-4821",
      machineLabel: "HD-04",
      note: "Prone to IDH. Dry weight target 58.5kg. Limit UF rate <= 800 mL/hr.",
      accessType: "AVF",
    },
    {
      patientId: "P-3904",
      machineLabel: "HD-12",
      note: "Frequent muscle cramping in 3rd hour. Monitor cramps.",
      accessType: "PermCath",
    },
  ]);

  const [newWatchPatientId, setNewWatchPatientId] = useState("");
  const [newWatchMachine, setNewWatchMachine] = useState("");
  const [newWatchNote, setNewWatchNote] = useState("");
  const [newWatchAccess, setNewWatchAccess] = useState<VascularAccessType>(VASCULAR_ACCESS_TYPES[0]);

  const [showHistory, setShowHistory] = useState(false);

  // Clinical records come from the database, so the handover sheet reads the
  // same events on any workstation in the unit.
  const { data: complications = [] } = trpc.sessionComplications.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const { data: waterQcLogs = [] } = trpc.waterQualityLogs.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const { data: endorsementsHistory = [] } = trpc.shiftEndorsements.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const latestWaterQC = waterQcLogs[0];

  // Compute live census for endorsement
  const census = useMemo(() => {
    const floorMachines = floorId !== undefined
      ? (machines ?? []).filter(m => m.machine.floorId === floorId)
      : machines ?? [];

    let activeTreatments = 0;
    let urgentCases = 0;
    let machinesRepair = 0;

    floorMachines.forEach(m => {
      if (m.session) {
        activeTreatments++;
        if (m.session.urgent) urgentCases++;
      }
      if (m.machine.status === "repair") {
        machinesRepair++;
      }
    });

    return {
      totalPatients: activeTreatments + (waiting?.length ?? 0),
      activeTreatments,
      waitingQueue: waiting?.length ?? 0,
      urgentCases,
      machinesActive: floorMachines.length,
      machinesRepair,
      adverseEventsCount: complications.length,
    };
  }, [machines, waiting, complications, floorId]);

  const handleAddWatchPatient = () => {
    if (!newWatchPatientId || !newWatchMachine) {
      toast.error("Please provide both Patient ID and Machine");
      return;
    }
    setPatientWatchList([
      ...patientWatchList,
      {
        patientId: newWatchPatientId,
        machineLabel: newWatchMachine,
        note: newWatchNote || "High observation required",
        accessType: newWatchAccess,
      },
    ]);
    setNewWatchPatientId("");
    setNewWatchMachine("");
    setNewWatchNote("");
  };

  const handleRemoveWatchPatient = (index: number) => {
    setPatientWatchList(patientWatchList.filter((_, i) => i !== index));
  };

  const utils = trpc.useUtils();
  const saveEndorsement = trpc.shiftEndorsements.create.useMutation({
    onSuccess: (_created, variables) => {
      void utils.shiftEndorsements.list.invalidate();
      toast.success(
        variables.status === "ENDORSED_AND_LOCKED"
          ? `Shift Endorsement successfully locked and signed by ${outgoingNurse}`
          : "Endorsement draft saved"
      );
    },
    onError: error => toast.error(error.message),
  });

  const handleSaveEndorsement = (isLock = true) => {
    // The endorsement column is a single floor. A panel opened on "All Floors"
    // still has to name one, so it files against the floor it is showing.
    saveEndorsement.mutate({
      date: shiftDate,
      shift: shiftType,
      floorId: activeFloorNum,
      floorName: floorName || "All Floors",
      outgoingNurse,
      incomingNurse,
      situation,
      background,
      assessment,
      recommendations,
      censusJson: JSON.stringify(census),
      checklistJson: JSON.stringify(checklist),
      specialWatchJson: JSON.stringify(patientWatchList),
      status: isLock ? "ENDORSED_AND_LOCKED" : "DRAFT",
    });
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="w-full space-y-6">
      {/* Endorsement Header Card */}
      <Card className="border-[#1F2A52]/30 shadow-md overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-[#1F2A52] to-[#2E4A7D] text-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-white/10 backdrop-blur-xs">
                <ClipboardCheck className="h-7 w-7 text-cyan-300" />
              </div>
              <div>
                <CardTitle className="text-xl sm:text-2xl font-display font-bold tracking-tight">
                  Clinical Shift Handoff &amp; Endorsement
                </CardTitle>
                <CardDescription className="text-cyan-100 text-xs sm:text-sm">
                  SPMCKTI Hemodialysis Unit · Standardized <strong>SBAR</strong> Nursing Endorsement Protocol
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowHistory(!showHistory)}
                className="bg-white/10 hover:bg-white/20 text-white border-white/30 text-xs"
              >
                <History className="mr-1.5 h-4 w-4" />
                History ({endorsementsHistory.length})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                className="bg-white/10 hover:bg-white/20 text-white border-white/30 text-xs"
              >
                <Printer className="mr-1.5 h-4 w-4" />
                Print Sheet
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {showHistory && (
            <div className="p-4 rounded-xl border bg-slate-50 dark:bg-slate-900 space-y-2">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <History className="h-4 w-4" /> Filed Endorsements
              </h4>
              {endorsementsHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground">No endorsements filed yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {endorsementsHistory.slice(0, 10).map(item => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg border bg-background text-xs"
                    >
                      <span className="font-mono font-semibold">{item.date}</span>
                      <span>{item.shift}</span>
                      <span className="text-muted-foreground">
                        {item.outgoingNurse} to {item.incomingNurse}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          item.status === "ENDORSED_AND_LOCKED"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Shift Metadata & Live Census Bar */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border text-xs">
            <div>
              <Label className="text-[11px] font-bold text-muted-foreground">Endorsement Date</Label>
              <Input
                type="date"
                value={shiftDate}
                onChange={e => setShiftDate(e.target.value)}
                className="h-8 mt-1 text-xs"
              />
            </div>
            <div>
              <Label className="text-[11px] font-bold text-muted-foreground">Shift Period</Label>
              <select
                value={shiftType}
                onChange={e => setShiftType(e.target.value as EndorsementShift)}
                className="w-full h-8 rounded-md border text-xs px-2 mt-1 bg-background font-medium"
              >
                {ENDORSEMENT_SHIFTS.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-[11px] font-bold text-muted-foreground">Outgoing Charge Nurse</Label>
              <Input
                value={outgoingNurse}
                onChange={e => setOutgoingNurse(e.target.value)}
                placeholder="Outgoing RN"
                className="h-8 mt-1 text-xs"
              />
            </div>
            <div>
              <Label className="text-[11px] font-bold text-muted-foreground">Incoming Charge Nurse</Label>
              <Input
                value={incomingNurse}
                onChange={e => setIncomingNurse(e.target.value)}
                placeholder="Incoming RN"
                className="h-8 mt-1 text-xs"
              />
            </div>
          </div>

          {/* Quick Census Stat Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            <div className="p-3 rounded-lg border bg-blue-50/50 dark:bg-blue-950/20 text-center">
              <span className="text-xl font-bold text-blue-700 dark:text-blue-300 block font-mono">
                {census.activeTreatments}
              </span>
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                Active Treatments
              </span>
            </div>
            <div className="p-3 rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 text-center">
              <span className="text-xl font-bold text-amber-700 dark:text-amber-300 block font-mono">
                {census.waitingQueue}
              </span>
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                Waiting in Lounge
              </span>
            </div>
            <div className="p-3 rounded-lg border bg-red-50/50 dark:bg-red-950/20 text-center">
              <span className="text-xl font-bold text-red-700 dark:text-red-300 block font-mono">
                {census.urgentCases}
              </span>
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                Urgent / Priority
              </span>
            </div>
            <div className="p-3 rounded-lg border bg-emerald-50/50 dark:bg-emerald-950/20 text-center">
              <span className="text-xl font-bold text-emerald-700 dark:text-emerald-300 block font-mono">
                {census.machinesActive}
              </span>
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                Total Bays
              </span>
            </div>
            <div className="p-3 rounded-lg border bg-rose-50/50 dark:bg-rose-950/20 text-center">
              <span className="text-xl font-bold text-rose-700 dark:text-rose-300 block font-mono">
                {census.adverseEventsCount}
              </span>
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                Adverse Events
              </span>
            </div>
            <div className="p-3 rounded-lg border bg-purple-50/50 dark:bg-purple-950/20 text-center">
              <span className="text-xl font-bold text-purple-700 dark:text-purple-300 block font-mono">
                {latestWaterQC?.status ?? "--"}
              </span>
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                RO Water QC
              </span>
            </div>
          </div>

          {/* SBAR Section Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* S - Situation */}
            <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-50/10 space-y-2">
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                <span className="flex h-6 w-6 rounded-full bg-blue-600 text-white items-center justify-center font-bold text-xs">
                  S
                </span>
                <Label className="font-bold text-sm">Situation (Current Floor &amp; Shift Status)</Label>
              </div>
              <Textarea
                value={situation}
                onChange={e => setSituation(e.target.value)}
                rows={3}
                className="text-xs resize-none bg-background"
                placeholder="Summarize the shift's main flow, admissions, turnovers, and urgent issues..."
              />
            </div>

            {/* B - Background */}
            <div className="p-4 rounded-xl border border-teal-500/20 bg-teal-50/10 space-y-2">
              <div className="flex items-center gap-2 text-teal-700 dark:text-teal-400">
                <span className="flex h-6 w-6 rounded-full bg-teal-600 text-white items-center justify-center font-bold text-xs">
                  B
                </span>
                <Label className="font-bold text-sm">Background (Vascular Access, Re-use, RO QC)</Label>
              </div>
              <Textarea
                value={background}
                onChange={e => setBackground(e.target.value)}
                rows={3}
                className="text-xs resize-none bg-background"
                placeholder="Access distribution, dialyzer reuse batches, RO water status, and staffing..."
              />
            </div>

            {/* A - Assessment */}
            <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-50/10 space-y-2">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <span className="flex h-6 w-6 rounded-full bg-amber-600 text-white items-center justify-center font-bold text-xs">
                  A
                </span>
                <Label className="font-bold text-sm">Assessment &amp; Clinical Complications</Label>
              </div>
              <Textarea
                value={assessment}
                onChange={e => setAssessment(e.target.value)}
                rows={3}
                className="text-xs resize-none bg-background"
                placeholder="List patients with IDH, cramping, clotting, fever, or vascular access issues..."
              />
            </div>

            {/* R - Recommendation */}
            <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-50/10 space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <span className="flex h-6 w-6 rounded-full bg-emerald-600 text-white items-center justify-center font-bold text-xs">
                  R
                </span>
                <Label className="font-bold text-sm">Recommendations (Action Items for Incoming Shift)</Label>
              </div>
              <Textarea
                value={recommendations}
                onChange={e => setRecommendations(e.target.value)}
                rows={3}
                className="text-xs resize-none bg-background"
                placeholder="Pending post-dialysis lab draws, physician referrals, machine maintenance tags..."
              />
            </div>
          </div>

          {/* High-Risk Patient Watch List */}
          <div className="p-4 rounded-xl border space-y-3 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-destructive">
                <HeartPulse className="h-5 w-5" />
                <h4 className="font-bold text-sm">Special Patient Watch &amp; Access Vulnerability</h4>
              </div>
              <span className="text-xs text-muted-foreground">
                {patientWatchList.length} Flagged Cases
              </span>
            </div>

            {/* List */}
            <div className="space-y-2">
              {patientWatchList.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 rounded-lg border bg-background text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold px-2 py-0.5 rounded bg-destructive/10 text-destructive">
                      {item.machineLabel}
                    </span>
                    <span className="font-mono font-semibold">{item.patientId}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 font-bold">
                      {item.accessType}
                    </span>
                    <span className="text-muted-foreground">{item.note}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveWatchPatient(idx)}
                    className="p-1 text-slate-400 hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Watch Row */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Input
                placeholder="Patient ID (e.g. P-4821)"
                value={newWatchPatientId}
                onChange={e => setNewWatchPatientId(e.target.value)}
                className="h-8 w-32 text-xs"
              />
              <Input
                placeholder="Bay (e.g. HD-04)"
                value={newWatchMachine}
                onChange={e => setNewWatchMachine(e.target.value)}
                className="h-8 w-28 text-xs"
              />
              <select
                value={newWatchAccess}
                onChange={e => setNewWatchAccess(e.target.value as typeof newWatchAccess)}
                className="h-8 rounded-md border text-xs px-2 bg-background"
              >
                <option value="AVF">AVF (Fistula)</option>
                <option value="AVG">AVG (Graft)</option>
                <option value="PermCath">PermCath</option>
                <option value="Temporary IJ">Temporary IJ</option>
              </select>
              <Input
                placeholder="Clinical precaution / Watch note..."
                value={newWatchNote}
                onChange={e => setNewWatchNote(e.target.value)}
                className="h-8 flex-1 min-w-[200px] text-xs"
              />
              <Button size="sm" variant="outline" onClick={handleAddWatchPatient} className="h-8 text-xs">
                <Plus className="mr-1 h-3.5 w-3.5" /> Add Precaution
              </Button>
            </div>
          </div>

          {/* Clinical Shift Safety Checklist */}
          <div className="p-4 rounded-xl border space-y-3">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
              <h4 className="font-bold text-sm">Mandatory Nursing Shift Handover Checklist</h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 text-xs">
              {[
                { key: "crashCartChecked", label: "Emergency Crash Cart & Defibrillator Verified" },
                { key: "waterQcVerified", label: "RO Water Daily QC & Chlorine Test Verified Safe" },
                { key: "heparinNarcoticsCounted", label: "Heparin & Controlled Medication Physical Count" },
                { key: "dialyzerReprocessingLogged", label: "Reuse Room Dialyzer Volumes Logged" },
                { key: "isolationBarriersChecked", label: "HBsAg / HCV Isolation Perimeter Maintained" },
                { key: "biomedicalWorkOrdersLogged", label: "Machine Preventive Maintenance Orders Filed" },
              ].map(item => {
                const checked = checklist[item.key as keyof typeof checklist];
                return (
                  <label
                    key={item.key}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                      checked
                        ? "bg-emerald-500/10 border-emerald-500 font-semibold text-emerald-900 dark:text-emerald-300"
                        : "bg-background text-muted-foreground"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e =>
                        setChecklist({ ...checklist, [item.key]: e.target.checked })
                      }
                      className="accent-emerald-600 rounded h-4 w-4"
                    />
                    <span>{item.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </CardContent>

        <CardFooter className="bg-slate-50 dark:bg-slate-900 p-4 border-t flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-muted-foreground">
            Endorsement Timestamp: <strong>{new Date().toLocaleString()}</strong>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={saveEndorsement.isPending}
              onClick={() => handleSaveEndorsement(false)}
            >
              Save as Draft
            </Button>
            <Button
              size="sm"
              disabled={saveEndorsement.isPending}
              onClick={() => handleSaveEndorsement(true)}
              className="bg-[#1F2A52] text-white hover:bg-[#151D3A]"
            >
              <Lock className="mr-1.5 h-4 w-4" />
              {saveEndorsement.isPending ? "Saving..." : "Sign & Lock Shift Endorsement"}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
