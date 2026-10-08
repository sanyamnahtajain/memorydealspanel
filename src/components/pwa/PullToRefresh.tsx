"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { hapticTap } from "@/lib/haptics";
import { Spinner } from "@/components/ui/spinner";

/**
 * Pull-to-refresh for the INSTALLED app.
 *
 * In a browser tab the OS already provides this gesture. In standalone mode
 * many Android launchers do not, so a retailer who opens the installed shop
 * in the morning has no way to ask for fresh stock except killing the app.
 * This is that gesture: pull down from the very top, past a threshold, let
 * go, and the current route re-renders from the server (router.refresh keeps
 * scroll and state — it is a data refresh, not a reload).
 *
 * Renders nothing outside standalone mode, and never fights the browser's own
 * pull-to-refresh, which is why it checks display-mode rather than touch.
 */

const THRESHOLD_PX = 72;
const MAX_PULL_PX = 110;

function isStandalone(): boolean {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

export function PullToRefresh() {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(false);
  const [pull, setPull] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  // Mirrors `startY !== null` as state, because render must not read a ref.
  const [dragging, setDragging] = React.useState(false);
  const startY = React.useRef<number | null>(null);
  const armed = React.useRef(false);

  React.useEffect(() => {
    const t = setTimeout(() => setEnabled(isStandalone()), 0);
    return () => clearTimeout(t);
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    const onStart = (e: TouchEvent) => {
      if (window.scrollY > 0 || refreshing) return;
      startY.current = e.touches[0]?.clientY ?? null;
      armed.current = false;
      if (startY.current !== null) setDragging(true);
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
      if (dy <= 0 || window.scrollY > 0) {
        setPull(0);
        return;
      }
      // Rubber-band: the indicator follows the finger with diminishing returns.
      const eased = Math.min(MAX_PULL_PX, dy * 0.55);
      setPull(eased);
      if (eased >= THRESHOLD_PX && !armed.current) {
        armed.current = true;
        hapticTap();
      }
    };
    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      setDragging(false);
      if (armed.current) {
        setRefreshing(true);
        setPull(THRESHOLD_PX * 0.6);
        router.refresh();
        // router.refresh() has no completion signal; hold the spinner briefly.
        setTimeout(() => {
          setRefreshing(false);
          setPull(0);
        }, 900);
      } else {
        setPull(0);
      }
      armed.current = false;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, refreshing, router]);

  if (!enabled || (pull === 0 && !refreshing)) return null;
  const ready = pull >= THRESHOLD_PX;

  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-50 flex justify-center"
      style={{ transform: `translateY(${pull - 40}px)`, transition: dragging ? undefined : "transform 200ms ease-out" }}
    >
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-full border border-border bg-background/95 text-muted-foreground shadow-md backdrop-blur transition-colors",
          ready && "text-primary",
        )}
      >
        {refreshing ? (
          <Spinner size="sm" label="Refreshing" />
        ) : (
          <ArrowDown
            className="size-5 transition-transform duration-200"
            style={{ transform: `rotate(${ready ? 180 : 0}deg)` }}
            aria-hidden
          />
        )}
      </div>
      <span className="sr-only">{refreshing ? "Refreshing" : ready ? "Release to refresh" : "Pull to refresh"}</span>
    </div>
  );
}
