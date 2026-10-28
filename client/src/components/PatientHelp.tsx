import { useEffect, useState } from "react";
import { CircleHelp, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const SEEN_KEY = "patient-help-seen-v1";

const instructions = {
  en: {
    title: "How to use the app",
    description: "Scroll down to read all the steps.",
    done: "Got it",
    bullets: [
      <>Enter your <strong>ticket number</strong>. Ask the nurse if you do not know it.</>,
      <>Tap <strong>Enable sound</strong>. Turn up your phone volume.</>,
      <>Keep this page open and your screen on. You may miss the sound if your phone is locked.</>,
      <>Wait for <strong>your ticket number</strong>. When called, go to the area shown on your screen.</>,
      <>Missed the voice call? Tap <strong>Hear my call again</strong>.</>,
      <>Need help? <strong>Ask the nurse.</strong></>,
    ],
  },
  tl: {
    title: "Paano gamitin ang app",
    description: "I-scroll pababa para mabasa lahat.",
    done: "Naintindihan ko",
    bullets: [
      <>Ilagay ang <strong>numero ng iyong ticket</strong>. Kung hindi mo alam, magtanong sa nars.</>,
      <>Pindutin ang <strong lang="en">Enable sound</strong>. Lakasan ang tunog ng cellphone.</>,
      <>Panatilihing bukas ang pahinang ito at ang screen. Maaaring hindi marinig ang tawag kapag naka-lock ang cellphone.</>,
      <>Hintayin ang <strong>iyong numero</strong>. Kapag tinawag, pumunta sa lugar na nakasulat sa screen.</>,
      <>Hindi narinig ang tawag? Pindutin ang <strong lang="en">Hear my call again</strong>.</>,
      <>Kailangan ng tulong? <strong>Magtanong sa nars.</strong></>,
    ],
  },
};

export default function PatientHelp({
  autoOpen = false,
  urgent = false,
}: {
  autoOpen?: boolean;
  urgent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<"en" | "tl">("en");

  useEffect(() => {
    if (!autoOpen || urgent) return;
    try {
      if (localStorage.getItem(SEEN_KEY)) return;
    } catch { /* Help still works when browser storage is unavailable. */ }
    setOpen(true);
  }, [autoOpen, urgent]);

  // A ticket call takes priority over reading instructions.
  useEffect(() => {
    if (urgent) setOpen(false);
  }, [urgent]);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* Optional preference. */ }
    }
  };
  const copy = instructions[language];

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border-2 border-[#1F2A52] bg-white px-4 py-2 text-lg font-semibold text-[#1F2A52] shadow-sm hover:bg-[#E8EFF1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2E9A9B]"
        >
          <CircleHelp className="size-5 shrink-0" aria-hidden="true" />
          <span>Help / <span lang="tl">Gabay</span></span>
        </button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        lang={language}
        className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-2 border-[#1F2A52] bg-white p-0 font-sans text-[#1F2A52] sm:max-w-xl"
      >
        <div className="border-b border-[#D4DFE5] p-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <DialogTitle className="text-2xl leading-snug font-bold">{copy.title}</DialogTitle>
            <button
              type="button"
              aria-label={language === "en" ? "Close instructions" : "Isara ang gabay"}
              onClick={() => changeOpen(false)}
              className="flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-lg border-2 border-[#1F2A52] hover:bg-[#E8EFF1] focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <X className="size-6" aria-hidden="true" />
            </button>
          </div>
          <DialogDescription className="mt-2 text-lg leading-relaxed text-[#1F2A52]">{copy.description}</DialogDescription>
          <div className="mt-4 flex gap-3" role="group" aria-label="Language / Wika">
            {(["en", "tl"] as const).map(value => (
              <button
                key={value}
                type="button"
                lang={value}
                aria-pressed={language === value}
                onClick={() => setLanguage(value)}
                className={`min-h-12 flex-1 rounded-lg border-2 border-[#1F2A52] px-3 py-2 text-lg font-bold focus-visible:outline-2 focus-visible:outline-offset-2 ${language === value ? "bg-[#1F2A52] text-white" : "bg-white text-[#1F2A52] hover:bg-[#E8EFF1]"}`}
              >
                {value === "en" ? "English" : "Tagalog"}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-5" tabIndex={0} role="region" aria-label={copy.title}>
          <ul className="list-disc space-y-5 pl-5 text-xl leading-relaxed marker:text-[#1F2A52]">
            {copy.bullets.map((bullet, index) => <li key={index} className="pl-1">{bullet}</li>)}
          </ul>
        </div>
        <div className="border-t border-[#D4DFE5] bg-white p-4">
          <button
            type="button"
            onClick={() => changeOpen(false)}
            className="min-h-14 w-full rounded-lg bg-[#1F2A52] px-4 py-3 text-xl font-bold text-white hover:bg-[#151D3A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2E9A9B]"
          >
            {copy.done}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
