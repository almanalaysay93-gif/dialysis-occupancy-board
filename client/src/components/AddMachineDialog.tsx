import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";

export default function AddMachineDialog({
  open,
  onClose,
  initialFloorId,
}: {
  open: boolean;
  onClose: () => void;
  initialFloorId?: number | null;
}) {
  const utils = trpc.useUtils();
  const { data: floors } = trpc.machines.listFloors.useQuery();

  const [label, setLabel] = useState("");
  const [floorId, setFloorId] = useState<string>("none");
  const [location, setLocation] = useState("");

  const addMachine = trpc.machines.add.useMutation({
    onSuccess: () => {
      toast.success(`Machine ${label.trim()} added to the board`);
      void utils.machines.list.invalidate();
      void utils.machines.listFloors.invalidate();
      setLabel("");
      setLocation("");
      onClose();
    },
    onError: e => toast.error(e.message),
  });

  const floorsReady = floors ?? [];
  const defaultFloor =
    initialFloorId !== undefined && initialFloorId !== null
      ? String(initialFloorId)
      : floorsReady[0]?.id != null
        ? String(floorsReady[0].id)
        : "none";

  const handleSubmit = () => {
    if (!label.trim()) {
      toast.error("Machine label is required");
      return;
    }
    addMachine.mutate({
      label: label.trim(),
      floorId: floorId === "none" ? null : Number(floorId),
      location: location.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="bg-[#F4F7F8] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl text-[#1F2A52]">
            Add Machine
          </DialogTitle>
          <DialogDescription className="font-serif-light italic text-[#556680]">
            Register a new hemodialysis machine on the board. It appears in its
            assigned floor row immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="machine-label" className="smallcaps-detail">
              Machine Label
            </Label>
            <Input
              id="machine-label"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. HD-161"
              className="bg-[#FBFCFD] text-[#1F2A52]"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="smallcaps-detail">Floor</Label>
            <Select value={floorId === "none" ? "none" : floorId} onValueChange={setFloorId}>
              <SelectTrigger className="w-full bg-[#FBFCFD] text-[#1F2A52]">
                <SelectValue placeholder="Select floor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {floorsReady.map(f => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="machine-location" className="smallcaps-detail">
              Location
              <span className="ml-1 font-sans normal-case font-normal text-muted-foreground">
                (optional, e.g. Row 3 · Pos 2)
              </span>
            </Label>
            <Input
              id="machine-location"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="e.g. Row 3 · Pos 2"
              className="bg-[#FBFCFD] text-[#1F2A52]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            className="border-[#D4DFE5] text-[#1F2A52]"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={addMachine.isPending}
            className="bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A]"
          >
            {addMachine.isPending ? "Adding…" : "Add Machine"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
