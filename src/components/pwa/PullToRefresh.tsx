"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { hapticThreshold } from "@/lib/haptics";
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
 * Feedback: a bubble follows the finger with rubber-banding; a progress RING
 * fills as the pull approaches the threshold, the arrow flips and the ring
 * closes when armed (with one short haptic), then the spinner takes over
 * while the refresh is in flight.
 *
 * Renders nothing outside standalone mode, and never fights the browser's own
 * pull-to-refresh, which is why it checks display-mode rather than touch.
 */

export const THRESHOLD_PX = 72;
const MAX_PULL_PX = 110;

/** Ring geometry: a 40px bubble with a 2px stroke just inside its edge. */
const RING_R = 17;
const RING_C = 2 * Math.PI * RING_R;

/** 0..1 — how far the pull is towards arming, clamped. */
export function pullProgress(pull: number, threshold: number = THRESHOLD_PX): number {
  if (threshold <= 0) return 1;
  return Math.max(0, Math.min(1, pull / threshold));
}

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
        hapticThreshold();
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
  const progress = refreshing ? 1 : pullProgress(pull);

  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-50 flex justify-center"
      style={{
        transform: `translateY(${pull - 40}px)`,
        transition: dragging ? undefined : "transform 220ms var(--ease-out, ease-out)",
      }}
    >
      <div
        className={cn(
          "relative flex size-10 items-center justify-center rounded-full bg-background/95 text-muted-foreground shadow-md ring-1 ring-foreground/8 backdrop-blur transition-[color,transform] duration-200",
          ready && "scale-105 text-primary",
        )}
        style={{ opacity: Math.max(0.35, progress) }}
      >
        {/* Progress ring — fills clockwise from 12 o'clock as the pull nears
            the threshold; fully closed once armed. */}
        <svg
          aria-hidden
          viewBox="0 0 40 40"
          className="absolute inset-0 size-10 -rotate-90"
        >
          <circle
            cx="20"
            cy="20"
            r={RING_R}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeWidth="2"
          />
          <circle
            cx="20"
            cy="20"
            r={RING_R}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - progress)}
            style={{ transition: dragging ? undefined : "stroke-dashoffset 200ms ease-out" }}
          />
        </svg>
        {refreshing ? (
          <Spinner size="sm" label="Refreshing" />
        ) : (
          <ArrowDown
            className="relative size-4.5 transition-transform duration-200"
            style={{ transform: `rotate(${ready ? 180 : 0}deg)` }}
            aria-hidden
          />
        )}
      </div>
      <span className="sr-only">
        {refreshing ? "Refreshing" : ready ? "Release to refresh" : "Pull to refresh"}
      </span>
    </div>
  );
}
