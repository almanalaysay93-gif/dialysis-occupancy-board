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
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function RenameRoomDialog({
  open,
  roomId,
  roomName,
  onClose,
}: {
  open: boolean;
  roomId: number | null;
  roomName: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName(roomName);
  }, [open, roomName]);

  const renameRoom = trpc.rooms.rename.useMutation({
    onSuccess: (_v, vars) => {
      toast.success(`Room renamed to “${vars.name.trim()}”`);
      void utils.rooms.list.invalidate();
      void utils.machines.listFloors.invalidate();
      void utils.machines.list.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Room name is required");
      return;
    }
    if (trimmed === roomName) {
      toast.info("The room name did not change");
      onClose();
      return;
    }
    if (roomId !== null) renameRoom.mutate({ roomId, name: trimmed });
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="bg-[#F4F7F8] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl text-[#1F2A52]">
            Rename Room
          </DialogTitle>
          <DialogDescription className="font-serif-light italic text-[#556680]">
            Give “{roomName}” a new name. The change appears immediately on the
            board, the sidebar, and every connected staff device.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename-room-name" className="smallcaps-detail">
              Room Name
            </Label>
            <Input
              id="rename-room-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. SKTI Main"
              className="bg-[#FBFCFD] text-[#1F2A52]"
              autoFocus
              onKeyDown={e => {
                if (e.key === "Enter") handleSubmit();
              }}
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
            disabled={renameRoom.isPending}
            className="bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A]"
          >
            {renameRoom.isPending ? "Saving…" : "Save Name"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
