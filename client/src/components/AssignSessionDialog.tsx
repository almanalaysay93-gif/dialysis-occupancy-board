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
import { BellRing, Droplets } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type IsolationTag = "clean" | "dirty";
type Duration = 180 | 360 | 480;

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
  const [duration, setDuration] = useState<Duration>(180);
  const [tag, setTag] = useState<IsolationTag>("clean");
  const [urgent, setUrgent] = useState(false);

  const assign = trpc.sessions.assign.useMutation({
    onSuccess: () => {
      toast.success(`Session started on ${machineLabel}`, {
        description: `Patient ${patientId} · ${duration / 60} h · ${tag}`,
      });
      setPatientId("");
      setUrgent(false);
      void utils.machines.list.invalidate();
      onAssigned();
    },
    onError: e => toast.error(e.message),
  });

  const submitting = assign.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!machineId) return;
    assign.mutate({
      machineId,
      patientId: patientId.trim(),
      durationMinutes: String(duration) as "180" | "360" | "480",
      isolationTag: tag,
      urgent,
    });
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md bg-[#FBFCFD]">
        <DialogHeader>
          <p className="smallcaps-detail text-muted-foreground">
            New Treatment Session
          </p>
          <DialogTitle className="font-display text-3xl text-[#1F2A52]">
            Assign {machineLabel}
          </DialogTitle>
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
              onValueChange={v => setDuration(Number(v) as Duration)}
              className="grid grid-cols-3 gap-2"
            >
              {[
                { v: 180, label: "3", sub: "hours" },
                { v: 360, label: "6", sub: "hours" },
                { v: 480, label: "8", sub: "hours" },
              ].map(opt => (
                <label
                  key={opt.v}
                  htmlFor={`duration-${opt.v}`}
                  className="flex cursor-pointer flex-col items-center gap-0.5 border border-[#D4DFE5] bg-[#F4F7F8] p-3 transition-colors has-[[data-state=checked]]:border-[#1F2A52] has-[[data-state=checked]]:bg-[#E8EFF1]"
                >
                  <RadioGroupItem
                    id={`duration-${opt.v}`}
                    value={String(opt.v)}
                    className="sr-only"
                  />
                  <span className="font-display text-2xl text-[#1F2A52]">
                    {opt.label}
                  </span>
                  <span className="smallcaps-detail text-[#7684A0]">
                    {opt.sub}
                  </span>
                </label>
              ))}
            </RadioGroup>
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
              disabled={submitting || !patientId.trim()}
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
