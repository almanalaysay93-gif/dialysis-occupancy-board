import DashboardLayout from "@/components/DashboardLayout";
import ShiftHandoffPanel from "@/components/ShiftHandoffPanel";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Layers } from "lucide-react";

export default function ShiftEndorsementPage() {
  const { data: floors } = trpc.machines.listFloors.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const [selectedFloorId, setSelectedFloorId] = useState<number | undefined>(undefined);

  const selectedFloor = floors?.find(f => f.id === selectedFloorId);

  return (
    <DashboardLayout>
      <div className="w-full px-4 sm:px-6 py-6 space-y-6">
        {/* Top Header & Floor Selector */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#D4DFE5] pb-4">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A52] font-bold">
              Shift Handoff &amp; Clinical Endorsement
            </h1>
            <p className="font-serif-light text-[#556680] text-sm sm:text-base mt-1">
              Official SBAR nursing shift handover for SPMCKTI Hemodialysis unit.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Layers className="h-3.5 w-3.5" /> Scope:
            </span>
            <select
              value={selectedFloorId ?? ""}
              onChange={e =>
                setSelectedFloorId(e.target.value ? Number(e.target.value) : undefined)
              }
              className="h-9 rounded-md border text-xs px-3 bg-background font-medium"
            >
              <option value="">All Floor Units (Master Unit Endorsement)</option>
              {floors?.map(f => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* The Endorsement Panel */}
        <ShiftHandoffPanel
          floorId={selectedFloorId}
          floorName={selectedFloor?.name ?? "All Floors"}
        />
      </div>
    </DashboardLayout>
  );
}
