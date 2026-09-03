import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCanWrite } from "@/hooks/useCanWrite";
import { trpc } from "@/lib/trpc";
import { AlarmClock, ArrowRightCircle, Droplets, Plus, Siren, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export type WaitingPriority = "normal" | "urgent" | "veryUrgent";

export type WaitingEntry = {
  id: number;
  patientId: string;
  floorId: number;
  priority: WaitingPriority;
  durationMinutes: number;
  isolationTag: "clean" | "dirty";
  assignedNurse: string | null;
  addedBy: string | null;
  joinedAt: Date;
};

type DurationValue = 180 | 240 | 360 | 480 | "custom";

const PRESETS: DurationValue[] = [180, 240, 360, 480];

/** Treatment length form state, shared by the add and admit forms. */
type DurationDraft = {
  duration: DurationValue;
  customHours: string;
  customMinutes: string;
};

type AdmitDraft = DurationDraft & {
  entry: WaitingEntry;
  isolationTag: "clean" | "dirty";
  urgent: boolean;
  nurse: string;
};

const DEFAULT_DURATION: DurationDraft = {
  duration: 240,
  customHours: "4",
  customMinutes: "0",
};

function effectiveMinutes(d: DurationDraft): number {
  if (d.duration === "custom") {
    return (Number(d.customHours) || 0) * 60 + (Number(d.customMinutes) || 0);
  }
  return d.duration;
}

/** Turn stored minutes back into form state, using a preset when one matches. */
function durationDraftFrom(minutes: number): DurationDraft {
  if ((PRESETS as number[]).includes(minutes)) {
    return { duration: minutes as DurationValue, customHours: "0", customMinutes: "0" };
  }
  return {
    duration: "custom",
    customHours: String(Math.floor(minutes / 60)),
    customMinutes: String(minutes % 60),
  };
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} m`;
  return m > 0 ? `${h} h ${m} m` : `${h} h`;
}

const priorityLabel: Record<WaitingPriority, string> = {
  normal: "Normal",
  urgent: "Urgent",
  veryUrgent: "Very Urgent",
};

const durationButtonLabel: Record<string, string> = {
  "180": "3 h",
  "240": "4 h",
  "360": "6 h",
  "480": "8 h",
  custom: "Custom",
};

/** Preset + custom treatment-length picker. */
function DurationPicker({
  idPrefix,
  draft,
  onChange,
}: {
  idPrefix: string;
  draft: DurationDraft;
  onChange: (next: DurationDraft) => void;
}) {
  const minutes = effectiveMinutes(draft);
  const invalid = draft.duration === "custom" && (minutes < 15 || minutes > 1440);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="smallcaps-detail text-[#7684A0]">Duration</span>
      <div className="flex gap-1">
        {([...PRESETS, "custom"] as DurationValue[]).map(value => (
          <Button
            key={String(value)}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onChange({ ...draft, duration: value })}
            className={`h-9 border-[#D4DFE5] bg-[#F4F7F8] ${
              draft.duration === value
                ? "border-[#1F2A52] text-[#1F2A52]"
                : "text-[#7684A0]"
            }`}
          >
            {durationButtonLabel[String(value)]}
          </Button>
        ))}
      </div>
      {draft.duration === "custom" && (
        <div className="mt-1.5 flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${idPrefix}-hours`} className="smallcaps-detail text-[#7684A0]">
              Hours
            </Label>
            <Input
              id={`${idPrefix}-hours`}
              type="number"
              min={0}
              max={24}
              inputMode="numeric"
              value={draft.customHours}
              onChange={e => onChange({ ...draft, customHours: e.target.value })}
              className="h-9 w-20 border-[#D4DFE5] bg-[#FBFCFD] text-[#1F2A52]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${idPrefix}-minutes`} className="smallcaps-detail text-[#7684A0]">
              Minutes
            </Label>
            <Input
              id={`${idPrefix}-minutes`}
              type="number"
              min={0}
              max={59}
              inputMode="numeric"
              value={draft.customMinutes}
              onChange={e => onChange({ ...draft, customMinutes: e.target.value })}
              className="h-9 w-24 border-[#D4DFE5] bg-[#FBFCFD] text-[#1F2A52]"
            />
          </div>
          <span
            className={`smallcaps-detail ${invalid ? "text-[#9E1F2B]" : "text-[#7684A0]"}`}
          >
            {invalid
              ? "15 min – 24 h required"
              : minutes > 0
                ? formatMinutes(minutes)
                : "enter hours or minutes"}
          </span>
        </div>
      )}
    </div>
  );
}

