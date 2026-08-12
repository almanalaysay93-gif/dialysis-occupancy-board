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
import { Droplets } from "lucide-react";
import { toast } from "sonner";

export default function EndSessionDialog({
  open,
  sessionId,
  machineLabel,
  onClose,
  onEnded,
}: {
  open: boolean;
  sessionId: number | null;
  machineLabel: string;
  onClose: () => void;
  onEnded: () => void;
}) {
  const utils = trpc.useUtils();
  const endSession = trpc.sessions.end.useMutation({
    onSuccess: () => {
      toast.success(`Session ended on ${machineLabel}`, {
        description:
          sessionId
            ? "Machine returned to vacant status. Sanitation workflow may be required."
            : "Machine returned to vacant status.",
      });
      void utils.machines.list.invalidate();
      onEnded();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <AlertDialog open={open} onOpenChange={v => !v && onClose()}>
      <AlertDialogContent className="max-w-sm bg-[#FBFCFD]">
        <AlertDialogHeader>
          <p className="smallcaps-detail text-muted-foreground">
            Release Machine
          </p>
          <AlertDialogTitle className="font-display text-2xl text-[#1F2A52]">
            End session on {machineLabel}?
          </AlertDialogTitle>
          <AlertDialogDescription className="font-serif-light text-base text-[#556680]">
            The machine will be returned to vacant status on the occupancy
            board. If the patient carried a <strong>dirty</strong> isolation
            tag, schedule dedicated sanitation before the next treatment.
          </AlertDialogDescription>
          <div className="flex items-center gap-2 border border-[#D4DFE5] bg-[#F4F7F8] px-3 py-2">
            <Droplets className="h-4 w-4 text-[#7684A0]" />
            <span className="smallcaps-detail text-[#556680]">
              Sanitation checklist reminder
            </span>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-10 border-[#D4DFE5] bg-transparent text-[#1F2A52] hover:bg-[#E8EFF1]">
            Keep session
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              sessionId && endSession.mutate({ sessionId })
            }
            className="h-10 bg-[#9E1F2B] text-[#F4F7F8] hover:bg-[#831924]"
          >
            {endSession.isPending ? "Ending…" : "End Session"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
