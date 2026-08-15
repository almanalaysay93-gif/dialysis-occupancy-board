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
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Edits the session's display label — the highlighted text shown on the
 * machine tile (default is the machine number, e.g. "137" for HD-137).
 * Staff can rename it to anything helpful (e.g. a patient alias or bed
 * reference). Setting it empty restores the machine number.
 */
export default function RenameSessionLabelDialog({
  open,
  sessionId,
  machineLabel,
  currentLabel,
  onClose,
}: {
  open: boolean;
  sessionId: number | null;
  machineLabel: string;
  currentLabel: string | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  // Hydrate the input with the session's current label when the dialog opens
  // so a save without retyping keeps the existing title instead of erasing it.
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (open) setLabel(currentLabel ?? "");
  }, [open, currentLabel]);

  const updateLabel = trpc.sessions.updateLabel.useMutation({
    onSuccess: (_, vars) => {
      const next = vars.displayLabel?.trim() ?? "";
      toast.success(next ? `Session title set to "${next}"` : "Session title restored to machine number");
      void utils.machines.list.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId) return;
    updateLabel.mutate({ sessionId, displayLabel: label.trim() || null });
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
            Session Title — {machineLabel}
          </p>
          <DialogTitle className="font-display text-2xl text-[#1F2A52]">
            Edit Highlighted Area
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="session-label" className="smallcaps-detail text-[#556680]">
              Display Text on the Tile
            </Label>
            <Input
              id="session-label"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={currentLabel ?? machineLabel.replace("HD-", "")}
              maxLength={64}
              className="h-11 border-[#D4DFE5] bg-[#F4F7F8] font-serif-light text-lg"
              autoFocus
            />
            <p className="text-[11px] leading-relaxed text-[#7684A0]">
              This replaces the machine number on the tile for the duration of
              the session. Clear the field to restore the machine number.
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
              disabled={updateLabel.isPending}
              className="h-11 flex-[2] bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A] font-serif-light text-base"
            >
              {updateLabel.isPending ? "Saving…" : "Save Title"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