/** Clean / dirty isolation tag picker. */
function TagPicker({
  value,
  onChange,
}: {
  value: "clean" | "dirty";
  onChange: (tag: "clean" | "dirty") => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="smallcaps-detail text-[#7684A0]">Isolation tag</span>
      <div className="flex gap-1">
        {(["clean", "dirty"] as const).map(tag => (
          <Button
            key={tag}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onChange(tag)}
            className={`h-9 border-[#D4DFE5] bg-[#F4F7F8] capitalize ${
              value === tag
                ? tag === "clean"
                  ? "border-[#3E8A6A] text-[#3E8A6A]"
                  : "border-[#9E1F2B] text-[#9E1F2B]"
                : "text-[#7684A0]"
            }`}
          >
            {tag}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Optional nurse-name field. */
function NurseField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="smallcaps-detail text-[#7684A0]">
        Nurse (optional)
      </Label>
      <Input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        maxLength={64}
        placeholder="e.g. Nurse Ana"
        className="h-9 w-40 border-[#D4DFE5] bg-[#F4F7F8] text-[#1F2A52]"
      />
    </div>
  );
}

/**
 * Per-board patient waiting list. Very-urgent patients are sorted to the top
 * and rendered with a pulsing crimson marker; urgent patients follow; normal
 * patients last (first-come order within each tier).
 *
 * Treatment length, isolation tag and nurse are captured when the patient
 * joins the queue, so admitting them onto a machine only needs a confirmation
 * rather than re-entry of every detail.
 */
export default function WaitingListPanel({ floorId }: { floorId: number }) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: entries, isLoading } = trpc.waiting.list.useQuery(
    { floorId },
    { refetchInterval: 8_000 }
  );
  const { data: vacantCount } = trpc.waiting.vacantCount.useQuery(
    { floorId },
    { refetchInterval: 8_000 }
  );
  const { canWrite } = useCanWrite();

  const [admitDraft, setAdmitDraft] = useState<AdmitDraft | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [priority, setPriority] = useState<WaitingPriority>("normal");
  const [addDuration, setAddDuration] = useState<DurationDraft>(DEFAULT_DURATION);
  const [addTag, setAddTag] = useState<"clean" | "dirty">("clean");
  const [addNurse, setAddNurse] = useState("");

  const addMinutes = effectiveMinutes(addDuration);
  const addInvalid = addMinutes < 15 || addMinutes > 1440;

  const admitMinutes = admitDraft ? effectiveMinutes(admitDraft) : 0;
  const admitInvalid = admitDraft !== null && (admitMinutes < 15 || admitMinutes > 1440);

  const resetAddForm = () => {
    setPatientId("");
    setPriority("normal");
    setAddDuration(DEFAULT_DURATION);
    setAddTag("clean");
    setAddNurse("");
  };

  const addEntry = trpc.waiting.add.useMutation({
    onSuccess: (_, vars) => {
      toast.success(
        vars.priority === "veryUrgent"
          ? `Patient “${vars.patientId.trim()}” added as VERY URGENT`
          : `Patient “${vars.patientId.trim()}” added to the waiting list`
      );
      resetAddForm();
      setAddOpen(false);
      void utils.waiting.list.invalidate({ floorId });
      void utils.waiting.nurseAssignments.invalidate({ floorId });
    },
    onError: e => toast.error(e.message),
  });

  const removeEntry = trpc.waiting.remove.useMutation({
    onSuccess: () => {
      void utils.waiting.list.invalidate({ floorId });
      void utils.waiting.nurseAssignments.invalidate({ floorId });
    },
    onError: e => toast.error(e.message),
  });

  const setPriorityMut = trpc.waiting.setPriority.useMutation({
    onSuccess: (_, vars) => {
      if (vars.priority === "veryUrgent") {
        toast.warning(`Patient marked VERY URGENT — top of the queue`);
      } else {
        toast.success(`Priority updated to ${priorityLabel[vars.priority]}`);
      }
      void utils.waiting.list.invalidate({ floorId });
      void utils.waiting.vacantCount.invalidate({ floorId });
    },
    onError: e => toast.error(e.message),
  });

  const admitMut = trpc.waiting.admit.useMutation({
    onSuccess: res => {
      toast.success(`Patient “${res.patientId}” admitted onto a machine — session started`);
      setAdmitDraft(null);
      void utils.waiting.list.invalidate({ floorId });
      void utils.waiting.vacantCount.invalidate({ floorId });
      void utils.waiting.nurseAssignments.invalidate({ floorId });
      void utils.machines.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const tiers = useMemo(() => {
    const list = (entries ?? []) as WaitingEntry[];
    return {
      veryUrgent: list.filter(e => e.priority === "veryUrgent"),
      urgent: list.filter(e => e.priority === "urgent"),
      normal: list.filter(e => e.priority === "normal"),
    };
  }, [entries]);

  const isAdmitDisabled = !canWrite || (vacantCount ?? 0) <= 0;
  const admitDisabledReason = canWrite && (vacantCount ?? 0) <= 0
    ? "Every machine on this floor is in treatment — no vacant machine to admit onto"
    : null;

  const total = entries?.length ?? 0;

  /** Open the admit form pre-filled with what was captured on the queue. */
  const startAdmit = (entry: WaitingEntry) =>
    setAdmitDraft({
      entry,
      ...durationDraftFrom(entry.durationMinutes),
      isolationTag: entry.isolationTag,
      urgent: entry.priority === "veryUrgent",
      nurse: entry.assignedNurse ?? "",
    });

  return (
    <section className="glass-panel border border-[#1F2A52]/80">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D4DFE5] px-5 py-4">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-[#2E9A9B]" />
          <h2 className="font-display text-2xl text-[#1F2A52]">
            Waiting List
          </h2>
          <span className="smallcaps-detail border border-[#D4DFE5] bg-[#F4F7F8] px-2 py-0.5 text-[#7684A0]">
            {total} patient{total === 1 ? "" : "s"}
          </span>
        </div>
        {canWrite ? (
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            className="bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A]"
          >
            <UserPlus className="mr-1.5 h-4 w-4" />
            Add Patient
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate("/staff-login")}
            className="h-9 border-[#D4DFE5] text-[#1F2A52]"
          >
            Sign in to manage the list
          </Button>
        )}
      </header>

      {/* Add patient inline form */}
      {addOpen && (
        <div className="border-b border-dashed border-[#D4DFE5] px-5 py-4">
          <form
            onSubmit={e => {
              e.preventDefault();
              if (!patientId.trim()) {
                toast.error("Patient identifier is required");
                return;
              }
              if (addInvalid) {
                toast.error("Duration must be between 15 minutes and 24 hours");
                return;
              }
              addEntry.mutate({
                floorId,
                patientId: patientId.trim(),
                priority,
                durationMinutes: addMinutes,
                isolationTag: addTag,
                assignedNurse: addNurse.trim() || null,
              });
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
              <Label htmlFor="wl-patient-id" className="smallcaps-detail">
                Patient Identifier
              </Label>
              <Input
                id="wl-patient-id"
                value={patientId}
                onChange={e => setPatientId(e.target.value)}
                placeholder="e.g. P-4821"
                className="bg-[#F4F7F8] text-[#1F2A52]"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="smallcaps-detail text-[#7684A0]">Priority</span>
              <div className="flex gap-1">
                {(
                  [
                    ["normal", "Normal", ""],
                    ["urgent", "Urgent", "text-[#9E1F2B]"],
                    ["veryUrgent", "Very Urgent", "text-[#9E1F2B] font-semibold"],
                  ] as const
                ).map(([value, label, cls]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setPriority(value as WaitingPriority)}
                    className={`h-9 border-[#D4DFE5] bg-[#F4F7F8] ${
                      priority === value
                        ? value === "normal"
                          ? "border-[#1F2A52] text-[#1F2A52]"
                          : "border-[#9E1F2B] text-[#9E1F2B]"
                        : "text-[#7684A0]"
                    } ${cls}`}
                  >
                    {value === "veryUrgent" && (
                      <Siren className="mr-1 h-3.5 w-3.5" />
                    )}
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <DurationPicker idPrefix="wl-add" draft={addDuration} onChange={setAddDuration} />
            <TagPicker value={addTag} onChange={setAddTag} />
            <NurseField id="wl-add-nurse" value={addNurse} onChange={setAddNurse} />
            <Button
              type="submit"
              size="sm"
              disabled={addEntry.isPending || addInvalid}
              title={addInvalid ? "Set a duration between 15 minutes and 24 hours" : undefined}
              className="bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A]"
            >
              {addEntry.isPending ? "Adding…" : "Add to List"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAddOpen(false)}
              className="h-9 border-[#D4DFE5] text-[#1F2A52]"
            >
              Cancel
            </Button>
          </form>
        </div>
      )}

      {/* Admit form — pre-filled from the queue entry, editable before placing */}
      {admitDraft && (
        <div className="border-b border-dashed border-[#9E1F2B]/40 bg-[#FBFCFD] px-5 py-4">
          <p className="font-serif-light text-lg text-[#1F2A52]">
            Admit <span className="font-semibold">“{admitDraft.entry.patientId}”</span> onto the next vacant machine
          </p>
          <p className="smallcaps-detail mt-1 text-[#7684A0]">
            Prefilled from the waiting list — adjust only if something changed.
          </p>
          <form
            onSubmit={e => {
              e.preventDefault();
              if (admitInvalid) {
                toast.error("Duration must be between 15 minutes and 24 hours");
                return;
              }
              admitMut.mutate({
                entryId: admitDraft.entry.id,
                floorId,
                durationMinutes: admitMinutes,
                isolationTag: admitDraft.isolationTag,
                urgent: admitDraft.urgent,
                assignedNurse: admitDraft.nurse.trim() || null,
              });
            }}
            className="mt-3 flex flex-wrap items-end gap-3"
          >
            <DurationPicker
              idPrefix="wl-admit"
              draft={admitDraft}
              onChange={next => setAdmitDraft({ ...admitDraft, ...next })}
            />
            <NurseField
              id="wl-admit-nurse"
              value={admitDraft.nurse}
              onChange={v => setAdmitDraft({ ...admitDraft, nurse: v })}
            />
            <TagPicker
              value={admitDraft.isolationTag}
              onChange={tag => setAdmitDraft({ ...admitDraft, isolationTag: tag })}
            />
            <Button
              type="submit"
              size="sm"
              disabled={admitMut.isPending || admitInvalid}
              title={admitInvalid ? "Set a duration between 15 minutes and 24 hours" : undefined}
              className="bg-[#9E1F2B] text-[#F4F7F8] hover:bg-[#7E1620]"
            >
              <ArrowRightCircle className="mr-1.5 h-4 w-4" />
              {admitMut.isPending ? "Admitting…" : "Admit Patient"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAdmitDraft(null)}
              className="h-9 border-[#D4DFE5] text-[#1F2A52]"
            >
              Cancel
            </Button>
          </form>
        </div>
      )}

      <div className="flex flex-col divide-y divide-[#D4DFE5]/70">
        {isLoading ? (
          <div className="h-24 animate-pulse bg-[#E8EFF1]" />
        ) : total === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="font-serif-light text-lg italic text-[#7684A0]">
              No patients waiting on this board — the list stays empty until a
              patient is added.
            </p>
          </div>
        ) : (
          <>
            {(["veryUrgent", "urgent", "normal"] as const).flatMap(tier =>
              tiers[tier].map(entry => (
                <WaitingRow
                  key={entry.id}
                  entry={entry}
                  tier={tier}
                  removeEntry={removeEntry}
                  setPriorityMut={setPriorityMut}
                  admitOpen={admitDraft !== null}
                  onAdmit={() => startAdmit(entry)}
                  isAdmitDisabled={isAdmitDisabled}
                  admitDisabledReason={admitDisabledReason}
                  canWrite={canWrite}
                />
              ))
            )}
          </>
        )}
      </div>
    </section>
  );
}

type RowProps = {
  entry: WaitingEntry;
  tier: WaitingPriority;
  removeEntry: ReturnType<typeof trpc.waiting.remove.useMutation>;
  setPriorityMut: ReturnType<typeof trpc.waiting.setPriority.useMutation>;
  admitOpen: boolean;
  onAdmit: () => void;
  isAdmitDisabled: boolean;
  admitDisabledReason: string | null;
  canWrite: boolean;
};

function WaitingRow({
  entry,
  tier,
  removeEntry,
  setPriorityMut,
  admitOpen,
  onAdmit,
  isAdmitDisabled,
  admitDisabledReason,
  canWrite,
}: RowProps) {
  const isVeryUrgent = tier === "veryUrgent";
  const isUrgent = tier === "urgent";

  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-5 py-3 ${
        isVeryUrgent
          ? "bg-[#9E1F2B]/5"
          : isUrgent
            ? "bg-[#9E1F2B]/[0.03]"
            : ""
      }`}
    >
      <span
        className={`flex h-9 w-9 items-center justify-center border ${
          isVeryUrgent
            ? "animate-[waitpulse_1.4s_ease-in-out_infinite] border-[#9E1F2B]/70 bg-[#9E1F2B] text-[#F4F7F8]"
            : isUrgent
              ? "border-[#9E1F2B]/60 bg-[#9E1F2B]/15 text-[#9E1F2B]"
              : "border-[#D4DFE5] bg-[#F4F7F8] text-[#556680]"
        }`}
      >
        {isVeryUrgent ? (
          <Siren className="h-4 w-4" />
        ) : isUrgent ? (
          <AlarmClock className="h-4 w-4" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
      </span>
      <div className="min-w-[160px] flex-1">
        <p
          className={`font-serif-light text-lg ${
            isVeryUrgent || isUrgent ? "text-[#9E1F2B]" : "text-[#1F2A52]"
          } ${isVeryUrgent ? "font-semibold" : ""}`}
        >
          {entry.patientId}
        </p>
        <p className="smallcaps-detail mt-0.5 text-[#7684A0]">
          Added {new Date(entry.joinedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {entry.addedBy ? ` · by ${entry.addedBy}` : ""}
          {entry.assignedNurse ? ` · nurse ${entry.assignedNurse}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="smallcaps-detail border border-[#D4DFE5] px-2 py-0.5 text-[#556680]">
          {formatMinutes(entry.durationMinutes)}
        </span>
        <span
          className={`smallcaps-detail inline-flex items-center gap-1 border px-2 py-0.5 ${
            entry.isolationTag === "dirty"
              ? "border-[#2E9A9B]/50 text-[#1B6E6F]"
              : "border-[#3E8A6A]/50 text-[#3E8A6A]"
          }`}
        >
          <Droplets className="h-3 w-3" />
          {entry.isolationTag}
        </span>
        <span
          className={`smallcaps-detail border px-2 py-0.5 ${
            isVeryUrgent
              ? "border-[#9E1F2B] bg-[#9E1F2B]/10 text-[#9E1F2B]"
              : isUrgent
                ? "border-[#9E1F2B]/60 text-[#9E1F2B]"
                : "border-[#D4DFE5] text-[#7684A0]"
          }`}
        >
          {isVeryUrgent && <Siren className="mr-1 inline h-3 w-3" />}
          {priorityLabel[entry.priority]}
        </span>
        {!canWrite ? null : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={isAdmitDisabled || admitOpen}
              title={admitDisabledReason ?? undefined}
              onClick={onAdmit}
              className="h-10 sm:h-9 px-3.5 border-[#3E8A6A] text-[#3E8A6A] font-medium hover:bg-[#3E8A6A]/10"
            >
              <ArrowRightCircle className="mr-1.5 h-4 w-4" />
              Admit
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-10 sm:h-9 px-3.5 border-[#D4DFE5] text-[#1F2A52] font-medium hover:bg-[#E8EFF1]"
                >
                  Priority
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-44 bg-[#F4F7F8]" align="end">
                <div className="flex flex-col gap-1">
                  {(["normal", "urgent", "veryUrgent"] as WaitingPriority[]).map(p => (
                    <Button
                      key={p}
                      size="sm"
                      variant="outline"
                      disabled={setPriorityMut.isPending || p === entry.priority}
                      onClick={() =>
                        setPriorityMut.mutate({
                          entryId: entry.id,
                          floorId: entry.floorId,
                          priority: p,
                        })
                      }
                      className={`justify-start border-[#D4DFE5] bg-[#FBFCFD] ${
                        p === "veryUrgent" || p === "urgent"
                          ? "text-[#9E1F2B]"
                          : "text-[#1F2A52]"
                      }`}
                    >
                      {p === "veryUrgent" && <Siren className="mr-1.5 h-3.5 w-3.5" />}
                      {p === "urgent" && <AlarmClock className="mr-1.5 h-3.5 w-3.5" />}
                      {priorityLabel[p]}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button
              size="sm"
              variant="outline"
              disabled={removeEntry.isPending}
              onClick={() =>
                removeEntry.mutate({ entryId: entry.id, floorId: entry.floorId })
              }
              className="h-9 border-[#9E1F2B]/50 text-[#9E1F2B] hover:bg-[#9E1F2B]/10"
            >
              Remove
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
