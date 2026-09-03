import { useEffect, useMemo, useRef, useState } from "react";
import { PenLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";

export const REPORT_PERIODS: { key: string; label: string }[] = [
  { key: "session1", label: "Session 1 · 5:00 – 10:00 AM" },
  { key: "transition1", label: "Transition 1 · Hooking & Terminating · 9:00 – 11:00 AM" },
  { key: "session2", label: "Session 2 · 10:00 AM – 2:00 PM" },
  { key: "transition2", label: "Transition 2 · Hooking & Terminating · 1:00 – 3:00 PM" },
  { key: "session3", label: "Session 3 · 2:00 – 6:00 PM" },
  { key: "transition3", label: "Transition 3 · Hooking & Terminating · 5:00 – 8:00 PM" },
  { key: "session4", label: "Session 4 · 6:00 – 10:00 PM" },
];

export const REPORT_SHIFTS: { key: string; label: string }[] = [
  { key: "05-13", label: "5:00 AM – 1:00 PM" },
  { key: "13-21", label: "1:00 – 9:00 PM" },
  { key: "21-05", label: "9:00 PM – 5:00 AM" },
  { key: "07-15", label: "7:00 AM – 3:00 PM" },
  { key: "15-23", label: "3:00 – 11:00 PM" },
  { key: "23-07", label: "11:00 PM – 7:00 AM" },
];

/**
 * Charge-nurse narrative report: shared between the board pages (editable,
 * nurses write it during the shift) and the End of Day Report (read-only
 * reflection of what was written).
 */
export function NarrativeReport({
  floorId,
  floorName,
  date,
  staff,
  editable,
  entries,
}: {
  floorId: number;
  floorName: string;
  date: string;
  staff: { role: string; displayName?: string | null; name?: string } | null;
  editable: boolean;
  /** Pre-fetched narratives for this floor (supervisor bulk call). Skips its own query. */
  entries?: { id: number; periodKey: string; shiftKey: string | null; author: string; body: string; updatedAt: Date }[];
}) {
  if (!floorId) return null;
  const utils = trpc.useUtils();
  const { data: narratives, isLoading, isError, error } = trpc.narratives.list.useQuery(
    { floorId, reportDate: date },
    { refetchInterval: editable ? 15_000 : false, enabled: entries === undefined }
  );
  const resolvedNarratives = entries ?? narratives;
  const createMutation = trpc.narratives.create.useMutation({
    onSuccess: () => {
      toast.success("Narrative saved");
      void utils.narratives.list.invalidate({ floorId, reportDate: date });
    },
    onError: e => toast.error(e.message),
  });
  const updateMutation = trpc.narratives.update.useMutation({
    onSuccess: () => {
      toast.success("Narrative updated");
      void utils.narratives.list.invalidate({ floorId, reportDate: date });
    },
    onError: e => toast.error(e.message),
  });
  const removeMutation = trpc.narratives.remove.useMutation({
    onSuccess: () => {
      toast.success("Narrative removed");
      void utils.narratives.list.invalidate({ floorId, reportDate: date });
    },
    onError: e => toast.error(e.message),
  });

  // Charge nurses write the board narratives; supervisors only view them.
  const canWriteBoard = editable && staff?.role !== "supervisor";

  const [openPeriod, setOpenPeriod] = useState<string | null>(null);
  const [openShift, setOpenShift] = useState<string>("05-13");
  const [openAuthor, setOpenAuthor] = useState(() => staff?.displayName ?? "");
  // Entry being edited in the inline form — updates instead of creating.
  const [editEntry, setEditEntry] = useState<{
    id: number;
    periodKey: string;
    author: string;
    body: string;
  } | null>(null);
  // Draft auto-save: the writer's draft survives form close, refresh, and
  // device restarts; cleared only on a successful save.
  const draftKey = useMemo(
    () => `narrative-board-draft:${floorId}:${date}`,
    [floorId, date]
  );
  const [openBody, setOpenBody] = useState(() => {
    try {
      return localStorage.getItem(draftKey) ?? "";
    } catch {
      return "";
    }
  });
  const draftSaved = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, openBody);
        draftSaved.current = true;
      } catch {
        draftSaved.current = false;
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [openBody, draftKey]);

  const entriesByPeriod = useMemo(() => {
    const map = new Map<string, { id: number; periodKey: string; shiftKey: string | null; author: string; body: string; updatedAt: Date }>();
    (resolvedNarratives ?? []).forEach(n => map.set(n.periodKey, n as never));
    return map;
  }, [resolvedNarratives]);

  const authorName = staff?.displayName ?? "";
  if (!authorName && openAuthor === "") setOpenAuthor("");

  return (
    <Card className="glass-panel print:bg-white print:backdrop-none print:shadow-none print:border print:border-[#D4DFE5] print:break-inside-avoid">
      <CardHeader className="border-b border-[#D4DFE5]/70 pb-4">
        <div className="flex items-center gap-2">
          <PenLine className="h-4 w-4 text-[#2E9A9B]" />
          <CardTitle className="font-display text-lg text-[#1F2A52]">
            Narrative Report · {floorName}
          </CardTitle>
        </div>
        <p className="text-xs text-[#556680]">
          {canWriteBoard
            ? "Charge nurse narratives for each session and hooking/terminating transition of the day — write during the shift."
            : "Charge nurse narratives recorded for this day — supervisors view only."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : isError ? (
          <p className="px-3.5 py-3 text-xs text-[#9E1F2B]">
            Narratives could not be loaded ({String(error?.message ?? "network error")}) — try signing in as clinical staff or refresh the page.
          </p>
        ) : !canWriteBoard && resolvedNarratives !== undefined ? (
          // Read-only rendering for supervisors / anyone without write rights.
          REPORT_PERIODS.map(period => {
            const entry = entriesByPeriod.get(period.key);
            return (
              <div
                key={period.key}
                className="rounded-sm border border-[#D4DFE5] bg-[#FBFCFD] py-2"
              >
                {entry ? (
                  <div className="flex items-start justify-between gap-3 px-3.5 py-3">
                    <div>
                      <p className="font-serif-light text-[13px] font-semibold text-[#1F2A52]">
                        {period.label}
                      </p>
                      {entry.shiftKey && (
                        <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-[#7684A0]">
                          Shift {REPORT_SHIFTS.find(s => s.key === entry.shiftKey)?.label ?? entry.shiftKey}
                        </p>
                      )}
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#556680]">
                        {entry.body}
                      </p>
                      <p className="mt-1.5 text-[10px] text-[#7684A0]">
                        by {entry.author} · updated{" "}
                        {new Date(entry.updatedAt).toLocaleString([], { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    {canWriteBoard && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-[#2E9A9B]/50 text-[#1d6b6c]"
                          onClick={() => {
                            setOpenPeriod(period.key);
                            setEditEntry({ id: entry.id, periodKey: period.key, author: entry.author, body: entry.body });
                            setOpenBody(entry.body);
                            setOpenAuthor(entry.author);
                            setOpenShift(entry.shiftKey ?? "05-13");
                          }}
                          title="Edit this narrative"
                        >
                          <PenLine className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-[#D4DFE5] text-[#1F2A52]"
                          onClick={() => void removeMutation.mutate({ id: entry.id, floorId })}
                          title="Delete this narrative"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                    <p className="text-[13px] font-serif-light text-[#7684A0]">{period.label}</p>
                    {canWriteBoard ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 border-[#2E9A9B]/50 text-[#1d6b6c]"
                        onClick={() => {
                          setOpenPeriod(period.key);
                          setEditEntry(null);
                          try {
                            setOpenBody(localStorage.getItem(draftKey) ?? "");
                          } catch {
                            setOpenBody("");
                          }
                          setOpenAuthor(authorName);
                          setOpenShift("05-13");
                        }}
                      >
                        Write narrative
                      </Button>
                    ) : (
                      <span className="text-[10px] uppercase tracking-[0.12em] text-[#9E1F2B]/70">No entry</span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : canWriteBoard ? (
          // Writable rendering for charge nurses on the board pages.
          REPORT_PERIODS.map(period => {
            const entry = entriesByPeriod.get(period.key);
            return (
              <div
                key={period.key}
                className="rounded-sm border border-[#D4DFE5] bg-[#FBFCFD] py-2"
              >
                {entry ? (
                  <div className="flex items-start justify-between gap-3 px-3.5 py-3">
                    <div>
                      <p className="font-serif-light text-[13px] font-semibold text-[#1F2A52]">
                        {period.label}
                      </p>
                      {entry.shiftKey && (
                        <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-[#7684A0]">
                          Shift {REPORT_SHIFTS.find(s => s.key === entry.shiftKey)?.label ?? entry.shiftKey}
                        </p>
                      )}
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#556680]">
                        {entry.body}
                      </p>
                      <p className="mt-1.5 text-[10px] text-[#7684A0]">
                        by {entry.author} · updated{" "}
                        {new Date(entry.updatedAt).toLocaleString([], { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 border-[#D4DFE5] text-[#1F2A52]"
                      onClick={() => void removeMutation.mutate({ id: entry.id, floorId })}
                      title="Delete this narrative"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                    <p className="text-[13px] font-serif-light text-[#7684A0]">{period.label}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 border-[#2E9A9B]/50 text-[#1d6b6c]"
                      onClick={() => {
                        setOpenPeriod(period.key);
                        setOpenBody("");
                        setOpenAuthor(authorName);
                        setOpenShift("05-13");
                      }}
                    >
                      Write narrative
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        ) : null}

        {canWriteBoard && openPeriod && (
          <div className="rounded-sm border border-[#2E9A9B]/40 bg-[#EFF8F8] p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#1d6b6c]">
              {REPORT_PERIODS.find(p => p.key === openPeriod)?.label}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[10px] uppercase tracking-[0.14em] text-[#556680]">
                  Shift on duty
                </label>
                <select
                  value={openShift}
                  onChange={e => setOpenShift(e.target.value)}
                  className="mt-1 h-9 w-full rounded-sm border border-[#D4DFE5] bg-white px-2 text-sm text-[#1F2A52] outline-none focus:border-[#2E9A9B]"
                >
                  {REPORT_SHIFTS.map(s => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.14em] text-[#556680]">
                  Charge nurse (author)
                </label>
                <input
                  value={openAuthor}
                  onChange={e => setOpenAuthor(e.target.value)}
                  placeholder="e.g. RN Maria Cruz"
                  className="mt-1 h-9 w-full rounded-sm border border-[#D4DFE5] bg-white px-2 text-sm text-[#1F2A52] outline-none focus:border-[#2E9A9B]"
                />
              </div>
            </div>
            <label className="mt-3 block text-[10px] uppercase tracking-[0.14em] text-[#556680]">
              Narrative · what happened during this period
            </label>
            <textarea
              value={openBody}
              onChange={e => setOpenBody(e.target.value)}
              placeholder="Patients hooked / terminated, transfers, incidents, supply issues, equipment notes…"
              rows={4}
              className="mt-1 w-full rounded-sm border border-[#D4DFE5] bg-white px-2 py-1.5 text-sm text-[#1F2A52] outline-none focus:border-[#2E9A9B]"
            />
            {openBody.trim() && !editEntry && (
              <p className="mt-1.5 text-[10px] text-[#7684A0]">
                {draftSaved.current ? "Draft saved — nothing is lost if you close this." : "Draft saving…"}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                className="bg-[#2E9A9B] text-white hover:bg-[#1d6b6c]"
                disabled={!openBody.trim() || !openAuthor.trim() || createMutation.isPending || updateMutation.isPending}
                onClick={() => {
                  if (!openBody.trim() || !openAuthor.trim()) return;
                  const onFinish = () => {
                    try {
                      localStorage.removeItem(draftKey);
                    } catch {
                      // localStorage unavailable — leave the draft key harmless.
                    }
                    setOpenPeriod(null);
                    setEditEntry(null);
                  };
                  if (editEntry) {
                    updateMutation.mutate({ id: editEntry.id, floorId, body: openBody.trim() }, { onSuccess: onFinish });
                  } else {
                    createMutation.mutate(
                      {
                        floorId,
                        reportDate: date,
                        periodKey: openPeriod,
                        shiftKey: openShift,
                        author: openAuthor.trim(),
                        body: openBody.trim(),
                      },
                      { onSuccess: onFinish }
                    );
                  }
                }}
              >
                {createMutation.isPending || updateMutation.isPending ? "Saving…" : editEntry ? "Update narrative" : "Save narrative"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-[#D4DFE5] text-[#556680]"
                onClick={() => setOpenPeriod(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
