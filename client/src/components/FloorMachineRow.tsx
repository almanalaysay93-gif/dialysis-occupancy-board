import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCanWrite } from "@/hooks/useCanWrite";
import { trpc } from "@/lib/trpc";
import RenameMachineDialog from "@/components/RenameMachineDialog";
import RenameSessionLabelDialog from "@/components/RenameSessionLabelDialog";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, BellRing, Clock, Droplets, FilePenLine, MoreVertical, Pause, Play, Pencil, Plus, Power, Boxes, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { MachineWithSession } from "../../../server/machines";

/** Global drag payload registry so any board can receive a dragged tile. */
const DRAG_KEY = "skti-machine-swap";

export function readDraggedMachineId(dt: DataTransfer | null): number | null {
  const raw = dt?.getData(DRAG_KEY) ?? "";
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

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
  const utils = trpc.useUtils();
  // Staff actions: OAuth session OR nurse/supervisor staff session (guest read-only).
  const { canWrite: isStaff } = useCanWrite();
  const occupied = row.session !== null;
  const urgent = row.session?.urgent ?? false;
  const isPaused = Boolean(row.session?.pausedAt);
  // While paused the countdown is frozen at the remaining time snapshot; the
  // server shifts endsAt on resume so all clients stay consistent.
  const effectiveEndsAt =
    isPaused && row.session?.pausedAt
      ? new Date((row.session.endsAt.getTime() + row.session.pausedSeconds * 1000))
      : row.session?.endsAt ?? null;
  const countdownMs = useCountdown(effectiveEndsAt);
  const totalMs = (row.session?.durationMinutes ?? 0) * 60 * 1000;
  const done = countdownMs === 0;
  const [renameOpen, setRenameOpen] = useState(false);
  const [sessionLabelOpen, setSessionLabelOpen] = useState(false);
  const [isDragSource, setIsDragSource] = useState(false);

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

  const togglePause = trpc.sessions.togglePause.useMutation({
    onSuccess: () => void utils.machines.list.invalidate(),
    onError: e => toast.error(e.message),
  });

  const setRepairFlag = trpc.sessions.setRepairFlag.useMutation({
    onMutate: async vars => {
      await utils.machines.list.cancel();
      const prev = utils.machines.list.getData();
      utils.machines.list.setData(undefined, old =>
        old?.map(r =>
          r.session?.id === vars.sessionId
            ? {
                ...r,
                session: { ...r.session, needsRepairAfterSession: vars.flag },
              }
            : r,
        ),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) utils.machines.list.setData(undefined, ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => void utils.machines.list.invalidate(),
  });

  /** Drag-and-drop swap: vacant chips are draggable (source) and accept drops
   *  from other vacant chips on any board — the server enforces RBAC and the
   *  both-vacant constraint. */
  const swapMachine = trpc.machines.swap.useMutation({
    onSuccess: async () => {
      await utils.machines.list.invalidate();
      toast.success("Machines rearranged");
    },
    onError: e => toast.error(e.message || "Could not swap the machines"),
  });

  /** Send this (vacant) machine to Backup or Repair storage. */
  const sendToStorage = trpc.machines.setStatus.useMutation({
    onSuccess: async (_v, vars) => {
      await Promise.all([
        utils.machines.list.invalidate(),
        utils.machines.offboarded.list.invalidate(),
      ]);
      toast.success(`${row.machine.label} moved to ${vars.status} storage`);
    },
    onError: e => toast.error(e.message || `Could not move ${row.machine.label}`),
  });



  if (!occupied) {
    const chipContent = (
      <button
        type="button"
        onClick={() => isStaff && onAssign(row.machine.id)}
        disabled={!isStaff}
        aria-label={`Assign a session to machine ${row.machine.label}`}
        title={`${row.machine.label} · ${row.machine.location}`}
        draggable={isStaff}
        onDragStart={e => {
          if (!isStaff) return;
          setIsDragSource(true);
          // text/plain guarantees Chrome/Firefox/Safari all register the
          // payload in e.dataTransfer.types; the custom key lets us tell
          // our own tiles apart from ordinary text drags.
          e.dataTransfer.setData("text/plain", String(row.machine.id));
          e.dataTransfer.setData(DRAG_KEY, String(row.machine.id));
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setIsDragSource(false)}
        onDragOver={e => {
          if (!isStaff) return;
          // Accept our own tiles unconditionally — the server still enforces
          // RBAC and the both-vacant constraint on the actual swap.
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={e => {
          if (!isStaff) return;
          const srcId = readDraggedMachineId(e.dataTransfer);
          if (srcId === null || srcId === row.machine.id) return;
          e.preventDefault();
          swapMachine.mutate({ machineAId: srcId, machineBId: row.machine.id });
        }}
        className={cn(
          "group flex h-14 w-full flex-col items-center justify-center gap-0.5 border border-[#D4DFE5]/70 bg-[#FBFCFD] text-center transition-all",
          isStaff && !isDragSource && "cursor-grab hover:border-[#7684A0] hover:bg-[#E8EFF1]",
          isDragSource && "cursor-grabbing border-[#2E9A9B] bg-[#E8F4F4] opacity-70",
          swapMachine.isPending && "pointer-events-none opacity-60"
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
        {chipContent}
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
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuLabel className="smallcaps-detail text-muted-foreground">
                {row.machine.label}
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setRenameOpen(true)} className="text-[13px]">
                <Pencil className="mr-2 h-4 w-4" />
                Edit machine number
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-[13px]"
                onClick={() => sendToStorage.mutate({ machineId: row.machine.id, status: "backup" })}
              >
                <Boxes className="mr-2 h-4 w-4" />
                Send to Backup
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-[13px]"
                onClick={() => sendToStorage.mutate({ machineId: row.machine.id, status: "repair" })}
              >
                <Wrench className="mr-2 h-4 w-4" />
                Send to Repair
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
          ? "tile-urgent-pulse border-[#9E1F2B] bg-[#9E1F2B] text-[#F4F7F8]"
          : "border-[#3E8A6A] bg-[#3E8A6A] text-[#F4F7F8]"
      )}
    >
      {done && (
        <span className="absolute left-1 top-0.5">
          <AlertTriangle className="h-2.5 w-2.5 text-[#F3D9DA]" />
        </span>
      )}
      <span className="font-display text-lg leading-none">
        {session.displayLabel
          ? session.displayLabel.replace("HD-", "").slice(0, 14)
          : row.machine.label.replace("HD-", "")}
      </span>
      {session.displayLabel && (
        <span className="text-[8px] uppercase tracking-[0.12em] opacity-70">
          {row.machine.label.replace("HD-", "")}
        </span>
      )}
      <span className="flex items-center gap-1 text-[9px] leading-tight">
        <span className={cn("font-mono tabular-nums", isPaused && "animate-pulse text-[#F3D9DA]")}>
          {countdownMs === null ? "--:--" : formatHMS(countdownMs)}
        </span>
        {session.isolationTag === "dirty" && (
          <Droplets className="h-2.5 w-2.5 text-[#CDE4E4]" />
        )}
        {urgent && <BellRing className="h-2.5 w-2.5" />}
      </span>
      {isPaused && (
        <span className="absolute left-1 top-0.5 flex items-center gap-0.5 text-[8px] uppercase tracking-[0.1em] text-[#F3D9DA]">
          <Pause className="h-2 w-2" /> Paused
        </span>
      )}

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
              {isStaff && (
                <DropdownMenuItem
                  className="text-[13px]"
                  onClick={() => setSessionLabelOpen(true)}
                >
                  <FilePenLine className="mr-2 h-4 w-4" />
                  Edit highlighted title
                </DropdownMenuItem>
              )}
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
                  setRepairFlag.mutate({
                    sessionId: session.id,
                    flag: !session.needsRepairAfterSession,
                  })
                }
                className="text-[13px]"
              >
                <Wrench className="mr-2 h-4 w-4" />
                {session.needsRepairAfterSession
                  ? "Clear repair flag"
                  : "Flag for repair"}
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
              <DropdownMenuItem
                onClick={() => togglePause.mutate({ sessionId: session.id, paused: !isPaused })}
                className="text-[13px]"
              >
                {isPaused ? (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Resume timer
                  </>
                ) : (
                  <>
                    <Pause className="mr-2 h-4 w-4" />
                    Pause timer
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => endSession.mutate({ sessionId: session.id })}
                className="text-[13px] text-destructive focus:text-destructive"
              >
                <Power className="mr-2 h-4 w-4" />
                End session
                {session.needsRepairAfterSession && " · sends machine to repair"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        </>
      )}
      <RenameSessionLabelDialog
        open={sessionLabelOpen}
        sessionId={session.id}
        machineLabel={row.machine.label}
        currentLabel={session.displayLabel}
        onClose={() => setSessionLabelOpen(false)}
      />
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
