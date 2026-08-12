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
      <AlertDialogContent className="max-w-sm bg-[#FDF9F0]">
        <AlertDialogHeader>
          <p className="smallcaps-detail text-muted-foreground">
            Release Machine
          </p>
          <AlertDialogTitle className="font-display text-2xl text-[#2B2620]">
            End session on {machineLabel}?
          </AlertDialogTitle>
          <AlertDialogDescription className="font-serif-light text-base text-[#6B6152]">
            The machine will be returned to vacant status on the occupancy
            board. If the patient carried a <strong>dirty</strong> isolation
            tag, schedule dedicated sanitation before the next treatment.
          </AlertDialogDescription>
          <div className="flex items-center gap-2 border border-[#D9CFBA] bg-[#F6F1E7] px-3 py-2">
            <Droplets className="h-4 w-4 text-[#8A7A5F]" />
            <span className="smallcaps-detail text-[#6B6152]">
              Sanitation checklist reminder
            </span>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-10 border-[#D9CFBA] bg-transparent text-[#2B2620] hover:bg-[#EFE9DC]">
            Keep session
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              sessionId && endSession.mutate({ sessionId })
            }
            className="h-10 bg-[#A03A25] text-[#F6F1E7] hover:bg-[#852E1E]"
          >
            {endSession.isPending ? "Ending…" : "End Session"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
