import { refreshRoomViews } from "@/lib/room-views";
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
    onSuccess: async (_value, variables) => {
      toast.success(`Room “${roomName}” removed from the board`);
      await refreshRoomViews(utils, variables.roomId);
      onRemoved();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={v => !v && !removeRoom.isPending && onClose()}
    >
      <AlertDialogContent className="max-w-sm bg-[#FBFCFD]">
        <AlertDialogHeader>
          <p className="smallcaps-detail text-muted-foreground">Remove Room</p>
          <AlertDialogTitle className="font-display text-2xl text-[#1F2A52]">
            Remove “{roomName}”?
          </AlertDialogTitle>
          <AlertDialogDescription className="font-serif-light text-base text-[#556680]">
            {machineCount > 0
              ? `The room will be removed and its ${machineCount} machine${machineCount > 1 ? "s" : ""} moved to Backup. All machines and their history will be kept. If any patient is currently in treatment, removal will be blocked until those sessions end.`
              : "The room will be removed from the board. Machines in Backup & Repair and their history will be kept. Machines cannot be re-added to a removed room — create a new one instead."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel
            disabled={removeRoom.isPending}
            className="h-10 border-[#D4DFE5] bg-transparent text-[#1F2A52] hover:bg-[#E8EFF1]"
          >
            Keep room
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={event => {
              event.preventDefault();
              if (roomId !== null && !removeRoom.isPending) {
                removeRoom.mutate({ roomId });
              }
            }}
            disabled={roomId === null || removeRoom.isPending}
            className="h-10 bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A] disabled:pointer-events-none disabled:opacity-40"
          >
            {removeRoom.isPending ? "Removing…" : "Remove Room"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
