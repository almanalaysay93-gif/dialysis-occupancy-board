"use client";

import * as React from "react";
import { useEffect, useRef } from "react";

let scrollTriggerRegistered = false;

/**
 * Lightweight client-only GSAP ScrollTrigger registration.
 * Loaded via dynamic import so GSAP never touches SSR/print paths.
 */
async function ensureScrollTrigger() {
  const [gsapModule, triggerModule] = await Promise.all([
    // @ts-ignore
    import("gsap"),
    // @ts-ignore
    import("gsap/ScrollTrigger"),
  ]);
  const gsap = gsapModule.gsap;
  const ScrollTrigger = triggerModule.ScrollTrigger;
  if (typeof window !== "undefined" && !scrollTriggerRegistered) {
    gsap.registerPlugin(ScrollTrigger);
    scrollTriggerRegistered = true;
  }
  return { gsap, ScrollTrigger };
}

export interface ScrollRevealProps {
  children: React.ReactNode;
  /** How far the element slides in before settling (px). Default 40 */
  yOffset?: number;
  /** Optional entrance delay between siblings (ms). Default 0 */
  delay?: number;
  /** Animation duration (s). Default 0.8 */
  duration?: number;
  className?: string;
}

/**
 * ScrollReveal wraps a section so it fades and slides in as the user
 * scrolls it into view. Print-safe (animations only run in the browser
 * with JavaScript) and respects prefers-reduced-motion.
 */
export function ScrollReveal({
  children,
  yOffset = 40,
  delay = 0,
  duration = 0.8,
  className,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const revealDoneRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !ref.current) return;

    // Respect reduced motion: show content immediately.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let revert: (() => void) | undefined;
    let cancelled = false;

    void ensureScrollTrigger().then(({ gsap }) => {
      if (cancelled || !ref.current) return;
      const ctx = gsap.context(() => {
        const el = ref.current!;
        // If the element is already in view on mount, settle instantly.
        const rect = el.getBoundingClientRect();
        const inView = rect.top < window.innerHeight && rect.bottom > 0;

        gsap.set(el, inView ? { clearProps: "all" } : { opacity: 0, y: yOffset });
        if (inView) {
          revealDoneRef.current = true;
          return;
        }

        gsap.to(el, {
          opacity: 1,
          y: 0,
          duration,
          delay,
          ease: "power3.out",
          scrollTrigger: {
            trigger: el,
            start: "top 88%",
            toggleActions: "play none none none",
          },
          onStart: () => {
            revealDoneRef.current = true;
          },
        });
      }, ref);
      revert = () => ctx.revert();
    });

    return () => {
      cancelled = true;
      if (revert) revert();
    };
  }, [yOffset, delay, duration]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

export default ScrollReveal;
