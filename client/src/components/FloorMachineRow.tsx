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
import RenameMachineDialog from "@/components/RenameMachineDialog";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, BellRing, Clock, Droplets, MoreVertical, Pencil, Plus, Power } from "lucide-react";
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
  if (min === 240) return "4 h";
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
  const [renameOpen, setRenameOpen] = useState(false);

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
    const chipContent = (
      <button
        onClick={() => isStaff && onAssign(row.machine.id)}
        disabled={!isStaff}
        aria-label={`Assign a session to machine ${row.machine.label}`}
        className={cn(
          "group flex h-14 w-full flex-col items-center justify-center gap-0.5 border border-[#D4DFE5]/70 bg-[#FBFCFD] text-center transition-all",
          isStaff && "hover:border-[#7684A0] hover:bg-[#E8EFF1]"
        )}
      >
        <span className="font-display text-lg leading-none text-[#1F2A52]">
          {row.machine.label.replace("HD-", "")}
        </span>
        <span className="smallcaps-detail text-[9px] tracking-[0.15em] text-[#7684A0]">
          Vacant
        </span>
      </button>
    );
    return (
      <div className="group relative h-14">
        <Tooltip>
          <TooltipTrigger asChild>{chipContent}</TooltipTrigger>
          <TooltipContent side="bottom">
            {row.machine.label} · {row.machine.location}
          </TooltipContent>
        </Tooltip>
        {isStaff && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`Actions for machine ${row.machine.label}`}
                className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-sm border border-[#D4DFE5]/70 bg-[#FBFCFD] opacity-0 transition-opacity hover:bg-[#E8EFF1] group-hover:opacity-100"
              >
                <MoreVertical className="h-2.5 w-2.5 text-[#7684A0]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuLabel className="smallcaps-detail text-muted-foreground">
                {row.machine.label}
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setRenameOpen(true)} className="text-[13px]">
                <Pencil className="mr-2 h-4 w-4" />
                Edit machine number
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <RenameMachineDialog
          open={renameOpen}
          machineId={row.machine.id}
          machineLabel={row.machine.label}
          onClose={() => setRenameOpen(false)}
        />
      </div>
    );
  }

  const session = row.session!;

  return (
    <div
      className={cn(
        "relative flex h-14 w-full flex-col items-center justify-center gap-0.5 border text-center",
        urgent
          ? "border-[#9E1F2B] bg-[#9E1F2B] text-[#F4F7F8]"
          : "border-[#3E8A6A] bg-[#3E8A6A] text-[#F4F7F8]"
      )}
    >
      {done && (
        <span className="absolute left-1 top-0.5">
          <AlertTriangle className="h-2.5 w-2.5 text-[#F3D9DA]" />
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
          <Droplets className="h-2.5 w-2.5 text-[#CDE4E4]" />
        )}
        {urgent && <BellRing className="h-2.5 w-2.5" />}
      </span>

      {isStaff && (
        <>
          <div className="absolute right-0.5 top-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`Actions for machine ${row.machine.label}`}
                  className="rounded-sm p-0.5 text-[#F4F7F8]/70 hover:bg-[#F4F7F8]/20"
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
        </>
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
    <div className="border border-[#D4DFE5]/80 bg-[#FBFCFD]">
      {/* Floor heading */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D4DFE5]/60 bg-[#F4F7F8]/60 px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <h3 className="font-display text-2xl text-[#1F2A52]">{floorName}</h3>
          <span className="smallcaps-detail text-[#7684A0]">
            {machines.length} machine{machines.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <span className="smallcaps-detail text-[#7684A0]">
            <span className="font-display text-base text-[#3E8A6A]">
              {machines.length - floorStats.occupied}
            </span>{" "}
            vacant
          </span>
          <span className="smallcaps-detail text-[#7684A0]">
            <span className="font-display text-base text-[#1F2A52]">
              {floorStats.occupied}
            </span>{" "}
            in use
          </span>
          {floorStats.urgent > 0 && (
            <span className="smallcaps-detail text-[#9E1F2B]">
              <span className="font-display text-base">{floorStats.urgent}</span>{" "}
              urgent
            </span>
          )}
          {floorStats.dirty > 0 && (
            <span className="smallcaps-detail text-[#2E9A9B]">
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
