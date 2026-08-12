import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, BellRing, Clock, Droplets, MoreVertical, Plus, Power } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { MachineWithSession } from "../../../server/machines";

function useCountdown(endsAt: Date | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!endsAt) return null;
  return Math.max(0, endsAt.getTime() - now);
}

function formatHMS(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function durationLabel(min: number): string {
  if (min === 180) return "3 h";
  if (min === 360) return "6 h";
  if (min === 480) return "8 h";
  return `${Math.round(min / 60)} h`;
}

export default function MachineTile({
  row,
  index,
  onAssign,
}: {
  row: MachineWithSession;
  index: number;
  onAssign: (machineId: number) => void;
}) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const occupied = row.session !== null;
  const urgent = row.session?.urgent ?? false;
  const countdownMs = useCountdown(row.session?.endsAt ?? null);
  const totalMs = (row.session?.durationMinutes ?? 0) * 60 * 1000;
  const progress = totalMs > 0 && countdownMs !== null ? 1 - countdownMs / totalMs : 0;

  const toggleUrgent = trpc.sessions.toggleUrgent.useMutation({
    onSuccess: () => {
      toast.success(
        urgent ? "Urgent flag removed" : "Urgent flag set",
        { description: `${row.machine.label} — ${row.session?.patientId}` }
      );
      void utils.machines.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const endSession = trpc.sessions.end.useMutation({
    onSuccess: () => {
      toast.success(`Session ended on ${row.machine.label}`, {
        description: "Machine returned to vacant status.",
      });
      void utils.machines.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const updateTag = trpc.sessions.updateTag.useMutation({
    onSuccess: () => {
      toast.success("Isolation tag updated");
      void utils.machines.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const isStaff = !!user;

  if (!occupied) {
    return (
      <button
        onClick={() => isStaff && onAssign(row.machine.id)}
        disabled={!isStaff}
        aria-label={`Assign a session to machine ${row.machine.label}`}
        style={{ animationDelay: `${Math.min(index * 40, 600)}ms` }}
        className={cn(
          "tile-enter tile-vacant relative flex flex-col items-start gap-4 p-5 text-left min-h-[190px]",
          isStaff ? "" : "cursor-default"
        )}
      >
        <div className="flex w-full items-center justify-between">
          <div>
            <p className="smallcaps-detail text-muted-foreground">
              {row.machine.location}
            </p>
            <h3 className="font-display mt-1 text-3xl text-[#2B2620]">
              {row.machine.label.replace("HD-", "")}
            </h3>
          </div>
          {isStaff && (
            <span className="flex h-9 w-9 items-center justify-center border border-dashed border-[#8A7A5F]/50 text-[#8A7A5F] transition-colors hover:bg-[#EFE9DC]">
              <Plus className="h-4 w-4" />
            </span>
          )}
        </div>
        <div className="mt-auto w-full border-t border-[#D9CFBA]/60 pt-3">
          <span className="smallcaps-detail text-[#6B8A66]">
            Vacant · Ready
          </span>
        </div>
      </button>
    );
  }

  const session = row.session!;
  const elapsedMs = Math.min(totalMs, totalMs - (countdownMs ?? 0));

  return (
    <div
      style={{ animationDelay: `${Math.min(index * 40, 600)}ms` }}
      className={cn(
        "tile-enter relative flex flex-col items-start gap-3 p-5 min-h-[190px] overflow-hidden",
        urgent ? "tile-urgent tile-urgent-pulse" : "tile-occupied"
      )}
    >
      {/* progress rail */}
      <div
        className="absolute bottom-0 left-0 h-[3px] bg-[#F6F1E7]/50 transition-all"
        style={{ width: `${Math.min(100, progress * 100)}%` }}
      />

      <div className="flex w-full items-start justify-between">
        <div>
          <p className="smallcaps-detail text-[#E8F2E6]/80">
            {row.machine.location}
          </p>
          <h3 className="font-display mt-1 text-3xl">
            {row.machine.label.replace("HD-", "")}
          </h3>
        </div>
        {urgent ? (
          <span className="flex items-center gap-1.5 border border-[#F2C9B8]/60 px-2 py-1">
            <BellRing className="h-3 w-3" />
            <span className="smallcaps-detail">Urgent</span>
          </span>
        ) : (
          <Activity className="mt-1 h-4 w-4 text-[#A7CBA2]" />
        )}
      </div>

      <div className="mt-1 flex flex-col gap-1">
        <p className="font-serif-light text-xl leading-tight">
          Patient {session.patientId}
        </p>
        <p className="text-[11px] uppercase tracking-[0.2em] text-[#C9DCC6]">
          {durationLabel(session.durationMinutes)} session · started{" "}
          {new Date(session.startedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>

      <div className="mt-auto flex w-full items-center justify-between pt-2">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          <span className="font-mono text-sm tabular-nums tracking-wide">
            {countdownMs === null ? "--:--:--" : formatHMS(countdownMs)}
          </span>
          <span className="smallcaps-detail text-[#C9DCC6]">left</span>
        </div>
        {elapsedMs >= totalMs && (
          <span className="flex items-center gap-1 border border-[#F2C9B8]/70 px-2 py-0.5">
            <AlertTriangle className="h-3 w-3" />
            <span className="smallcaps-detail">Complete</span>
          </span>
        )}
      </div>

      {isStaff && (
        <div className="absolute right-2 top-2 flex items-center gap-1.5">
          <Badge
            variant="outline"
            onClick={() =>
              updateTag.mutate({
                sessionId: session.id,
                isolationTag: session.isolationTag === "clean" ? "dirty" : "clean",
              })
            }
            className={cn(
              "smallcaps-detail flex cursor-pointer items-center gap-1 border transition-all",
              session.isolationTag === "clean"
                ? "border-[#A7CBA2]/70 bg-[#A7CBA2]/15 text-[#E8F2E6]"
                : "border-[#CFA16F]/70 bg-[#CFA16F]/20 text-[#F7E6CB]"
            )}
          >
            <Droplets className="h-2.5 w-2.5" />
            {session.isolationTag}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Session actions"
                className="h-7 w-7 text-[#DDE8DA] hover:bg-[#F6F1E7]/15 hover:text-[#F6F1E7]"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="smallcaps-detail text-muted-foreground">
                Machine {row.machine.label}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => toggleUrgent.mutate({ sessionId: session.id })}
                className="text-[13px]"
              >
                <BellRing className="mr-2 h-4 w-4" />
                {urgent ? "Clear urgent flag" : "Mark urgent"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  updateTag.mutate({
                    sessionId: session.id,
                    isolationTag:
                      session.isolationTag === "clean" ? "dirty" : "clean",
                  })
                }
                className="text-[13px]"
              >
                <Droplets className="mr-2 h-4 w-4" />
                Toggle {session.isolationTag === "clean" ? "dirty" : "clean"} tag
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => endSession.mutate({ sessionId: session.id })}
                className="text-[13px] text-destructive focus:text-destructive"
              >
                <Power className="mr-2 h-4 w-4" />
                End session
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
