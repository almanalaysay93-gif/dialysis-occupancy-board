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
            <section>
              <Card className="border-[#E2E8F0]">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Boxes className="h-5 w-5 text-[#2563EB]" />
                    Backup Machines
                    <Badge variant="secondary" className="ml-auto font-sans">
                      {backupMachines.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {backupMachines.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      No backup machines in storage. Send one here from any board.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {backupMachines.map(m => (
                        <MachineRow key={m.id} m={m} onReturn={() => openReturn(m)} />
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </section>

            <section>
              <Card className="border-[#F3D8DC]">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Wrench className="h-5 w-5 text-[#C0392B]" />
                    Machines in Repair
                    <Badge variant="secondary" className="ml-auto font-sans">
                      {repairMachines.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {repairMachines.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      No machines under repair right now.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {repairMachines.map(m => (
                        <MachineRow key={m.id} m={m} onReturn={() => openReturn(m)} />
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </section>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Tip: on any floor board, use the tile menu to send a machine to Backup or Repair. Machines in
          treatment cannot be moved — end the session first.
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
