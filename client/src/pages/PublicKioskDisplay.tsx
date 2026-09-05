import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertCircle,
  Bell,
  CheckCircle2,
  Clock,
  Droplets,
  Layers,
  LogOut,
  Maximize,
  Minimize,
  Moon,
  Sun,
  Ticket,
  User,
  Volume2,
  VolumeX,
  Sparkles,
  RefreshCw,
  HeartPulse,
  Flame,
  ShieldCheck,
  Building2,
  Info,
} from "lucide-react";
import type { MachineWithSession } from "../../../server/machines";

// Anonymous ticket generator from patient ID to protect privacy in public lounge
export 
function useKioskCountdown(endsAt: Date | null, isPaused: boolean, pausedSeconds: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  if (!endsAt) return 0;
  const effectiveEnd = isPaused ? endsAt.getTime() + pausedSeconds * 1000 : endsAt.getTime();
  return Math.max(0, effectiveEnd - now);
}

function formatKioskTimer(ms: number): { time: string; minutes: number } {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return {
      time: `${h}h ${String(m).padStart(2, "0")}m`,
      minutes: Math.ceil(totalSec / 60),
    };
  }
  return {
    time: `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
    minutes: Math.ceil(totalSec / 60),
  };
}

/**
 * One AudioContext for the life of the page.
 *
 * Constructing a context per chime leaks them: browsers cap how many a
 * document may hold, so on a kiosk running for days the constructor
 * eventually throws and the queue goes silent for good.
 */
let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new AudioCtx();
    }
    // Autoplay policy suspends the context until a user gesture; resuming is
    // a no-op once the kiosk operator has interacted with the page.
    if (sharedAudioCtx.state === "suspended") void sharedAudioCtx.resume();
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

// Audio synthesizer for hospital chime
function playHospitalChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const notes = [
      { freq: 523.25, time: 0.0, dur: 0.4 }, // C5
      { freq: 659.25, time: 0.15, dur: 0.4 }, // E5
      { freq: 783.99, time: 0.3, dur: 0.6 }, // G5
      { freq: 1046.5, time: 0.45, dur: 0.9 }, // C6
    ];

    notes.forEach(n => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(n.freq, now + n.time);

      gain.gain.setValueAtTime(0, now + n.time);
      gain.gain.linearRampToValueAtTime(0.18, now + n.time + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.time + n.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + n.time);
      osc.stop(now + n.time + n.dur + 0.1);
    });
  } catch {
    // ignore audio block
  }
}

// Voice announcement using Web Speech API
function announceTicketVoice(ticket: string, bayLabel: string) {
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const spokenTicket = ticket.replace("TK-", "Ticket ").split("").join(" ");
    const text = `Attention please. ${spokenTicket}, please proceed to Bay ${bayLabel.replace("HD-", "")}.`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.05;
    window.speechSynthesis.speak(utterance);
  } catch {
    // ignore
  }
}

type ThemeMode = "dark-oled" | "light-clinical" | "amber-contrast";

type KioskCallout = {
  /** Session id, or a synthetic value for the test chime. Identifies one announcement. */
  key: number;
  ticket: string;
  bay: string;
  floorName: string;
};

/**
 * The clock ticks once a second. Holding that state on the page would
 * re-render every bay card, the queue, and the callout overlay 60 times a
 * minute, which is what made the kiosk feel sluggish. Keeping it in a leaf
 * confines each tick to these two lines of text.
 */
function KioskClock({ theme }: { theme: ThemeMode }) {
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="text-right">
      <div
        className={cn(
          "font-mono text-2xl lg:text-3xl font-black tracking-wider",
          theme === "dark-oled" && "text-cyan-400",
          theme === "light-clinical" && "text-[#0F172A]",
          theme === "amber-contrast" && "text-[#F59E0B]"
        )}
      >
        {currentTime.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        })}
      </div>
      <div
        className={cn(
          "text-[11px] font-medium tracking-wide uppercase",
          theme === "dark-oled" && "text-[#64748B]",
          theme === "light-clinical" && "text-[#94A3B8]",
          theme === "amber-contrast" && "text-[#FCD34D]"
        )}
      >
        {currentTime.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </div>
    </div>
  );
}

export default function PublicKioskDisplay() {
  const [theme, setTheme] = useState<ThemeMode>("dark-oled");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [selectedFloorId, setSelectedFloorId] = useState<number | "ALL">("ALL");
  const [autoCycle, setAutoCycle] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Callouts are queued, not overwritten. Two bays can start a session inside
  // one poll window, and the previous code announced only the first of them.
  const [calloutQueue, setCalloutQueue] = useState<KioskCallout[]>([]);
  const activeCallout = calloutQueue[0] ?? null;

  const prevAdmittedIdsRef = useRef<Set<number>>(new Set());
  const announcedKeyRef = useRef<number | null>(null);

  // Real-time queries for machines and waiting lists
  const { data: machines, isLoading: machinesLoading } = trpc.machines.list.useQuery(undefined, {
    refetchInterval: 10000,
  });

  const { data: floors } = trpc.machines.listFloors.useQuery(undefined, {
    refetchInterval: 30000,
  });

  // Fetch all waiting patients across floors
  const activeFloorIdNum = typeof selectedFloorId === "number" ? selectedFloorId : (floors?.[0]?.id ?? 1);
  const { data: waitingList } = trpc.waiting.list.useQuery(
    { floorId: activeFloorIdNum },
    { refetchInterval: 10000 }
  );

  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const staffMe = trpc.staff.me.useQuery(undefined, {
    retry: false,
    staleTime: 15_000,
  });
  const staff = staffMe.data;
  const isPatient = staff?.role === "patient";
  const userTicket = isPatient && staff.username !== "patient.guest" ? staff.username.toUpperCase() : null;

  const logoutMut = trpc.staff.logout.useMutation({
    onSuccess: () => {
      utils.staff.me.setData(undefined, {
        accountId: 0,
        username: "guest",
        displayName: "Guest",
        role: "guest",
        assignedFloorId: null,
        fromCookie: true,
      });
      navigate("/patient-login");
    },
  });

  const myActiveSession = useMemo(() => {
    if (!userTicket || !machines) return null;
    const found = machines.find(m => m.session && m.session.ticket.toUpperCase() === userTicket);
    if (!found || !found.session) return null;
    const floorObj = floors?.find(f => f.id === found.machine.floorId);
    return {
      bay: found.machine.label,
      floorName: floorObj?.name ?? "Dialysis Bay",
      durationMinutes: found.session.durationMinutes,
      startedAt: found.session.startedAt,
    };
  }, [userTicket, machines, floors]);

  const myWaitingQueuePosition = useMemo(() => {
    if (!userTicket || !waitingList) return null;
    const idx = waitingList.findIndex(w => w.ticket?.toUpperCase() === userTicket);
    return idx >= 0 ? idx + 1 : null;
  }, [userTicket, waitingList]);

  // Handle Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Auto-cycle through floors if multiple floors exist
  useEffect(() => {
    if (!autoCycle || !floors || floors.length <= 1) return;
    const interval = setInterval(() => {
      setSelectedFloorId(prev => {
        if (prev === "ALL") return floors[0].id;
        const currentIndex = floors.findIndex(f => f.id === prev);
        if (currentIndex === -1 || currentIndex === floors.length - 1) {
          return "ALL";
        }
        return floors[currentIndex + 1].id;
      });
    }, 14000);
    return () => clearInterval(interval);
  }, [autoCycle, floors]);

  // Audio-visual alert trigger when a new session starts
  useEffect(() => {
    if (!machines) return;
    const currentActiveSessions = machines.filter(m => m.session !== null);
    const activeIds = new Set(currentActiveSessions.map(m => m.session!.id));

    // Check for newly started sessions
    if (prevAdmittedIdsRef.current.size > 0) {
      const admits: KioskCallout[] = [];
      for (const m of currentActiveSessions) {
        if (m.session && !prevAdmittedIdsRef.current.has(m.session.id)) {
          const floorObj = floors?.find(f => f.id === m.machine.floorId);
          admits.push({
            key: m.session.id,
            ticket: m.session.ticket,
            bay: m.machine.label,
            floorName: floorObj?.name ?? "Dialysis Bay",
          });
        }
      }
      if (admits.length > 0) setCalloutQueue(q => [...q, ...admits]);
    }

    prevAdmittedIdsRef.current = activeIds;
  }, [machines, floors]);

  // Announce the head of the queue, then hand over to the next after 12s.
  useEffect(() => {
    if (!activeCallout) return;
    if (announcedKeyRef.current !== activeCallout.key) {
      announcedKeyRef.current = activeCallout.key;
      if (soundEnabled) playHospitalChime();
      if (voiceEnabled) announceTicketVoice(activeCallout.ticket, activeCallout.bay);
    }
    const timer = setTimeout(() => setCalloutQueue(q => q.slice(1)), 12000);
    return () => clearTimeout(timer);
  }, [activeCallout, soundEnabled, voiceEnabled]);

  // Filtered machines
  const filteredMachines = useMemo(() => {
    if (!machines) return [];
    if (selectedFloorId === "ALL") return machines;
    return machines.filter(m => m.machine.floorId === selectedFloorId);
  }, [machines, selectedFloorId]);

  // Aggregate stats
  const stats = useMemo(() => {
    const list = filteredMachines;
    let vacant = 0;
    let inUse = 0;
    let readySoon = 0; // Less than 20 mins remaining

    list.forEach(m => {
      if (!m.session) {
        vacant++;
      } else {
        inUse++;
        const remainingMs = m.session.endsAt ? new Date(m.session.endsAt).getTime() - Date.now() : 0;
        if (remainingMs > 0 && remainingMs <= 20 * 60 * 1000) {
          readySoon++;
        }
      }
    });

    return { total: list.length, vacant, inUse, readySoon };
  }, [filteredMachines]);

  // Privacy-safe queue list
  const anonymousQueue = useMemo(() => {
    return (waitingList ?? []).map((w, index) => ({
      id: w.id,
      ticketNumber: w.ticket,
      priority: w.priority,
      queuePosition: index + 1,
      estimatedWaitMin: (index + 1) * 25,
      status: index === 0 && stats.vacant > 0 ? "CALLING / PROCEED" : index === 0 ? "NEXT IN LINE" : "WAITING IN LOUNGE",
    }));
  }, [waitingList, stats.vacant]);

  // Test Chime Action
  const handleTestChime = () => {
    setCalloutQueue(q => [
      ...q,
      { key: -Date.now(), ticket: "TK-4821", bay: "HD-01", floorName: "Floor 1 Main" },
    ]);
  };

  return (
    <div
      className={cn(
        "min-h-screen w-full select-none flex flex-col font-sans transition-colors duration-500 overflow-x-hidden",
        theme === "dark-oled" && "bg-[#070B14] text-[#F1F5F9]",
        theme === "light-clinical" && "bg-[#F8FAFC] text-[#0F172A]",
        theme === "amber-contrast" && "bg-[#000000] text-[#FBBF24]"
      )}
    >
      {/* Top Lounge Masthead */}
      <header
        className={cn(
          "w-full px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4 sticky top-0 z-40 backdrop-blur-md",
          theme === "dark-oled" && "bg-[#0A101F]/90 border-[#1E293B]",
          theme === "light-clinical" && "bg-white/95 border-[#E2E8F0] shadow-xs",
          theme === "amber-contrast" && "bg-black border-[#F59E0B]/40"
        )}
      >
        {/* Hospital Branding */}
        <div className="flex items-center gap-4">
          <img
            src="/images/skti-seal-transparent.png"
            alt="SPMCKTI Seal"
            className="h-14 w-14 rounded-full object-cover shadow-lg border-2 border-white/20"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1
                className={cn(
                  "font-display text-2xl lg:text-3xl font-bold tracking-tight",
                  theme === "dark-oled" && "text-white",
                  theme === "light-clinical" && "text-[#1E293B]",
                  theme === "amber-contrast" && "text-[#F59E0B]"
                )}
              >
                SPMC Kidney &amp; Transplant Institute
              </h1>
              <span
                className={cn(
                  "hidden sm:inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full uppercase tracking-wider",
                  theme === "dark-oled" && "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
                  theme === "light-clinical" && "bg-emerald-100 text-emerald-800 border border-emerald-300",
                  theme === "amber-contrast" && "bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]"
                )}
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                Live TV Lounge Display
              </span>
            </div>
            <p
              className={cn(
                "text-xs lg:text-sm tracking-wide mt-0.5",
                theme === "dark-oled" && "text-[#94A3B8]",
                theme === "light-clinical" && "text-[#64748B]",
                theme === "amber-contrast" && "text-[#FCD34D]"
              )}
            >
              Hemodialysis Unit · Public Patient Queue &amp; Bay Readiness Kiosk
            </p>
          </div>
        </div>

        {/* Live Clock & Control Suite */}
        <div className="flex items-center gap-4 sm:gap-6">
          {/* Big Digital Clock */}
          <KioskClock theme={theme} />

          {/* Quick TV Control Buttons */}
          <div className="flex items-center gap-1.5 p-1 rounded-lg border border-white/10 bg-black/20">
            {/* Theme Toggle */}
            <button
              onClick={() => {
                if (theme === "dark-oled") setTheme("light-clinical");
                else if (theme === "light-clinical") setTheme("amber-contrast");
                else setTheme("dark-oled");
              }}
              title="Toggle Display Theme Mode"
              className="p-2 rounded-md hover:bg-white/10 transition-colors"
            >
              {theme === "dark-oled" && <Moon className="h-5 w-5 text-cyan-400" />}
              {theme === "light-clinical" && <Sun className="h-5 w-5 text-amber-500" />}
              {theme === "amber-contrast" && <Flame className="h-5 w-5 text-[#F59E0B]" />}
            </button>

            {/* Audio Chime Toggle */}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? "Mute Ready Chime" : "Enable Ready Chime"}
              className={cn(
                "p-2 rounded-md hover:bg-white/10 transition-colors",
                soundEnabled ? "text-emerald-400" : "text-slate-500 line-through"
              )}
            >
              {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </button>

            {/* Test Audio Button */}
            <button
              onClick={handleTestChime}
              title="Test Hospital Chime & Announcement"
              className="px-2.5 py-1 text-xs font-semibold rounded-md bg-white/10 hover:bg-white/20 transition-colors flex items-center gap-1"
            >
              <Bell className="h-3.5 w-3.5" />
              Test Cue
            </button>

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              title="Toggle Fullscreen TV View"
              className="p-2 rounded-md hover:bg-white/10 transition-colors"
            >
              {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </button>

            {/* Patient Session Indicator / Sign In */}
            {isPatient ? (
              <div className="flex items-center gap-1.5 pl-2 border-l border-white/20">
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-mono">
                  <Ticket className="h-3.5 w-3.5" />
                  <span>{staff?.username || "Patient"}</span>
                </div>
                <button
                  onClick={() => logoutMut.mutate(undefined, { onSuccess: () => navigate("/patient-login") })}
                  title="Sign Out of Patient Kiosk"
                  className="px-2 py-1 text-xs rounded-md bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 flex items-center gap-1 transition-colors"
                >
                  <LogOut className="h-3 w-3" />
                  <span className="hidden sm:inline">Exit</span>
                </button>
              </div>
            ) : (
              <Link href="/patient-login">
                <button
                  title="Patient / Family Sign In"
                  className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center gap-1.5 border border-white/20 ml-1"
                >
                  <User className="h-3.5 w-3.5 text-cyan-300" />
                  <span className="hidden sm:inline">Patient Sign In</span>
                </button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Personalized Patient Banner when logged in */}
      {isPatient && myActiveSession && (
        <div className="w-full bg-gradient-to-r from-emerald-950 via-teal-900 to-cyan-950 border-b border-teal-500/40 px-6 py-3 flex flex-wrap items-center justify-between gap-3 text-emerald-100 text-sm shadow-md">
          <div className="flex items-center gap-2.5">
            <span className="flex h-3 w-3 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-bold text-white uppercase tracking-wider text-xs bg-emerald-700/80 px-2 py-0.5 rounded">
              Your Session
            </span>
            <span>Assigned to Machine <strong className="text-white text-base">{myActiveSession.bay}</strong> ({myActiveSession.floorName})</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono bg-black/40 px-3 py-1 rounded-full border border-teal-400/30">
            <Ticket className="h-3.5 w-3.5 text-teal-300" />
            <span>Ticket {staff?.username}</span>
          </div>
        </div>
      )}

      {isPatient && myWaitingQueuePosition !== null && !myActiveSession && (
        <div className="w-full bg-gradient-to-r from-amber-950 via-amber-900 to-orange-950 border-b border-amber-500/40 px-6 py-3 flex flex-wrap items-center justify-between gap-3 text-amber-100 text-sm shadow-md">
          <div className="flex items-center gap-2.5">
            <span className="flex h-3 w-3 rounded-full bg-amber-400 animate-ping" />
            <span className="font-bold text-white uppercase tracking-wider text-xs bg-amber-700/80 px-2 py-0.5 rounded">
              Your Queue Status
            </span>
            <span>You are <strong className="text-white text-base">#{myWaitingQueuePosition}</strong> in the waiting list. Please wait in the lounge until called.</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono bg-black/40 px-3 py-1 rounded-full border border-amber-400/30">
            <Ticket className="h-3.5 w-3.5 text-amber-300" />
            <span>Ticket {staff?.username}</span>
          </div>
        </div>
      )}

      {/* Prominent Real-Time Callout Banner (Appears when ticket is called!) */}
      {activeCallout && (
        <div
          className={cn(
            "w-full py-4 px-6 text-center animate-bounce shadow-2xl flex items-center justify-center gap-4 transition-all z-50",
            theme === "dark-oled" && "bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-600 text-white",
            theme === "light-clinical" && "bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white",
            theme === "amber-contrast" && "bg-[#F59E0B] text-black font-black"
          )}
        >
          <Bell className="h-8 w-8 animate-spin" />
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span className="text-xl sm:text-2xl font-black uppercase tracking-wider">
              NOW CALLING TICKET:
            </span>
            <span className="text-2xl sm:text-4xl font-black tracking-widest px-4 py-1 rounded-lg bg-black/30 border border-white/40 shadow-inner">
              {activeCallout.ticket}
            </span>
            <span className="text-xl sm:text-2xl font-bold">
              → PLEASE PROCEED TO <strong className="underline underline-offset-4">{activeCallout.bay}</strong> ({activeCallout.floorName})
            </span>
          </div>
        </div>
      )}

      {/* Floor Filter Tabs & Auto-cycle Status */}
      <div
        className={cn(
          "px-6 py-3 border-b flex flex-wrap items-center justify-between gap-4",
          theme === "dark-oled" && "bg-[#0B1222] border-[#1E293B]",
          theme === "light-clinical" && "bg-[#F1F5F9] border-[#CBD5E1]",
          theme === "amber-contrast" && "bg-black border-[#F59E0B]/30"
        )}
      >
        <div className="flex items-center gap-2 overflow-x-auto py-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 mr-2 flex items-center gap-1">
            <Layers className="h-3.5 w-3.5" /> Floor:
          </span>
          <button
            onClick={() => {
              setSelectedFloorId("ALL");
              setAutoCycle(false);
            }}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-bold transition-all",
              selectedFloorId === "ALL"
                ? "bg-cyan-500 text-slate-950 shadow-md font-black"
                : "bg-white/5 hover:bg-white/10 text-slate-300"
            )}
          >
            All Floors ({machines?.length ?? 0})
          </button>
          {floors?.map(f => (
            <button
              key={f.id}
              onClick={() => {
                setSelectedFloorId(f.id);
                setAutoCycle(false);
              }}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-bold transition-all",
                selectedFloorId === f.id
                  ? "bg-cyan-500 text-slate-950 shadow-md font-black"
                  : "bg-white/5 hover:bg-white/10 text-slate-300"
              )}
            >
              {f.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoCycle}
              onChange={e => setAutoCycle(e.target.checked)}
              className="rounded accent-cyan-500 h-4 w-4"
            />
            <span className="text-slate-300 font-medium">Auto-Rotate Boards (14s)</span>
          </label>

          {/* Machine Summary Badges */}
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
              {stats.vacant} Vacant / Ready
            </span>
            <span className="px-3 py-1 rounded-md bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 font-bold">
              {stats.inUse} In Treatment
            </span>
            {stats.readySoon > 0 && (
              <span className="px-3 py-1 rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold animate-pulse">
                {stats.readySoon} Ending Soon
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Kiosk Content Grid: Machine Readiness Bay Grid + Anonymous Queue Strip */}
      <main className="flex-1 p-6 grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Left 3 Columns: Live Machine Readiness Bay Matrix */}
        <section className="xl:col-span-3 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-6 w-6 text-cyan-400" />
              <h2
                className={cn(
                  "font-display text-xl lg:text-2xl font-bold tracking-tight",
                  theme === "dark-oled" && "text-white",
                  theme === "light-clinical" && "text-[#0F172A]",
                  theme === "amber-contrast" && "text-[#F59E0B]"
                )}
              >
                Dialysis Bay Readiness Board
              </h2>
            </div>
            <div className="flex items-center gap-4 text-xs font-semibold">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-emerald-500 shadow-sm animate-pulse" />
                <span>Ready to Hook / Vacant</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-cyan-500 shadow-sm" />
                <span>Treatment In Progress</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-amber-500 shadow-sm" />
                <span>Turnover / Ending &lt;20m</span>
              </span>
            </div>
          </div>

          {/* Bay Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
            {machinesLoading ? (
              Array.from({ length: 18 }).map((_, i) => (
                <div
                  key={i}
                  className="h-36 rounded-xl animate-pulse bg-white/5 border border-white/10"
                />
              ))
            ) : filteredMachines.length === 0 ? (
              <div className="col-span-full py-16 text-center border-2 border-dashed border-white/10 rounded-xl text-slate-400 font-serif">
                No machines found for this floor.
              </div>
            ) : (
              filteredMachines.map(item => (
                <KioskBayCard
                  key={item.machine.id}
                  item={item}
                  theme={theme}
                />
              ))
            )}
          </div>
        </section>

        {/* Right 1 Column: Privacy-Safe Waiting Queue & Calling Board */}
        <aside
          className={cn(
            "xl:col-span-1 rounded-2xl p-5 border flex flex-col gap-4 shadow-xl",
            theme === "dark-oled" && "bg-[#0D1527] border-[#1E293B]",
            theme === "light-clinical" && "bg-white border-[#E2E8F0]",
            theme === "amber-contrast" && "bg-[#080808] border-[#F59E0B]/40"
          )}
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-cyan-400" />
              <h3 className="font-display text-lg font-bold">Lounge Patient Queue</h3>
            </div>
            <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-cyan-500/20 text-cyan-400">
              {anonymousQueue.length} Waiting
            </span>
          </div>

          <p className="text-xs text-slate-400 italic">
            Privacy-Protected: Displaying assigned ticket IDs. Please keep your ticket slip ready.
          </p>

          {/* Queue List Cards */}
          <div className="flex flex-col gap-2.5 overflow-y-auto max-h-[580px] scrollbar-none">
            {anonymousQueue.length === 0 ? (
              <div className="py-12 text-center text-slate-400 font-serif text-sm">
                <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2 opacity-80" />
                All waiting patients have been catered.
              </div>
            ) : (
              anonymousQueue.map(t => (
                <div
                  key={t.id}
                  className={cn(
                    "p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 shrink-0",
                    t.status === "CALLING / PROCEED"
                      ? "bg-emerald-500/20 border-emerald-500 text-emerald-200 ring-2 ring-emerald-400/30 animate-pulse"
                      : t.status === "NEXT IN LINE"
                        ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-100"
                        : theme === "dark-oled"
                          ? "bg-[#131E35] border-[#1E293B] text-slate-300"
                          : "bg-slate-50 border-slate-200 text-slate-800"
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-lg font-black tracking-wider whitespace-nowrap">
                        {t.ticketNumber}
                      </span>
                      {t.priority === "veryUrgent" && (
                        <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-black uppercase rounded bg-red-500 text-white">
                          Priority
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] opacity-75">
                      Position #{t.queuePosition} ·{" "}
                      <span className="whitespace-nowrap">Est. {t.estimatedWaitMin}m</span>
                    </span>
                  </div>

                  <div className="shrink-0 text-right">
                    <span
                      className={cn(
                        "text-[10px] font-black uppercase px-2 py-1 rounded-md tracking-wider block",
                        t.status === "CALLING / PROCEED"
                          ? "bg-emerald-500 text-black font-black"
                          : t.status === "NEXT IN LINE"
                            ? "bg-cyan-400 text-black font-bold"
                            : "bg-white/10 text-slate-400"
                      )}
                    >
                      {t.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Dialysis Lounge Health & Safety Tip Box */}
          <div
            className={cn(
              "mt-auto p-3.5 rounded-xl border text-xs flex items-start gap-2.5",
              theme === "dark-oled" && "bg-cyan-950/30 border-cyan-800/40 text-cyan-200",
              theme === "light-clinical" && "bg-blue-50 border-blue-200 text-blue-950",
              theme === "amber-contrast" && "bg-amber-950/20 border-amber-800 text-amber-300"
            )}
          >
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-cyan-400" />
            <div>
              <p className="font-bold">Patient Advisory:</p>
              <p className="opacity-90 leading-relaxed text-[11px]">
                Please wash your vascular access arm with antibacterial soap at the lounge wash station before entering the treatment floor.
              </p>
            </div>
          </div>
        </aside>
      </main>

      {/* Footer Ticker */}
      <footer
        className={cn(
          "w-full px-6 py-2.5 border-t text-xs flex flex-wrap items-center justify-between gap-4 font-medium",
          theme === "dark-oled" && "bg-[#060A13] border-[#1E293B] text-slate-400",
          theme === "light-clinical" && "bg-slate-100 border-slate-300 text-slate-600",
          theme === "amber-contrast" && "bg-black border-[#F59E0B]/30 text-[#F59E0B]"
        )}
      >
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span>Reverse Osmosis Water QC: <strong>VERIFIED COMPLIANT</strong> (ISO 23500 Standard)</span>
        </div>
        <div className="flex items-center gap-6">
          <span>Total Dialysis Stations: <strong>{machines?.length ?? 0}</strong></span>
          <span>Emergency Assistance: <strong>Local 4801 / Nurse Station</strong></span>
        </div>
      </footer>
    </div>
  );
}

// Individual Bay Card for High-Contrast Kiosk Display
function KioskBayCard({
  item,
  theme,
}: {
  item: MachineWithSession;
  theme: ThemeMode;
}) {
  const occupied = item.session !== null;
  const isPaused = Boolean(item.session?.pausedAt);
  const countdownMs = useKioskCountdown(
    item.session?.endsAt ?? null,
    isPaused,
    item.session?.pausedSeconds ?? 0
  );
  const { time, minutes } = formatKioskTimer(countdownMs);
  const endingSoon = occupied && minutes > 0 && minutes <= 20;
  const treatmentDone = occupied && countdownMs === 0;

  // Clean label without HD prefix for large display
  const bayNumber = item.machine.label.replace("HD-", "Bay ");

  return (
    <div
      className={cn(
        "rounded-2xl p-3.5 border transition-all flex flex-col justify-between h-40 shadow-md relative overflow-hidden",
        !occupied && (
          theme === "dark-oled"
            ? "bg-gradient-to-b from-emerald-950/40 to-emerald-900/20 border-emerald-500/50 hover:border-emerald-400"
            : theme === "light-clinical"
              ? "bg-emerald-50/80 border-emerald-300 text-emerald-950"
              : "bg-black border-emerald-500 text-emerald-400"
        ),
        occupied && !endingSoon && !treatmentDone && (
          theme === "dark-oled"
            ? "bg-[#0E1B33] border-cyan-500/40 text-slate-100"
            : theme === "light-clinical"
              ? "bg-cyan-50/70 border-cyan-300 text-cyan-950"
              : "bg-black border-cyan-500 text-cyan-400"
        ),
        endingSoon && (
          theme === "dark-oled"
            ? "bg-amber-950/40 border-amber-500 text-amber-200 animate-pulse"
            : theme === "light-clinical"
              ? "bg-amber-50 border-amber-400 text-amber-950 animate-pulse"
              : "bg-black border-amber-500 text-amber-400 animate-pulse"
        ),
        treatmentDone && (
          theme === "dark-oled"
            ? "bg-purple-950/40 border-purple-400 text-purple-200"
            : "bg-purple-50 border-purple-300 text-purple-950"
        )
      )}
    >
      {/* Top Bay Tag & Status Dot */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-black tracking-wider uppercase opacity-90">
          {bayNumber}
        </span>
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            !occupied && "bg-emerald-400 shadow-[0_0_10px_#10B981] animate-ping",
            occupied && !endingSoon && "bg-cyan-400",
            endingSoon && "bg-amber-400 shadow-[0_0_10px_#F59E0B]",
            treatmentDone && "bg-purple-400"
          )}
        />
      </div>

      {/* Center Value: Status or Big Countdown Timer */}
      <div className="my-auto text-center">
        {!occupied ? (
          <div>
            <span className="text-xl sm:text-2xl font-black text-emerald-400 tracking-tight block">
              READY
            </span>
            <span className="text-[10px] uppercase tracking-widest text-emerald-300 font-bold">
              Vacant / Sanitized
            </span>
          </div>
        ) : (
          <div>
            <span className="font-mono text-2xl sm:text-3xl font-black tracking-tight block">
              {treatmentDone ? "COMPLETED" : time}
            </span>
            <span className="text-[10px] uppercase font-bold tracking-wider opacity-75">
              {treatmentDone ? "Turnover in progress" : endingSoon ? "Ending Soon" : "Remaining"}
            </span>
          </div>
        )}
      </div>

      {/* Bottom Ticket / Location Footer */}
      <div className="border-t border-white/10 pt-2 flex items-center justify-between text-[11px] font-medium">
        <span className="truncate opacity-75">{item.machine.location || "Bay Area"}</span>
        {occupied && item.session && (
          <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-white/10 text-cyan-300">
            {item.session.ticket}
          </span>
        )}
      </div>
    </div>
  );
}
