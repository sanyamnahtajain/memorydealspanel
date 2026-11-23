"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { armSeasonalAudio, playSleighBells } from "@/lib/seasonal-sound";
import { SantaCart } from "./SantaCart";
import { SantaSleigh } from "./SantaSleigh";
import { useSeason } from "./SeasonProvider";

/**
 * Now and then, Santa pushes his cart across the bottom of the shop.
 *
 * A treat, never an obstacle:
 *  - Christmas touches only (season.christmas), storefront only;
 *  - first stroll ~7s after the page opens, then every 90–150s, at most
 *    three times per visit (sessionStorage);
 *  - never on cart / checkout / account / sign-in screens, where people are
 *    finishing an order;
 *  - `pointer-events: none` + aria-hidden; sits UNDER the tab bar, the cart
 *    bar and every dialog (z-30), and steps aside when a bar sits flush on
 *    the tab bar (globals.css);
 *  - nothing for "reduce motion" or Data Saver; paused while the tab is
 *    hidden (no stroll starts in the background).
 */

const COUNT_KEY = "md-santa-strolls";
const BELLS_KEY = "md-sleigh-bells";
const MAX_PER_VISIT = 3;
const QUIET_PATHS = ["/account", "/checkout", "/gate", "/maintenance"];

function allowed(): boolean {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (document.documentElement.getAttribute("data-reduce-motion") === "true") return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return conn?.saveData !== true;
}

function strollsSoFar(): number {
  try {
    return Number(window.sessionStorage.getItem(COUNT_KEY) ?? "0") || 0;
  } catch {
    return MAX_PER_VISIT; // no storage → be conservative
  }
}

export function SantaParade() {
  const season = useSeason();
  const pathname = usePathname();
  // The appearance on stage right now (its number this visit), or 0.
  const [run, setRun] = React.useState(0);
  const quiet = QUIET_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Sound needs a tap first (browser rule); arm the wake-up early.
  React.useEffect(() => {
    if (season.winter && season.christmas && season.sounds) armSeasonalAudio();
  }, [season.winter, season.christmas, season.sounds]);

  React.useEffect(() => {
    if (!season.winter || !season.christmas || quiet || !allowed()) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (ms: number) => {
      timer = setTimeout(() => {
        if (strollsSoFar() >= MAX_PER_VISIT) return;
        if (document.hidden) return schedule(10_000);
        const n = strollsSoFar() + 1;
        try {
          window.sessionStorage.setItem(COUNT_KEY, String(n));
        } catch {
          /* ignore */
        }
        setRun(n);
        schedule(90_000 + Math.random() * 60_000);
      }, ms);
    };
    schedule(7_000);
    return () => clearTimeout(timer);
  }, [season.winter, season.christmas, quiet]);

  // Odd appearances: the sleigh flies over; even: Santa walks his cart.
  const sleigh = run % 2 === 1;

  React.useEffect(() => {
    if (!sleigh || !season.sounds) return;
    try {
      if (window.sessionStorage.getItem(BELLS_KEY)) return;
      // Only marked as heard if the browser actually let it play.
      if (playSleighBells()) window.sessionStorage.setItem(BELLS_KEY, "1");
    } catch {
      /* ignore */
    }
  }, [run, sleigh, season.sounds]);

  if (run === 0 || quiet) return null;

  if (sleigh) {
    return (
      <div
        aria-hidden
        // Flies in the "sky" BEHIND the page (z-[-5] inside the isolated
        // shell, above the snow): headings and cards always paint over it,
        // so it can never hide a word. py: room for the rise and dip.
        className="pointer-events-none fixed inset-x-0 z-[-5] overflow-hidden py-12 top-[calc(env(safe-area-inset-top)+6rem)] md:top-16"
      >
        <div
          key={run}
          className="md-sleigh-flight w-60 md:w-[26rem]"
          style={{ "--md-flight-s": "11s" } as React.CSSProperties}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) setRun(0);
          }}
        >
          <SantaSleigh className="h-auto w-full" />
        </div>
      </div>
    );
  }

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 z-30 overflow-hidden bottom-[calc(var(--md-tab-h,3.5rem)+env(safe-area-inset-bottom)+0.25rem)] md:bottom-2"
    >
      <div
        key={run}
        className="md-santa-parade w-[7.5rem] md:w-40"
        style={{ "--md-parade-s": "13s" } as React.CSSProperties}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) setRun(0);
        }}
      >
        <SantaCart />
      </div>
    </div>
  );
}
