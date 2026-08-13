import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { AlarmClock, ArrowRightCircle, Plus, Siren, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export type WaitingPriority = "normal" | "urgent" | "veryUrgent";

export type WaitingEntry = {
  id: number;
  patientId: string;
  floorId: number;
  priority: WaitingPriority;
  addedBy: string | null;
  joinedAt: Date;
};

type AdmitDraft = {
  entry: WaitingEntry;
  durationMinutes: number;
  durationMode: "preset" | "custom";
  customHours: string;
  customMinutes: string;
  isolationTag: "clean" | "dirty";
  urgent: boolean;
};

type DurationValue = 180 | 240 | 360 | 480 | "custom";

function draftEffectiveMinutes(d: AdmitDraft): number {
  if (d.durationMode === "custom") {
    return (Number(d.customHours) || 0) * 60 + (Number(d.customMinutes) || 0);
  }
  return d.durationMinutes;
}

const priorityLabel: Record<WaitingPriority, string> = {
  normal: "Normal",
  urgent: "Urgent",
  veryUrgent: "Very Urgent",
};

/**
 * Per-board patient waiting list. Very-urgent patients are sorted to the top
 * and rendered with a pulsing crimson marker; urgent patients follow; normal
 * patients last (first-come order within each tier).
 */
export default function WaitingListPanel({ floorId }: { floorId: number }) {
  const utils = trpc.useUtils();
  const { data: entries, isLoading } = trpc.waiting.list.useQuery(
    { floorId },
    { refetchInterval: 5_000 }
  );
  const { data: vacantCount } = trpc.waiting.vacantCount.useQuery(
    { floorId },
    { refetchInterval: 5_000 }
  );
  const { isAuthenticated, user } = useAuth();

  const [admitDraft, setAdmitDraft] = useState<AdmitDraft | null>(null);
  const [admitNurse, setAdmitNurse] = useState("");

  const effectiveDurationMinutes = admitDraft
    ? draftEffectiveMinutes(admitDraft)
    : 0;
  const customInvalid =
    admitDraft?.durationMode === "custom" &&
    (effectiveDurationMinutes < 15 || effectiveDurationMinutes > 1440);

  const [addOpen, setAddOpen] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [priority, setPriority] = useState<WaitingPriority>("normal");

  const addEntry = trpc.waiting.add.useMutation({
    onSuccess: (_, vars) => {
      toast.success(
        vars.priority === "veryUrgent"
          ? `Patient “${vars.patientId.trim()}” added as VERY URGENT`
          : `Patient “${vars.patientId.trim()}” added to the waiting list`
      );
      setPatientId("");
      setPriority("normal");
      setAddOpen(false);
      void utils.waiting.list.invalidate({ floorId });
    },
    onError: e => toast.error(e.message),
  });

  const removeEntry = trpc.waiting.remove.useMutation({
    onSuccess: () => void utils.waiting.list.invalidate({ floorId }),
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
      void utils.machines.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const tiers = useMemo(() => {
    const veryUrgent = (entries ?? []).filter(e => e.priority === "veryUrgent");
    const urgent = (entries ?? []).filter(e => e.priority === "urgent");
    const normal = (entries ?? []).filter(e => e.priority === "normal");
    return { veryUrgent, urgent, normal };
  }, [entries]);

  const isAdmitDisabled = !isAuthenticated || (vacantCount ?? 0) <= 0;
  const admitDisabledReason = isAuthenticated && (vacantCount ?? 0) <= 0
    ? "Every machine on this floor is in treatment — no vacant machine to admit onto"
    : null;

  const total = entries?.length ?? 0;

  return (
    <section className="mt-8 border border-[#1F2A52]/80 bg-[#FBFCFD]">
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
        {isAuthenticated ? (
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
            onClick={() => startLogin()}
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
              addEntry.mutate({
                floorId,
                patientId: patientId.trim(),
                priority,
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
            <Button
              type="submit"
              size="sm"
              disabled={addEntry.isPending}
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

      {/* Admit draft form — pick duration/tag/urgent before placing the patient */}
      {admitDraft && (
        <div className="border-b border-dashed border-[#9E1F2B]/40 bg-[#FBFCFD] px-5 py-4">
          <p className="font-serif-light text-lg text-[#1F2A52]">
            Admit <span className="font-semibold">“{admitDraft.entry.patientId}”</span> onto the next vacant machine
          </p>
          <form
            onSubmit={e => {
              e.preventDefault();
              const minutes = draftEffectiveMinutes(admitDraft);
              if (minutes < 15 || minutes > 1440) {
                toast.error("Duration must be between 15 minutes and 24 hours");
                return;
              }
              admitMut.mutate({
                entryId: admitDraft.entry.id,
                floorId,
                durationMinutes: minutes,
                isolationTag: admitDraft.isolationTag,
                urgent: admitDraft.urgent,
                assignedNurse: admitNurse.trim() || null,
              });
            }}
            className="mt-3 flex flex-wrap items-end gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <span className="smallcaps-detail text-[#7684A0]">Duration</span>
              <div className="flex gap-1">
                {([
                  [180, "3 h"],
                  [240, "4 h"],
                  [360, "6 h"],
                  [480, "8 h"],
                  ["custom", "Custom"],
                ] as const).map(([value, label]) => {
                  const isActive =
                    value === "custom"
                      ? admitDraft.durationMode === "custom"
                      : admitDraft.durationMode === "preset" &&
                        admitDraft.durationMinutes === value;
                  return (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setAdmitDraft(
                          value === "custom"
                            ? { ...admitDraft, durationMode: "custom" }
                            : {
                                ...admitDraft,
                                durationMode: "preset",
                                durationMinutes: value,
                              }
                        )
                      }
                      className={`h-9 border-[#D4DFE5] bg-[#F4F7F8] ${
                        isActive
                          ? "border-[#1F2A52] text-[#1F2A52]"
                          : "text-[#7684A0]"
                      }`}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
              {admitDraft.durationMode === "custom" && (
                <div className="mt-1.5 flex items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <Label
                      htmlFor="admit-custom-hours"
                      className="smallcaps-detail text-[#7684A0]"
                    >
                      Hours
                    </Label>
                    <Input
                      id="admit-custom-hours"
                      type="number"
                      min={0}
                      max={24}
                      inputMode="numeric"
                      value={admitDraft.customHours}
                      onChange={e =>
                        setAdmitDraft({
                          ...admitDraft,
                          customHours: e.target.value,
                        })
                      }
                      className="h-9 w-20 border-[#D4DFE5] bg-[#FBFCFD] text-[#1F2A52]"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label
                      htmlFor="admit-custom-minutes"
                      className="smallcaps-detail text-[#7684A0]"
                    >
                      Minutes
                    </Label>
                    <Input
                      id="admit-custom-minutes"
                      type="number"
                      min={0}
                      max={59}
                      inputMode="numeric"
                      value={admitDraft.customMinutes}
                      onChange={e =>
                        setAdmitDraft({
                          ...admitDraft,
                          customMinutes: e.target.value,
                        })
                      }
                      className="h-9 w-24 border-[#D4DFE5] bg-[#FBFCFD] text-[#1F2A52]"
                    />
                  </div>
                  <span
                    className={`smallcaps-detail ${
                      customInvalid ? "text-[#9E1F2B]" : "text-[#7684A0]"
                    }`}
                  >
                    {customInvalid
                      ? "15 min – 24 h required"
                      : effectiveDurationMinutes > 0
                        ? `${Math.floor(effectiveDurationMinutes / 60)} h ${effectiveDurationMinutes % 60} m`
                        : "enter hours or minutes"}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="smallcaps-detail text-[#7684A0]">Nurse (optional)</span>
              <input
                value={admitNurse}
                onChange={e => setAdmitNurse(e.target.value)}
                maxLength={64}
                placeholder="e.g. Nurse Ana"
                className="h-9 w-40 rounded-sm border border-[#D4DFE5] bg-[#F4F7F8] px-3 text-sm text-[#1F2A52] outline-none transition-colors focus:border-[#2E9A9B] focus:bg-[#FBFCFD]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="smallcaps-detail text-[#7684A0]">Isolation tag</span>
              <div className="flex gap-1">
                {([
                  ["clean", "Clean"],
                  ["dirty", "Dirty"],
                ] as const).map(([tag, label]) => (
                  <Button
                    key={tag}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setAdmitDraft({ ...admitDraft, isolationTag: tag })}
                    className={`h-9 border-[#D4DFE5] bg-[#F4F7F8] ${
                      admitDraft.isolationTag === tag
                        ? tag === "clean"
                          ? "border-[#3E8A6A] text-[#3E8A6A]"
                          : "border-[#9E1F2B] text-[#9E1F2B]"
                        : "text-[#7684A0]"
                    }`}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={admitMut.isPending || customInvalid}
              title={customInvalid ? "Set a duration between 15 minutes and 24 hours" : undefined}
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
            {tiers.veryUrgent.map(entry => (
              <WaitingRow
                key={entry.id}
                entry={entry}
                tier="veryUrgent"
                removeEntry={removeEntry}
                setPriorityMut={setPriorityMut}
                admitDraft={admitDraft}
                setAdmitDraft={setAdmitDraft}
                isAdmitDisabled={isAdmitDisabled}
                admitDisabledReason={admitDisabledReason}
                isAuthenticated={isAuthenticated}
              />
            ))}
            {tiers.urgent.map(entry => (
              <WaitingRow
                key={entry.id}
                entry={entry}
                tier="urgent"
                removeEntry={removeEntry}
                setPriorityMut={setPriorityMut}
                admitDraft={admitDraft}
                setAdmitDraft={setAdmitDraft}
                isAdmitDisabled={isAdmitDisabled}
                admitDisabledReason={admitDisabledReason}
                isAuthenticated={isAuthenticated}
              />
            ))}
            {tiers.normal.map(entry => (
              <WaitingRow
                key={entry.id}
                entry={entry}
                tier="normal"
                removeEntry={removeEntry}
                setPriorityMut={setPriorityMut}
                admitDraft={admitDraft}
                setAdmitDraft={setAdmitDraft}
                isAdmitDisabled={isAdmitDisabled}
                admitDisabledReason={admitDisabledReason}
                isAuthenticated={isAuthenticated}
              />
            ))}
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
  admitDraft: AdmitDraft | null;
  setAdmitDraft: React.Dispatch<React.SetStateAction<AdmitDraft | null>>;
  isAdmitDisabled: boolean;
  admitDisabledReason: string | null;
  isAuthenticated: boolean;
};

function WaitingRow({
  entry,
  tier,
  removeEntry,
  setPriorityMut,
  admitDraft,
  setAdmitDraft,
  isAdmitDisabled,
  admitDisabledReason,
  isAuthenticated,
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
            isVeryUrgent
              ? "text-[#9E1F2B]"
              : isUrgent
                ? "text-[#9E1F2B]"
                : "text-[#1F2A52]"
          } ${isVeryUrgent ? "font-semibold" : ""}`}
        >
          {entry.patientId}
        </p>
        <p className="smallcaps-detail mt-0.5 text-[#7684A0]">
          Added {new Date(entry.joinedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {entry.addedBy ? ` · by ${entry.addedBy}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
        <Button
          size="sm"
          variant="outline"
          disabled={!isAuthenticated || isAdmitDisabled || admitDraft !== null}
          title={admitDisabledReason ?? undefined}
          onClick={() =>
            setAdmitDraft({
              entry,
              durationMinutes: 240,
              durationMode: "preset",
              customHours: "4",
              customMinutes: "0",
              isolationTag: "clean",
              urgent: entry.priority === "veryUrgent",
            })
          }
          className="h-9 border-[#3E8A6A] text-[#3E8A6A] hover:bg-[#3E8A6A]/10"
        >
          <ArrowRightCircle className="mr-1.5 h-4 w-4" />
          Admit
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-9 border-[#D4DFE5] text-[#1F2A52] hover:bg-[#E8EFF1]"
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
          disabled={!isAuthenticated || removeEntry.isPending}
          onClick={() =>
            removeEntry.mutate({ entryId: entry.id, floorId: entry.floorId })
          }
          className="h-9 border-[#9E1F2B]/50 text-[#9E1F2B] hover:bg-[#9E1F2B]/10"
        >
          Remove
        </Button>
      </div>
    </div>
  );
}
