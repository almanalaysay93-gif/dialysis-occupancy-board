import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Renames a machine's number/label (e.g. "HD-004" → "4" or any staff label).
 */
export default function RenameMachineDialog({
  open,
  machineId,
  machineLabel,
  onClose,
}: {
  open: boolean;
  machineId: number | null;
  machineLabel: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [label, setLabel] = useState("");

  const updateLabel = trpc.machines.updateLabel.useMutation({
    onSuccess: () => {
      toast.success(`Machine renamed to "${label.trim()}"`);
      void utils.machines.list.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!machineId) return;
    updateLabel.mutate({ machineId, label: label.trim() });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={v => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-sm bg-[#FBFCFD]">
        <DialogHeader>
          <p className="smallcaps-detail text-muted-foreground">
            Machine Label
          </p>
          <DialogTitle className="font-display text-2xl text-[#1F2A52]">
            Rename {machineLabel}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="machine-label" className="smallcaps-detail text-[#556680]">
              New Machine Number / Label
            </Label>
            <Input
              id="machine-label"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={machineLabel}
              maxLength={32}
              className="h-11 border-[#D4DFE5] bg-[#F4F7F8] font-serif-light text-lg"
              autoFocus
              required
            />
            <p className="text-[11px] leading-relaxed text-[#7684A0]">
              This label appears on the occupancy board. It must be unique
              across all machines.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={updateLabel.isPending}
              className="h-11 flex-1 border-[#D4DFE5] bg-transparent text-[#1F2A52] hover:bg-[#E8EFF1]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateLabel.isPending || !label.trim()}
              className="h-11 flex-[2] bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A] font-serif-light text-base"
            >
              {updateLabel.isPending ? "Saving…" : "Save Label"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
