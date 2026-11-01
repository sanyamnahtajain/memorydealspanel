"use client";

import * as React from "react";
import { ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { hapticTap } from "@/lib/haptics";

const SHOW_AFTER_PX = 1200;

/**
 * Floating "back to top" for long listings. Appears only after a real scroll
 * (a couple of screens), bottom-left so it never fights the WhatsApp float on
 * the right, and on phones above the floating cart bar and the tab bar. Reduced motion: no slide, just
 * appears.
 */
export function BackToTop() {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setVisible(window.scrollY > SHOW_AFTER_PX);
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="Back to top"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={() => {
        hapticTap();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
      className={cn(
        "fixed left-4 bottom-[calc(var(--md-tab-h,3.5rem)+4.5rem+env(safe-area-inset-bottom))] z-30 hidden md:inline-flex size-11 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-md backdrop-blur outline-none transition-[opacity,transform] duration-200 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-90 motion-reduce:transition-none md:bottom-6",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
      )}
    >
      <ArrowUp aria-hidden className="size-5" />
    </button>
  );
}
