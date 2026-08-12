import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

/**
 * Compact machine chip rendered inside a floor's horizontal row band.
 * Vacant machines show a minimal numbered chip; occupied machines show
 * patient, timer, and isolation tag in a richer strip.
 */
export function FloorMachineChip({
  row,
  onAssign,
}: {
  row: MachineWithSession;
  onAssign: (machineId: number) => void;
}) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const occupied = row.session !== null;
  const urgent = row.session?.urgent ?? false;
  const countdownMs = useCountdown(row.session?.endsAt ?? null);
  const totalMs = (row.session?.durationMinutes ?? 0) * 60 * 1000;
  const isStaff = !!user;
  const done = countdownMs === 0;

  const toggleUrgent = trpc.sessions.toggleUrgent.useMutation({
    onSuccess: () => void utils.machines.list.invalidate(),
    onError: e => toast.error(e.message),
  });

  const endSession = trpc.sessions.end.useMutation({
    onSuccess: () => void utils.machines.list.invalidate(),
    onError: e => toast.error(e.message),
  });

  const updateTag = trpc.sessions.updateTag.useMutation({
    onSuccess: () => void utils.machines.list.invalidate(),
    onError: e => toast.error(e.message),
  });

  if (!occupied) {
    const content = (
      <button
        onClick={() => isStaff && onAssign(row.machine.id)}
        disabled={!isStaff}
        aria-label={`Assign a session to machine ${row.machine.label}`}
        className={cn(
          "group flex h-14 w-full flex-col items-center justify-center gap-0.5 border border-[#D9CFBA]/70 bg-[#FDF9F0] text-center transition-all",
          isStaff && "hover:border-[#8A7A5F] hover:bg-[#EFE9DC]"
        )}
      >
        <span className="font-display text-lg leading-none text-[#2B2620]">
          {row.machine.label.replace("HD-", "")}
        </span>
        <span className="smallcaps-detail text-[9px] tracking-[0.15em] text-[#8A7A5F]">
          Vacant
        </span>
        {isStaff && (
          <Plus className="absolute right-1 top-1 h-3 w-3 text-[#8A7A5F] opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </button>
    );
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="bottom">
          {row.machine.label} · {row.machine.location}
        </TooltipContent>
      </Tooltip>
    );
  }

  const session = row.session!;

  return (
    <div
      className={cn(
        "relative flex h-14 w-full flex-col items-center justify-center gap-0.5 border text-center",
        urgent
          ? "border-[#A03A25] bg-[#A03A25] text-[#F6F1E7]"
          : "border-[#4E7A48] bg-[#4E7A48] text-[#F6F1E7]"
      )}
    >
      {done && (
        <span className="absolute left-1 top-0.5">
          <AlertTriangle className="h-2.5 w-2.5 text-[#F2C9B8]" />
        </span>
      )}
      <span className="font-display text-lg leading-none">
        {row.machine.label.replace("HD-", "")}
      </span>
      <span className="flex items-center gap-1 text-[9px] leading-tight">
        <span className="font-mono tabular-nums">
          {countdownMs === null ? "--:--" : formatHMS(countdownMs)}
        </span>
        {session.isolationTag === "dirty" && (
          <Droplets className="h-2.5 w-2.5 text-[#E8C396]" />
        )}
        {urgent && <BellRing className="h-2.5 w-2.5" />}
      </span>

      {isStaff && (
        <div className="absolute right-0.5 top-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`Actions for machine ${row.machine.label}`}
                className="rounded-sm p-0.5 text-[#F6F1E7]/70 hover:bg-[#F6F1E7]/20"
              >
                <MoreVertical className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="smallcaps-detail text-muted-foreground">
                {row.machine.label} · {row.machine.location}
              </DropdownMenuLabel>
              <DropdownMenuItem className="text-[13px]">
                <Activity className="mr-2 h-4 w-4" />
                Patient {session.patientId} · {durationLabel(session.durationMinutes)} · started{" "}
                {new Date(session.startedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </DropdownMenuItem>
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

/**
 * A floor band: heading line with floor name, machine counts, and one
 * continuous horizontal row of machine chips.
 */
export function FloorRow({
  floorName,
  machines,
  floorStats,
  onAssign,
}: {
  floorName: string;
  machines: MachineWithSession[];
  floorStats: { occupied: number; urgent: number; dirty: number };
  onAssign: (machineId: number) => void;
}) {
  return (
    <div className="border border-[#D9CFBA]/80 bg-[#FDF9F0]">
      {/* Floor heading */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D9CFBA]/60 bg-[#F6F1E7]/60 px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <h3 className="font-display text-2xl text-[#2B2620]">{floorName}</h3>
          <span className="smallcaps-detail text-[#8A7A5F]">
            {machines.length} machine{machines.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <span className="smallcaps-detail text-[#8A7A5F]">
            <span className="font-display text-base text-[#4E7A48]">
              {machines.length - floorStats.occupied}
            </span>{" "}
            vacant
          </span>
          <span className="smallcaps-detail text-[#8A7A5F]">
            <span className="font-display text-base text-[#2B2620]">
              {floorStats.occupied}
            </span>{" "}
            in use
          </span>
          {floorStats.urgent > 0 && (
            <span className="smallcaps-detail text-[#A03A25]">
              <span className="font-display text-base">{floorStats.urgent}</span>{" "}
              urgent
            </span>
          )}
          {floorStats.dirty > 0 && (
            <span className="smallcaps-detail text-[#A0562F]">
              <span className="font-display text-base">{floorStats.dirty}</span>{" "}
              dirty
            </span>
          )}
        </div>
      </div>

      {/* Machine row */}
      <div className="grid grid-cols-4 gap-1.5 p-2.5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
        {machines.map(row => (
          <FloorMachineChip
            key={row.machine.id}
            row={row}
            onAssign={onAssign}
          />
        ))}
      </div>
    </div>
  );
}
