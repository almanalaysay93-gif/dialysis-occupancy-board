import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";

const COOKIE_NOTICE_KEY = "skti-dialysis-cookie-ok";

function isKioskPath(path: string) {
  return path === "/display" || path === "/kiosk";
}

export function SiteChrome() {
  const [location] = useLocation();
  const kiosk = isKioskPath(location);
  return (
    <>
      <SkipToContent />
      {kiosk ? null : <CookieNotice />}
      {kiosk ? null : <ScrollToTop />}
    </>
  );
}

function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 z-[60] px-4 py-2 bg-primary text-primary-foreground font-medium rounded-md shadow-lg outline-none ring-2 ring-ring print:hidden"
    >
      Skip to main content
    </a>
  );
}

function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(COOKIE_NOTICE_KEY) !== "1");
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  return (
    <div
      id="cookie-notice"
      role="dialog"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-4 py-3 shadow-[0_-8px_24px_-12px_oklch(0.275_0.062_262_/_0.25)] backdrop-blur print:hidden"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          This board uses necessary session cookies for staff sign-in, theme, and sidebar state.
          It does not use advertising cookies.
          Read the{" "}
          <Link href="/privacy" className="underline underline-offset-2 text-foreground hover:text-accent">
            Privacy Policy
          </Link>
          .
        </p>
        <Button
          size="sm"
          className="shrink-0 bg-primary text-primary-foreground"
          onClick={() => {
            try {
              localStorage.setItem(COOKIE_NOTICE_KEY, "1");
            } catch {
              // Storage may be blocked. Hide for this visit only.
            }
            setVisible(false);
          }}
        >
          Accept
        </Button>
      </div>
    </div>
  );
}

function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(
      window.scrollY > 300 &&
      document.documentElement.scrollHeight - window.scrollY - window.innerHeight > 160
    );
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  if (!visible) return null;

  return (
    <Button
      data-scroll-to-top=""
      variant="outline"
      size="icon"
      className="fixed bottom-20 right-6 z-40 hidden rounded-full shadow-lg bg-background/80 backdrop-blur-sm border-primary/20 md:inline-flex print:hidden"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Scroll to top"
      title="Scroll to top"
    >
      <ArrowUp className="h-4 w-4" />
    </Button>
  );
}
