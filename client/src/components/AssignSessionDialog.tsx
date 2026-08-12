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
      <DialogContent className="max-w-md bg-[#FDF9F0]">
        <DialogHeader>
          <p className="smallcaps-detail text-muted-foreground">
            New Treatment Session
          </p>
          <DialogTitle className="font-display text-3xl text-[#2B2620]">
            Assign {machineLabel}
          </DialogTitle>
          <DialogDescription className="font-serif-light text-base text-[#6B6152]">
            Record the patient, treatment duration, isolation classification,
            and urgency before starting the session.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="patient-id" className="smallcaps-detail text-[#6B6152]">
              Patient Identifier
            </Label>
            <Input
              id="patient-id"
              value={patientId}
              onChange={e => setPatientId(e.target.value)}
              placeholder="e.g. P-1042"
              className="h-11 border-[#D9CFBA] bg-[#F6F1E7] font-serif-light text-lg"
              autoFocus
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="smallcaps-detail text-[#6B6152]">
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
                  className="flex cursor-pointer flex-col items-center gap-0.5 border border-[#D9CFBA] bg-[#F6F1E7] p-3 transition-colors has-[[data-state=checked]]:border-[#2B2620] has-[[data-state=checked]]:bg-[#EFE9DC]"
                >
                  <RadioGroupItem
                    id={`duration-${opt.v}`}
                    value={String(opt.v)}
                    className="sr-only"
                  />
                  <span className="font-display text-2xl text-[#2B2620]">
                    {opt.label}
                  </span>
                  <span className="smallcaps-detail text-[#8A7A5F]">
                    {opt.sub}
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="smallcaps-detail text-[#6B6152]">
              Isolation Tag — based on diagnosis
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTag("clean")}
                className={`flex items-center justify-center gap-2 border p-3 transition-colors ${
                  tag === "clean"
                    ? "border-[#4E7A48] bg-[#4E7A48]/10"
                    : "border-[#D9CFBA] bg-[#F6F1E7] hover:bg-[#EFE9DC]"
                }`}
              >
                <Droplets className="h-4 w-4 text-[#4E7A48]" />
                <span className="smallcaps-detail text-[#2B2620]">Clean</span>
              </button>
              <button
                type="button"
                onClick={() => setTag("dirty")}
                className={`flex items-center justify-center gap-2 border p-3 transition-colors ${
                  tag === "dirty"
                    ? "border-[#A0562F] bg-[#A0562F]/10"
                    : "border-[#D9CFBA] bg-[#F6F1E7] hover:bg-[#EFE9DC]"
                }`}
              >
                <Droplets className="h-4 w-4 text-[#A0562F]" />
                <span className="smallcaps-detail text-[#2B2620]">Dirty</span>
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-[#8A7A5F]">
              Use “dirty” for patients requiring isolation due to infectious
              diagnosis; the machine will need dedicated sanitation after the
              session ends.
            </p>
          </div>

          <label className="flex items-center justify-between border border-[#D9CFBA] bg-[#F6F1E7] p-3">
            <div className="flex items-center gap-2.5">
              <BellRing className="h-4 w-4 text-[#A03A25]" />
              <div className="flex flex-col">
                <span className="smallcaps-detail text-[#2B2620]">Urgent Case</span>
                <span className="mt-0.5 text-[11px] text-[#8A7A5F]">
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
              className="h-11 flex-1 border-[#D9CFBA] bg-transparent text-[#2B2620] hover:bg-[#EFE9DC]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !patientId.trim()}
              className="h-11 flex-[2] bg-[#2B2620] text-[#F6F1E7] hover:bg-[#1A1611] font-serif-light text-base"
            >
              {submitting ? "Starting session…" : "Start Session"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
