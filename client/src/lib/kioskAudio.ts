/**
 * Shared audio synthesizer and speech announcement utility for kiosk and clinical boards.
 * Generates soothing hospital chimes and clear Web Speech API voice announcements.
 */

let sharedAudioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  try {
    if (!sharedAudioCtx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        sharedAudioCtx = new AudioCtx();
      }
    }
    if (sharedAudioCtx && sharedAudioCtx.state === "suspended") {
      void sharedAudioCtx.resume();
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Unlocks Web Audio and Web Speech API on the current document.
 * Must be triggered on or after a user gesture (click/touch/keypress).
 */
export async function unlockAudio(): Promise<boolean> {
  try {
    const ctx = getAudioContext();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.resume();
    }
    if (ctx && ctx.state !== "running") await ctx.resume();
    return ctx?.state === "running";
  } catch {
    return false;
  }
}

/**
 * Synthesizes a 4-note ascending hospital chime (C5 -> E5 -> G5 -> C6).
 */
export function playHospitalChime(): void {
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

/** "HD-05" -> "5". Machines are announced by number, without the board prefix. */
export function spokenMachineNumber(label: string): string {
  const digits = label.replace(/^[A-Za-z]+[-\s]?/, "").trim();
  const n = Number(digits);
  return digits !== "" && Number.isFinite(n) ? String(n) : (digits || label);
}

/** Digits are spaced out so the synthesizer reads each one distinctly. */
function spokenTicket(ticket: string): string {
  return ticket
    .replace(/^TK-?/i, "")
    .trim()
    .split("")
    .join(" ");
}

/**
 * What an admitted patient hears: board, ticket, machine. Nothing else is
 * spoken, so a lounge full of patients hears only what tells them where to go.
 */
export function ticketCallText(ticket: string, bayLabel: string, floorName: string): string {
  const board = floorName.trim();
  return `${board ? `${board}. ` : ""}Ticket ${spokenTicket(ticket)}. Machine ${spokenMachineNumber(bayLabel)}.`;
}

/**
 * What a called-in patient hears. No session exists yet, so the machine spoken
 * is the one the next admit lands on. It is dropped when the floor is full.
 */
export function treatmentAreaCallText(
  ticket: string,
  floorName: string,
  nextMachineLabel: string | null
): string {
  const board = floorName.trim();
  const machine = nextMachineLabel
    ? ` Machine ${spokenMachineNumber(nextMachineLabel)} is next.`
    : "";
  return `${board ? `${board}. ` : ""}Ticket ${spokenTicket(ticket)}.${machine}`;
}

/** Speaks the admission call for a ticket. */
export function announceTicketVoice(ticket: string, bayLabel: string, floorName: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.cancel();
    setTimeout(() => {
      try {
        const text = ticketCallText(ticket, bayLabel, floorName);
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.88;
        utterance.pitch = 1.05;
        const voices = window.speechSynthesis.getVoices();
        const englishVoice = voices.find(v => v.lang.startsWith("en"));
        if (englishVoice) utterance.voice = englishVoice;
        window.speechSynthesis.speak(utterance);
      } catch {
        // ignore voice error
      }
    }, 100);
  } catch {
    // ignore voice error
  }
}

/** Speaks the nurse call for a waiting ticket. */
export function announceTreatmentArea(
  ticket: string,
  floorName: string,
  nextMachineLabel: string | null
): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.cancel();
    setTimeout(() => {
      try {
        const text = treatmentAreaCallText(ticket, floorName, nextMachineLabel);
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.88;
        utterance.pitch = 1.05;
        const voices = window.speechSynthesis.getVoices();
        const englishVoice = voices.find(v => v.lang.startsWith("en"));
        if (englishVoice) utterance.voice = englishVoice;
        window.speechSynthesis.speak(utterance);
      } catch {
        // ignore voice error
      }
    }, 100);
  } catch {
    // ignore voice error
  }
}
