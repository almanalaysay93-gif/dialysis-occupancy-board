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

/**
 * Removes a machine from the inventory permanently. Available from the tile
 * menu on any board (vacant machines) for staff; the server enforces the
 * in-treatment and backup/repair guards regardless.
 */
export default function RemoveMachineDialog({
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

  const removeMachine = trpc.machines.remove.useMutation({
    onSuccess: () => {
      toast.success(`Machine ${machineLabel} removed from the board`);
      void utils.machines.list.invalidate();
      void utils.machines.listFloors.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <AlertDialog open={open} onOpenChange={v => !v && onClose()}>
      <AlertDialogContent className="max-w-sm bg-[#FBFCFD]">
        <AlertDialogHeader>
          <p className="smallcaps-detail text-muted-foreground">Remove Machine</p>
          <AlertDialogTitle className="font-display text-2xl text-[#1F2A52]">
            Remove {machineLabel}?
          </AlertDialogTitle>
          <AlertDialogDescription className="font-serif-light text-base text-[#556680]">
            This machine will be permanently deleted from the inventory, along
            with any completed treatment records on it. Machines that are in
            treatment or in Backup / Repair storage cannot be removed — end the
            session or return the machine to a board first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-10 border-[#D4DFE5] bg-transparent text-[#1F2A52] hover:bg-[#E8EFF1]">
            Keep machine
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => machineId && removeMachine.mutate({ machineId })}
            className="h-10 bg-[#1F2A52] text-[#F4F7F8] hover:bg-[#151D3A]"
          >
            {removeMachine.isPending ? "Removing…" : "Remove Machine"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
