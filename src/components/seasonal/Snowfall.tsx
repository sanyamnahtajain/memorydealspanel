"use client";

import * as React from "react";

import { flakeCount } from "@/lib/seasonal";
import { useSeason } from "./SeasonProvider";

/**
 * Falling snow, drawn BEHIND the page content.
 *
 * Never in the way, by construction:
 *  - it lives under the content in the shell's own stacking layer
 *    (`-z-10` inside an `isolate` shell), so cards, prices, photos and
 *    buttons always paint on top — snow shows only in the gaps;
 *  - `pointer-events: none` + `aria-hidden`: no taps, no screen-reader noise;
 *  - transform-only CSS animations (compositor, no JS per frame), a handful
 *    of flakes on a phone, paused while the tab is hidden;
 *  - nothing at all for "reduce motion" (system or in-app) or Data Saver.
 *
 * Rendered after mount only: flake positions are random per visit, and a
 * fixed layer that appears late shifts nothing on the page.
 */

type Kind = "dendrite" | "plate" | "dot";

export interface Flake {
  id: number;
  kind: Kind;
  x: number; // vw
  size: number; // px
  fall: number; // s
  sway: number; // s
  amp: number; // px
  delay: number; // s (negative → already mid-air on load)
  opacity: number;
}

function makeFlakes(count: number): Flake[] {
  return Array.from({ length: count }, (_, id) => {
    const r = Math.random();
    // Depth: most are small and far (soft dots), some mid, a few big crystals.
    const kind: Kind = r < 0.45 ? "dot" : r < 0.8 ? "dendrite" : "plate";
    const size =
      kind === "dot" ? 4 + Math.random() * 4 : kind === "dendrite" ? 11 + Math.random() * 9 : 9 + Math.random() * 7;
    const fall = (kind === "dot" ? 16 : 11) + Math.random() * 10;
    return {
      id,
      kind,
      x: Math.random() * 100,
      size: Math.round(size),
      fall: Math.round(fall * 10) / 10,
      sway: Math.round((3 + Math.random() * 3) * 10) / 10,
      amp: Math.round(12 + Math.random() * 22),
      delay: -Math.round(Math.random() * fall * 10) / 10,
      opacity: Math.round((kind === "dot" ? 0.5 + Math.random() * 0.3 : 0.65 + Math.random() * 0.3) * 100) / 100,
    };
  });
}

function shouldSkip(): boolean {
  if (typeof window === "undefined") return true;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  if (document.documentElement.getAttribute("data-reduce-motion") === "true") return true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return conn?.saveData === true;
}

export function Snowfall({ surface = "storefront" }: { surface?: "storefront" | "admin" }) {
  const season = useSeason();
  const [flakes, setFlakes] = React.useState<Flake[]>([]);
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    if (!season.winter || season.snow === "off" || shouldSkip()) return;
    const count = flakeCount(window.innerWidth, season.snow, surface);
    // Mount-time only: random per visit, client-only (never in SSR markup).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFlakes(makeFlakes(count));
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [season.winter, season.snow, surface]);

  if (flakes.length === 0) return null;

  return (
    <SnowLayer
      flakes={flakes}
      paused={paused}
      className="md-snow pointer-events-none fixed inset-0 -z-10 overflow-hidden select-none"
    />
  );
}

/** Random flakes for a layer (client only — call from an effect). */
export function randomFlakes(count: number): Flake[] {
  return makeFlakes(count);
}

/** The flakes themselves; positioned by the caller's className. */
export function SnowLayer({
  flakes,
  paused = false,
  className,
}: {
  flakes: Flake[];
  paused?: boolean;
  className: string;
}) {
  return (
    <div aria-hidden data-paused={paused ? "" : undefined} className={className}>
      <SnowflakeDefs />
      {flakes.map((f) => (
        <span
          key={f.id}
          className="md-flake"
          style={
            {
              left: `${f.x}vw`,
              width: f.size,
              height: f.size,
              opacity: f.opacity,
              "--fall": `${f.fall}s`,
              "--sway": `${f.sway}s`,
              "--amp": `${f.amp}px`,
              "--delay": `${f.delay}s`,
            } as React.CSSProperties
          }
        >
          <span className="md-flake-sway">
            <svg viewBox="-50 -50 100 100">
              <use href={`#md-flake-${f.kind}`} />
            </svg>
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * The three crystals, defined once and reused by every flake (<use>):
 *  - dendrite: six feathered arms, three pairs of side branches each;
 *  - plate:    a hexagonal plate with short tipped arms;
 *  - dot:      a soft round flake for depth (far away, out of focus).
 */
function SnowflakeDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <defs>
        <radialGradient id="md-flake-soft">
          <stop offset="0" stopColor="currentColor" stopOpacity="1" />
          <stop offset="0.55" stopColor="currentColor" stopOpacity="0.75" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
        <g id="md-flake-arm">
          <path d="M0 0V-44" />
          <path d="M0 -14l-9 -7M0 -14l9 -7" />
          <path d="M0 -25l-11 -9M0 -25l11 -9" />
          <path d="M0 -35l-6 -5M0 -35l6 -5" />
          <circle cx="0" cy="-44" r="2.6" stroke="none" fill="currentColor" />
        </g>
        <g
          id="md-flake-dendrite"
          fill="none"
          stroke="currentColor"
          strokeWidth="4.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <use key={deg} href="#md-flake-arm" transform={`rotate(${deg})`} />
          ))}
          <circle r="5" fill="currentColor" stroke="none" />
        </g>
        <g id="md-flake-plate" fill="currentColor" stroke="currentColor" strokeLinejoin="round">
          <polygon points="0,-16 13.9,-8 13.9,8 0,16 -13.9,8 -13.9,-8" opacity="0.85" stroke="none" />
          <polygon
            points="0,-9 7.8,-4.5 7.8,4.5 0,9 -7.8,4.5 -7.8,-4.5"
            fill="none"
            strokeWidth="2.2"
            opacity="0.6"
          />
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <g key={deg} transform={`rotate(${deg})`} strokeWidth="5" strokeLinecap="round">
              <path d="M0 -15V-38" fill="none" />
              <path d="M0 -44l-6 6 6 6 6 -6z" stroke="none" />
            </g>
          ))}
        </g>
        <circle id="md-flake-dot" r="48" fill="url(#md-flake-soft)" />
      </defs>
    </svg>
  );
}
