import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";

import { trpc } from "@/lib/trpc";
import { BellRing, Clock, Droplets, Pencil, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type IsolationTag = "clean" | "dirty";
type DurationValue = 180 | 240 | 360 | 480 | "custom";

function formatDurationSummary(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} m`;
}

export default function AssignSessionDialog({
  open,
  machineId,
  machineLabel,
  onClose,
  onAssigned,
}: {
  open: boolean;
  machineId: number | null;
  machineLabel: string;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const utils = trpc.useUtils();
  const [patientId, setPatientId] = useState("");
  const [duration, setDuration] = useState<DurationValue>(180);
  const [customHours, setCustomHours] = useState("4");
  const [customMinutes, setCustomMinutes] = useState("0");
  const [tag, setTag] = useState<IsolationTag>("clean");
  const [urgent, setUrgent] = useState(false);
  const [editLabelOpen, setEditLabelOpen] = useState(false);
  const [displayLabel, setDisplayLabel] = useState("");
  const [nurse, setNurse] = useState("");

  const assign = trpc.sessions.assign.useMutation({
    onSuccess: () => {
      const minutes =
        duration === "custom"
          ? (Number(customHours) || 0) * 60 + (Number(customMinutes) || 0)
          : duration;
      toast.success(`Session started on ${machineLabel}`, {
        description: `Patient ${patientId} · ${formatDurationSummary(minutes)} · ${tag}`,
      });
      setPatientId("");
      setUrgent(false);
      setNurse("");
      void utils.machines.list.invalidate();
      onAssigned();
    },
    onError: e => toast.error(e.message),
  });

  const submitting = assign.isPending;

  const effectiveMinutes =
    duration === "custom"
      ? (Number(customHours) || 0) * 60 + (Number(customMinutes) || 0)
      : duration;

  const customInvalid =
    duration === "custom" && (effectiveMinutes < 15 || effectiveMinutes > 1440);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!machineId) return;
    assign.mutate({
      machineId,
      patientId: patientId.trim(),
      durationMinutes: duration === "custom" ? effectiveMinutes : (String(duration) as "180" | "240" | "360" | "480"),
      customMinutes: duration === "custom" ? effectiveMinutes : null,
      isolationTag: tag,
      urgent,
      displayLabel: displayLabel.trim() || null,
      assignedNurse: nurse.trim() || null,
    });
  };

  const isCustom = duration === "custom";

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md bg-[#FBFCFD]">
        <DialogHeader>
          <p className="smallcaps-detail text-muted-foreground">
            New Treatment Session
          </p>
          <div className="flex items-center gap-2">
            <DialogTitle className="font-display text-3xl text-[#1F2A52]">
              Assign {machineLabel}
            </DialogTitle>
            {editLabelOpen ? (
                <form
                className="flex items-center gap-1.5"
                onSubmit={e => {
                  e.preventDefault();
                  setEditLabelOpen(false);
                }}
              >
                <Input
                  value={displayLabel}
                  onChange={e => setDisplayLabel(e.target.value)}
                  maxLength={64}
                  placeholder="e.g. Bed 4 — P-1042"
                  className="h-9 w-44 border-[#D4DFE5] bg-[#F4F7F8] text-sm"
                  autoFocus
                />
                <Button
                  type="submit"
                  size="sm"
                  className="h-9 bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A]"
                >
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setEditLabelOpen(false)}
                  className="h-9 border-[#D4DFE5] text-[#7684A0]"
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDisplayLabel("");
                  setEditLabelOpen(true);
                }}
                aria-label="Edit the highlighted session title"
                className="flex items-center gap-1 border border-[#D4DFE5] bg-[#F4F7F8] px-2 py-1 text-[11px] text-[#7684A0] transition-colors hover:border-[#2E9A9B] hover:text-[#2E9A9B]"
              >
                <Pencil className="h-3 w-3" />
                Edit title
              </button>
            )}
          </div>
          <DialogDescription className="font-serif-light text-base text-[#556680]">
            Record the patient, treatment duration, isolation classification,
            and urgency before starting the session.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="patient-id" className="smallcaps-detail text-[#556680]">
              Patient Identifier
            </Label>
            <Input
              id="patient-id"
              value={patientId}
              onChange={e => setPatientId(e.target.value)}
              placeholder="e.g. P-1042"
              className="h-11 border-[#D4DFE5] bg-[#F4F7F8] font-serif-light text-lg"
              autoFocus
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="smallcaps-detail text-[#556680]">
              Treatment Duration
            </Label>
            <RadioGroup
              value={String(duration)}
              onValueChange={v => setDuration(v as DurationValue)}
              className="grid grid-cols-5 gap-2"
            >
              {[
                { v: 180, label: "3", sub: "hours" },
                { v: 240, label: "4", sub: "hours" },
                { v: 360, label: "6", sub: "hours" },
                { v: 480, label: "8", sub: "hours" },
                { v: "custom", label: "Custom", sub: "any length" },
              ].map(opt => (
                <label
                  key={String(opt.v)}
                  htmlFor={`duration-${String(opt.v)}`}
                  className="flex cursor-pointer flex-col items-center gap-0.5 border border-[#D4DFE5] bg-[#F4F7F8] p-3 transition-colors has-[[data-state=checked]]:border-[#1F2A52] has-[[data-state=checked]]:bg-[#E8EFF1]"
                >
                  <RadioGroupItem
                    id={`duration-${String(opt.v)}`}
                    value={String(opt.v)}
                    className="sr-only"
                  />
                  <span
                    className={`font-display text-[#1F2A52] ${
                      opt.v === "custom" ? "text-lg" : "text-2xl"
                    }`}
                  >
                    {opt.label}
                  </span>
                  <span className="smallcaps-detail text-[#7684A0]">
                    {opt.sub}
                  </span>
                </label>
              ))}
            </RadioGroup>

            {isCustom && (
              <div className="flex items-center gap-3 border border-[#2E9A9B]/50 bg-[#2E9A9B]/5 p-3">
                <Clock className="h-4 w-4 shrink-0 text-[#2E9A9B]" />
                <div className="flex flex-1 items-baseline gap-2">
                  <Input
                    id="custom-hours"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={24}
                    value={customHours}
                    onChange={e => setCustomHours(e.target.value)}
                    className="h-10 w-20 border-[#D4DFE5] bg-[#FBFCFD] font-serif-light text-lg"
                    aria-label="Hours"
                  />
                  <span className="smallcaps-detail text-[#556680]">hours</span>
                  <Input
                    id="custom-minutes"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={59}
                    step={5}
                    value={customMinutes}
                    onChange={e => setCustomMinutes(e.target.value)}
                    className="h-10 w-20 border-[#D4DFE5] bg-[#FBFCFD] font-serif-light text-lg"
                    aria-label="Minutes"
                  />
                  <span className="smallcaps-detail text-[#556680]">
                    minutes
                  </span>
                </div>
              </div>
            )}

            {isCustom && customInvalid && (
              <p className="text-[11px] leading-relaxed text-[#9E1F2B]">
                Duration must be between 15 minutes and 24 hours.
              </p>
            )}

            {!isCustom && (
              <p className="text-[11px] leading-relaxed text-[#7684A0]">
                Select “Custom” to set any treatment length between 15 minutes
                and 24 hours.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label className="smallcaps-detail text-[#556680]" htmlFor="nurse-input">
              Nurse — optional
            </Label>
            <Input
              id="nurse-input"
              value={nurse}
              onChange={e => setNurse(e.target.value)}
              maxLength={64}
              placeholder="e.g. Nurse Ana"
              className="h-10 border-[#D4DFE5] bg-[#F4F7F8] text-sm"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="smallcaps-detail text-[#556680]">
              Isolation Tag — based on diagnosis
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTag("clean")}
                className={`flex items-center justify-center gap-2 border p-3 transition-colors ${
                  tag === "clean"
                    ? "border-[#3E8A6A] bg-[#3E8A6A]/10"
                    : "border-[#D4DFE5] bg-[#F4F7F8] hover:bg-[#E8EFF1]"
                }`}
              >
                <Droplets className="h-4 w-4 text-[#3E8A6A]" />
                <span className="smallcaps-detail text-[#1F2A52]">Clean</span>
              </button>
              <button
                type="button"
                onClick={() => setTag("dirty")}
                className={`flex items-center justify-center gap-2 border p-3 transition-colors ${
                  tag === "dirty"
                    ? "border-[#2E9A9B] bg-[#2E9A9B]/10"
                    : "border-[#D4DFE5] bg-[#F4F7F8] hover:bg-[#E8EFF1]"
                }`}
              >
                <Droplets className="h-4 w-4 text-[#2E9A9B]" />
                <span className="smallcaps-detail text-[#1F2A52]">Dirty</span>
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-[#7684A0]">
              Use “dirty” for patients requiring isolation due to infectious
              diagnosis; the machine will need dedicated sanitation after the
              session ends.
            </p>
          </div>

          <label className="flex items-center justify-between border border-[#D4DFE5] bg-[#F4F7F8] p-3">
            <div className="flex items-center gap-2.5">
              <BellRing className="h-4 w-4 text-[#9E1F2B]" />
              <div className="flex flex-col">
                <span className="smallcaps-detail text-[#1F2A52]">Urgent Case</span>
                <span className="mt-0.5 text-[11px] text-[#7684A0]">
                  Highlight as priority on the board
                </span>
              </div>
            </div>
            <Switch
              checked={urgent}
              onCheckedChange={setUrgent}
              aria-label="Mark as urgent case"
            />
          </label>

          <div className="flex items-center gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
              className="h-11 flex-1 border-[#D4DFE5] bg-transparent text-[#1F2A52] hover:bg-[#E8EFF1]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                submitting ||
                !patientId.trim() ||
                effectiveMinutes < 15 ||
                effectiveMinutes > 1440
              }
              className="h-11 flex-[2] bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A] font-serif-light text-base"
            >
              {submitting ? "Starting session…" : "Start Session"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
