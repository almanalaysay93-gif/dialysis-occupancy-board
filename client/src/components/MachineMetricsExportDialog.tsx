import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Activity, FileDown, FileSpreadsheet, Loader2, ShieldAlert } from "lucide-react";

interface MachineMetricsExportDialogProps {
  open: boolean;
  onClose: () => void;
  machineId?: number;
  machineLabel?: string;
  floorId?: number;
  floorName?: string;
}

/** ISO date (YYYY-MM-DD) of an instant in Asia/Manila time — the board's clock.
 *  toISOString() would resolve to yesterday for every Manila morning. */
function manilaDate(at: Date) {
  return at.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

/** Widest window the server accepts; keep the presets inside it. */
const MAX_RANGE_DAYS = 92;

function datesForRange(days: number) {
  const end = new Date();
  const start = new Date();
  if (days > 0) start.setDate(end.getDate() - days);
  return { start: manilaDate(start), end: manilaDate(end) };
}

export function MachineMetricsExportDialog({
  open,
  onClose,
  machineId,
  machineLabel,
  floorId,
  floorName,
}: MachineMetricsExportDialogProps) {
  const [startDate, setStartDate] = useState(() => datesForRange(30).start);
  const [endDate, setEndDate] = useState(() => datesForRange(30).end);

  // Reopening the dialog days later must not offer the range it was closed on.
  useEffect(() => {
    if (!open) return;
    const fresh = datesForRange(30);
    setStartDate(fresh.start);
    setEndDate(fresh.end);
  }, [open]);

  const rangeSpanDays =
    startDate && endDate
      ? (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000
      : Number.NaN;
  const rangeIsValid = startDate <= endDate && rangeSpanDays >= 0 && rangeSpanDays < MAX_RANGE_DAYS;

  const isBulk = machineId === undefined;
  const title = isBulk
    ? `Export Floor Metrics · ${floorName ?? "All Floors"}`
    : `Export Machine Metrics · ${machineLabel ?? "Machine"}`;

  // Fetch summary preview while dialog is open
  const { data: report, isLoading: previewLoading } = trpc.machines.metrics.useQuery(
    {
      machineId,
      floorId,
      startDate,
      endDate,
    },
    {
      // Date inputs fire per keystroke; skip ranges the server would reject.
      enabled: open && Boolean(startDate) && Boolean(endDate) && rangeIsValid,
    }
  );

  const exportMutation = trpc.machines.exportExcel.useMutation({
    onSuccess: data => {
      try {
        const byteCharacters = atob(data.base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = data.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        toast.success(`Downloaded ${data.filename}`);
        onClose();
      } catch {
        toast.error("Failed to parse downloaded Excel file.");
      }
    },
    onError: err => {
      toast.error(err.message || "Failed to generate Excel report.");
    },
  });

  const handleDownload = () => {
    if (!startDate || !endDate) {
      toast.error("Please specify both start and end dates.");
      return;
    }
    if (startDate > endDate) {
      toast.error("Start date must be before or equal to end date.");
      return;
    }
    if (rangeSpanDays >= MAX_RANGE_DAYS) {
      toast.error(`Date range cannot exceed ${MAX_RANGE_DAYS} days.`);
      return;
    }
    exportMutation.mutate({
      machineId,
      floorId,
      startDate,
      endDate,
    });
  };

  const setRangePreset = (days: number) => {
    const range = datesForRange(days);
    setStartDate(range.start);
    setEndDate(range.end);
  };

  // Aggregated preview stats
  const totalSessions = report?.machines.reduce((acc, m) => acc + m.totalSessions, 0) ?? 0;
  const totalTreatmentHrs = report
    ? (report.machines.reduce((acc, m) => acc + m.totalTreatmentMinutes, 0) / 60).toFixed(1)
    : "0.0";
  const totalIdleHrs = report
    ? (report.machines.reduce((acc, m) => acc + m.totalIdleMinutes, 0) / 60).toFixed(1)
    : "0.0";
  const totalRepairs = report?.machines.reduce((acc, m) => acc + m.repairs.length, 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={isOpen => !isOpen && onClose()}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <FileSpreadsheet className="h-5 w-5" />
            <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Generate an official Excel (.xlsx) workbook containing utilization hours, treatment sessions, patient tickets, nurse logs, and repair history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Quick preset buttons */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground mr-1">Quick Range:</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 text-[11px] px-2"
              onClick={() => setRangePreset(0)}
            >
              Today
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 text-[11px] px-2"
              onClick={() => setRangePreset(7)}
            >
              Last 7 Days
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 text-[11px] px-2"
              onClick={() => setRangePreset(30)}
            >
              Last 30 Days
            </Button>
          </div>

          {/* Date range inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="start-date" className="text-xs font-medium">
                Start Date
              </Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="end-date" className="text-xs font-medium">
                End Date
              </Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Metrics preview card */}
          <Card className="border border-slate-200 bg-slate-50/50 shadow-none">
            <CardContent className="p-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 mb-2">
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                  <Activity className="h-3.5 w-3.5 text-primary" />
                  Metrics Preview ({report?.machines.length ?? 0} machine{report?.machines.length === 1 ? "" : "s"})
                </span>
                {previewLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-white p-2 rounded border border-slate-200/60">
                  <div className="text-[11px] text-muted-foreground">Sessions</div>
                  <div className="text-sm font-bold text-slate-800">{totalSessions}</div>
                </div>
                <div className="bg-white p-2 rounded border border-slate-200/60">
                  <div className="text-[11px] text-muted-foreground">Treatment</div>
                  <div className="text-sm font-bold text-slate-800">{totalTreatmentHrs}h</div>
                </div>
                <div className="bg-white p-2 rounded border border-slate-200/60">
                  <div className="text-[11px] text-muted-foreground">Idle Time</div>
                  <div className="text-sm font-bold text-slate-800">{totalIdleHrs}h</div>
                </div>
                <div className="bg-white p-2 rounded border border-slate-200/60">
                  <div className="text-[11px] text-muted-foreground">Repairs</div>
                  <div className="text-sm font-bold text-slate-800">{totalRepairs}</div>
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3 text-amber-500" />
                  PHI: {report?.canSeePhi ? "Staff Unmasked" : "Masked Tickets (Kiosk Safe)"}
                </span>
                <span className="text-[10px] text-slate-400">Cached 60 s TTL</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={exportMutation.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleDownload}
            disabled={exportMutation.isPending}
            className="gap-1.5"
          >
            {exportMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating Excel...
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4" />
                Download Excel (.xlsx)
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
