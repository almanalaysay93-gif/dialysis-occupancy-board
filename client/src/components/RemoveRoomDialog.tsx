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
      <AlertDialogContent className="max-w-sm bg-[#FDF9F0]">
        <AlertDialogHeader>
          <p className="smallcaps-detail text-muted-foreground">
            Remove Room
          </p>
          <AlertDialogTitle className="font-display text-2xl text-[#2B2620]">
            Remove “{roomName}”?
          </AlertDialogTitle>
          <AlertDialogDescription className="font-serif-light text-base text-[#6B6152]">
            {machineCount > 0
              ? `This room still holds ${machineCount} machine${machineCount > 1 ? "s" : ""}. Remove its machines from the Occupancy Board first, then return to remove the room.`
              : "The room will be removed from the board. Machines cannot be re-added to a removed room — create a new one instead."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-10 border-[#D9CFBA] bg-transparent text-[#2B2620] hover:bg-[#EFE9DC]">
            Keep room
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              roomId && machineCount === 0 && removeRoom.mutate({ roomId })
            }
            disabled={machineCount > 0}
            className="h-10 bg-[#2B2620] text-[#F6F1E7] hover:bg-[#1A1611] disabled:pointer-events-none disabled:opacity-40"
          >
            {removeRoom.isPending ? "Removing…" : "Remove Room"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
