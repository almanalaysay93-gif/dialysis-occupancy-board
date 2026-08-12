import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function RemoveRoomDialog({
  open,
  roomId,
  roomName,
  machineCount,
  onClose,
  onRemoved,
}: {
  open: boolean;
  roomId: number | null;
  roomName: string;
  machineCount: number;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const utils = trpc.useUtils();
  const removeRoom = trpc.rooms.remove.useMutation({
    onSuccess: () => {
      toast.success(`Room “${roomName}” removed from the board`);
      void utils.rooms.list.invalidate();
      void utils.machines.listFloors.invalidate();
      void utils.machines.list.invalidate();
      onRemoved();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <AlertDialog open={open} onOpenChange={v => !v && onClose()}>
      <AlertDialogContent className="max-w-sm bg-[#FBFCFD]">
        <AlertDialogHeader>
          <p className="smallcaps-detail text-muted-foreground">
            Remove Room
          </p>
          <AlertDialogTitle className="font-display text-2xl text-[#1F2A52]">
            Remove “{roomName}”?
          </AlertDialogTitle>
          <AlertDialogDescription className="font-serif-light text-base text-[#556680]">
            {machineCount > 0
              ? `This room still holds ${machineCount} machine${machineCount > 1 ? "s" : ""}. Remove its machines from the Occupancy Board first, then return to remove the room.`
              : "The room will be removed from the board. Machines cannot be re-added to a removed room — create a new one instead."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-10 border-[#D4DFE5] bg-transparent text-[#1F2A52] hover:bg-[#E8EFF1]">
            Keep room
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              roomId && machineCount === 0 && removeRoom.mutate({ roomId })
            }
            disabled={machineCount > 0}
            className="h-10 bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A] disabled:pointer-events-none disabled:opacity-40"
          >
            {removeRoom.isPending ? "Removing…" : "Remove Room"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
