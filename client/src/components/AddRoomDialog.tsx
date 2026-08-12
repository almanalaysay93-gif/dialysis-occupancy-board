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
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";

export default function AddRoomDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");

  const addRoom = trpc.rooms.add.useMutation({
    onSuccess: (_v, vars) => {
      toast.success(`Room “${vars.name.trim()}” added to the board`);
      void utils.rooms.list.invalidate();
      void utils.machines.listFloors.invalidate();
      void utils.machines.list.invalidate();
      setName("");
      onClose();
    },
    onError: e => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error("Room name is required");
      return;
    }
    addRoom.mutate({ name: name.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="bg-[#F6F1E7] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl text-[#2B2620]">
            Add Room
          </DialogTitle>
          <DialogDescription className="font-serif-light italic text-[#6B6152]">
            Register a new dialysis room. Machines can then be placed in it
            from the Add Machine control on the board.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="room-name" className="smallcaps-detail">
              Room Name
            </Label>
            <Input
              id="room-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Floor 4 · East Wing"
              className="bg-[#FDF9F0] text-[#2B2620]"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            className="border-[#D9CFBA] text-[#2B2620]"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={addRoom.isPending}
            className="bg-[#2B2620] text-[#F6F1E7] hover:bg-[#1A1611]"
          >
            {addRoom.isPending ? "Adding…" : "Add Room"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
