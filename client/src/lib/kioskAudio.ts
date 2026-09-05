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
export function unlockAudio(): boolean {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") {
      void ctx.resume();
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.resume();
    }
    return true;
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

/**
 * Cleanly articulates the ticket code and bay destination without spelling
 * out the word "ticket" as individual letters.
 */
export function announceTicketVoice(ticket: string, bayLabel: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const cleanTicket = ticket.replace(/^TK-?/i, "").trim();
    // Space out digits/letters so the synthesizer pronounces each digit distinctly
    const spokenDigits = cleanTicket.split("").join(" ");
    const cleanBay = bayLabel.replace(/^HD-?/i, "").trim();
    const text = `Attention please. Ticket, ${spokenDigits}. Please proceed to Bay ${cleanBay}.`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.88;
    utterance.pitch = 1.05;
    window.speechSynthesis.speak(utterance);
  } catch {
    // ignore voice error
  }
}

/**
 * Announces a waiting ticket called by a nurse to enter the treatment area.
 * No bay is spoken: the machine is only assigned at admit time.
 */
export function announceTreatmentArea(ticket: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const cleanTicket = ticket.replace(/^TK-?/i, "").trim();
    const spokenDigits = cleanTicket.split("").join(" ");
    const text = `Attention please. Ticket, ${spokenDigits}. Please proceed to the treatment area.`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.88;
    utterance.pitch = 1.05;
    window.speechSynthesis.speak(utterance);
  } catch {
    // ignore voice error
  }
}
