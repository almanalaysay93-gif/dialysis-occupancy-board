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
import { useEffect, useState } from "react";

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
  const [replacementRoomId, setReplacementRoomId] = useState("");
  useEffect(() => {
    setReplacementRoomId("");
  }, [open, roomId]);
  const waiting = trpc.waiting.list.useQuery(
    { floorId: roomId ?? 0 },
    { enabled: open && roomId !== null, refetchInterval: 8_000 }
  );
  const rooms = trpc.rooms.list.useQuery(undefined, { enabled: open });
  const waitingCount = waiting.data?.length ?? 0;
  const destinations = (rooms.data ?? []).filter(room => room.id !== roomId);
  const removeRoom = trpc.rooms.remove.useMutation({
    onSuccess: async (_value, variables) => {
      toast.success(`Room “${roomName}” removed from the board`);
      await refreshRoomViews(utils, variables.roomId);
      onRemoved();
    },
    onError: e => {
      toast.error(e.message);
      void utils.waiting.list.invalidate();
    },
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
        {waiting.isLoading && <p role="status">Checking the waiting list…</p>}
        {waiting.isError && (
          <p role="alert">
            Could not check the waiting list. Close this dialog and try again.
          </p>
        )}
        {waitingCount > 0 && (
          <div className="space-y-2">
            <label
              htmlFor="replacement-room"
              className="text-sm font-medium text-[#1F2A52]"
            >
              Move {waitingCount} waiting patient{waitingCount === 1 ? "" : "s"}{" "}
              to
            </label>
            <select
              id="replacement-room"
              value={replacementRoomId}
              onChange={event => setReplacementRoomId(event.target.value)}
              disabled={removeRoom.isPending}
              className="h-11 w-full rounded-md border border-[#D4DFE5] bg-white px-3 text-sm text-[#1F2A52]"
            >
              <option value="">Choose another room</option>
              {destinations.map(room => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
            <p className="text-sm text-[#556680]">
              Their priority and queue times will be kept. Previous callouts
              will be cleared. Past admitted-patient records will stay with the
              archived room.
              {destinations.length === 0 &&
                " Create another room before moving these patients."}
            </p>
          </div>
        )}
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
                removeRoom.mutate({
                  roomId,
                  ...(replacementRoomId
                    ? { replacementRoomId: Number(replacementRoomId) }
                    : {}),
                });
              }
            }}
            disabled={
              roomId === null ||
              removeRoom.isPending ||
              waiting.isLoading ||
              waiting.isError ||
              (waitingCount > 0 &&
                !destinations.some(
                  room => String(room.id) === replacementRoomId
                ))
            }
            className="h-10 bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A] disabled:pointer-events-none disabled:opacity-40"
          >
            {removeRoom.isPending ? "Removing…" : "Remove Room"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
