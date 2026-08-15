import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OffboardedMachine } from "../../../server/machines";
import { trpc } from "@/lib/trpc";
import { Boxes, RefreshCw, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { readDraggedMachineId } from "@/components/FloorMachineRow";


export default function BackupRepair() {
  const utils = trpc.useUtils();
  const { data: offboarded = [], isLoading } = trpc.machines.offboarded.list.useQuery(undefined, {
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
  const { data: floors = [] } = trpc.machines.listFloors.useQuery(undefined, {
    staleTime: 60_000,
  });

  const [returning, setReturning] = useState<OffboardedMachine | null>(null);
  const [returnFloorId, setReturnFloorId] = useState<number | null>(null);
  const [dragTarget, setDragTarget] = useState<"backup" | "repair" | null>(null);

  /** Drop a dragged vacant tile onto the Backup or Repair card to park it. */
  const setStorage = trpc.machines.setStatus.useMutation({
    onSuccess: async (_v, vars) => {
      await Promise.all([utils.machines.offboarded.list.invalidate(), utils.machines.list.invalidate()]);
      toast.success(`Machine moved to ${vars.status} storage`);
      setDragTarget(null);
    },
    onError: err => {
      toast.error(err.message || "Could not move the machine");
      setDragTarget(null);
    },
  });

  const setStatus = trpc.machines.setStatus.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.machines.offboarded.list.invalidate(), utils.machines.list.invalidate()]);
      toast.success("Machine moved back to the board");
      setReturning(null);
    },
    onError: err => toast.error(err.message || "Could not move the machine"),
  });

  const backupMachines = offboarded.filter(m => m.status === "backup");
  const repairMachines = offboarded.filter(m => m.status === "repair");

  const openReturn = (m: OffboardedMachine) => {
    setReturning(m);
    // Default to the machine's last floor if it has one, else first floor.
    // offboarded machines keep their floorId so they return to their board.
    setReturnFloorId(m.floorId ? Number(m.floorId) : floors[0]?.id ?? null);
  };

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div>
          <h1 className="font-display text-3xl tracking-tight text-foreground">Backup &amp; Repair</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Machines taken off the floor boards — swap in a backup or send a machine to repair from any board.
          </p>
        </div>

        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2">
            {[0, 1].map(i => (
              <Card key={i}>
                <CardHeader>
                  <div className="h-6 w-40 rounded bg-muted animate-pulse" />
                </CardHeader>
                <CardContent>
                  <div className="h-24 rounded bg-muted animate-pulse" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <DropCard
              type="backup"
              count={backupMachines.length}
              active={dragTarget === "backup"}
              onDragOver={e => {
                // Accept any drag — the server still enforces RBAC and the
                // vacant-machine constraint on the actual move.
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragTarget("backup");
              }}
              onDragLeave={e => {
                // relatedTarget inside the card keeps firing leave — only
                // clear when leaving the whole section.
                const sec = (e.currentTarget as HTMLElement).closest("section");
                const related = e.relatedTarget as Node | null;
                if (!sec?.contains(related)) setDragTarget(null);
              }}
              onDrop={e => {
                e.preventDefault();
                setDragTarget(null);
                const id = readDraggedMachineId(e.dataTransfer);
                if (id !== null) setStorage.mutate({ machineId: id, status: "backup" });
              }}
              title={
                <>
                  <Boxes className="h-5 w-5 text-[#2563EB]" />
                  Backup Machines
                </>
              }
              emptyText="No backup machines in storage. Drag a vacant machine here, or use the tile menu on any board."
            >
              {backupMachines.map(m => (
                <MachineRow key={m.id} m={m} onReturn={() => openReturn(m)} />
              ))}
            </DropCard>

            <DropCard
              type="repair"
              count={repairMachines.length}
              active={dragTarget === "repair"}
              onDragOver={e => {
                // Accept any drag — the server still enforces RBAC and the
                // vacant-machine constraint on the actual move.
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragTarget("repair");
              }}
              onDragLeave={e => {
                const sec = (e.currentTarget as HTMLElement).closest("section");
                const related = e.relatedTarget as Node | null;
                if (!sec?.contains(related)) setDragTarget(null);
              }}
              onDrop={e => {
                e.preventDefault();
                setDragTarget(null);
                const id = readDraggedMachineId(e.dataTransfer);
                if (id !== null) setStorage.mutate({ machineId: id, status: "repair" });
              }}
              title={
                <>
                  <Wrench className="h-5 w-5 text-[#C0392B]" />
                  Machines in Repair
                </>
              }
              emptyText="No machines under repair right now. Drag a vacant machine here to send it for repair."
            >
              {repairMachines.map(m => (
                <MachineRow key={m.id} m={m} onReturn={() => openReturn(m)} />
              ))}
            </DropCard>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Tip: drag a vacant machine tile onto either card to park it — Backup Machines or Machines in
          Repair. Machines in treatment cannot be moved — end the session first. You can also use the
          tile menu (⋮) on any board.
        </p>
      </div>

      <Dialog open={!!returning} onOpenChange={o => !o && setReturning(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Return {returning?.label} to a board</DialogTitle>
            <DialogDescription>
              The machine will be marked Active and placed back on the chosen floor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="br-floor">Floor board</Label>
            <Select
              value={returnFloorId !== null ? String(returnFloorId) : undefined}
              onValueChange={v => setReturnFloorId(Number(v))}
            >
              <SelectTrigger id="br-floor">
                <SelectValue placeholder="Choose a floor" />
              </SelectTrigger>
              <SelectContent>
                {floors.map(f => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturning(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                returning &&
                returnFloorId !== null &&
                setStatus.mutate({ machineId: returning.id, status: "active", floorId: returnFloorId })
              }
              disabled={setStatus.isPending || returnFloorId === null}
              className="bg-primary text-primary-foreground"
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Return to board
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function DropCard({
  type,
  count,
  active,
  onDragOver,
  onDragLeave,
  onDrop,
  title,
  emptyText,
  children,
}: {
  type: "backup" | "repair";
  count: number;
  active: boolean;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  title: React.ReactNode;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <Card
        className={
          active
            ? "border-[#2E9A9B] ring-2 ring-[#2E9A9B]/40 transition-all"
            : type === "backup"
              ? "border-[#E2E8F0] transition-colors"
              : "border-[#F3D8DC] transition-colors"
        }
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">{title}</CardTitle>
          <Badge variant="secondary" className="ml-auto font-sans">
            {count}
          </Badge>
        </CardHeader>
        <div
          className="rounded-b-md transition-colors"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {active && (
            <div className="mx-4 mt-2 border-2 border-dashed border-[#2E9A9B] rounded-md py-3 text-center text-sm text-[#2E9A9B]">
              Drop here to park the machine{type === "repair" ? " for repair" : " as backup"}
            </div>
          )}
          <CardContent>
            {count === 0 && !active ? (
              <p className="text-sm text-muted-foreground py-6 text-center">{emptyText}</p>
            ) : (
              <ul className="space-y-2">{children}</ul>
            )}
          </CardContent>
        </div>
      </Card>
    </section>
  );
}

function MachineRow({ m, onReturn }: { m: OffboardedMachine; onReturn: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground truncate">{m.label}</p>
        <p className="text-xs text-muted-foreground truncate">
          {m.location}
          {m.statusNote ? ` · ${m.statusNote}` : ""}
        </p>
      </div>
      <Badge
        variant={m.status === "repair" ? "destructive" : "secondary"}
        className="font-sans shrink-0"
      >
        {m.status === "backup" ? "Backup" : "Repair"}
      </Badge>
      <Button variant="outline" size="sm" onClick={onReturn} className="shrink-0">
        <RefreshCw className="h-3.5 w-3.5 mr-1" />
        Return
      </Button>
    </li>
  );
}
