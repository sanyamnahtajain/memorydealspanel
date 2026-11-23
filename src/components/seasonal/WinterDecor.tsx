"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { useSeason } from "./SeasonProvider";

/**
 * Winter / Christmas decorations. Every piece:
 *  - renders nothing outside the season (useSeason), so the markup costs
 *    nothing for eleven months of the year;
 *  - is `aria-hidden` + `pointer-events: none` — decoration only, it can
 *    never take a tap meant for the page;
 *  - is plain SVG, sized in CSS, crisp on any screen.
 */

/* ------------------------------------------------------------------ */
/* Snow deposits                                                      */
/* ------------------------------------------------------------------ */

/**
 * A strip of snow along an edge, tiled with an SVG pattern so it is the
 * same at 320px and 1920px:
 *  - "hang": snow overhanging a roof edge (under the sticky header) — a
 *    soft lip with rounded drips and, from tablet up, slim icicles;
 *  - "pile": snow lying ON a surface (top of the phone tab bar, top of a
 *    banner) — uneven mounds with a shaded underside.
 */
export function SnowDrift({
  variant,
  className,
  icicles = false,
}: {
  variant: "hang" | "pile";
  className?: string;
  /** Hang only: slim icicles between the drips. */
  icicles?: boolean;
}) {
  const season = useSeason();
  const id = React.useId().replace(/:/g, "");
  if (!season.winter) return null;

  if (variant === "pile") {
    return (
      <svg
        aria-hidden
        focusable="false"
        className={cn("md-snow-drift pointer-events-none block h-3 w-full", className)}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--md-snow-top)" />
            <stop offset="1" stopColor="var(--md-snow-shade)" />
          </linearGradient>
          <pattern id={`${id}-pile`} width="180" height="12" patternUnits="userSpaceOnUse">
            {/* soft blue shadow under the mounds */}
            <path
              d="M0 12V7C12 4 22 6 32 5S52 1 66 3 88 7 100 5 122 0 138 2 166 6 180 7V12Z"
              fill="var(--md-snow-shadow)"
            />
            <path
              d="M0 12V8C12 5 22 7 32 6S52 2 66 4 88 8 100 6 122 1 138 3 166 7 180 8V12Z"
              fill={`url(#${id}-shade)`}
              stroke="var(--md-snow-edge)"
              strokeWidth="0.8"
            />
            {/* sparkle glints */}
            <circle cx="62" cy="5.5" r="0.9" fill="#fff" opacity="0.9" />
            <circle cx="131" cy="4" r="0.7" fill="#fff" opacity="0.8" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id}-pile)`} />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden
      focusable="false"
      className={cn("md-snow-drift pointer-events-none block h-3.5 w-full", icicles && "md:h-5", className)}
    >
      <defs>
        <linearGradient id={`${id}-lip`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--md-snow-top)" />
          <stop offset="1" stopColor="var(--md-snow-shade)" />
        </linearGradient>
        <linearGradient id={`${id}-ice`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--md-ice)" stopOpacity="0.95" />
          <stop offset="1" stopColor="var(--md-ice)" stopOpacity="0.15" />
        </linearGradient>
        <pattern id={`${id}-hang`} width="220" height="20" patternUnits="userSpaceOnUse">
          {icicles ? (
            <g fill={`url(#${id}-ice)`}>
              <path d="M38 4l2.2 13 2.2-13z" />
              <path d="M101 4l1.6 9 1.6-9z" />
              <path d="M152 4l2 15 2-15z" />
              <path d="M196 4l1.4 7 1.4-7z" />
            </g>
          ) : null}
          <path
            d="M0 0H220V4C214 4 211 8 205 8S197 4 188 4 176 10 168 10 160 4 150 4 138 6 130 6 120 3 112 4 102 11 94 11 86 5 76 4 66 7 58 7 50 4 42 4 30 9 22 9 12 4 0 4Z"
            fill="var(--md-snow-shadow)"
            transform="translate(0 1)"
          />
          <path
            d="M0 0H220V4C214 4 211 8 205 8S197 4 188 4 176 10 168 10 160 4 150 4 138 6 130 6 120 3 112 4 102 11 94 11 86 5 76 4 66 7 58 7 50 4 42 4 30 9 22 9 12 4 0 4Z"
            fill={`url(#${id}-lip)`}
            stroke="var(--md-snow-edge)"
            strokeWidth="0.8"
          />
          <circle cx="47" cy="2" r="0.8" fill="#fff" />
          <circle cx="163" cy="2.5" r="0.7" fill="#fff" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}-hang)`} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Logo: a Santa hat (Christmas) or a snow cap (plain winter)          */
/* ------------------------------------------------------------------ */

/**
 * Sits on the logo mark's top-left corner. Sized from the mark itself
 * (`em`-free: percentages of the mark box) so it fits the 28px admin mark
 * and the 32px storefront mark alike.
 */
export function LogoWinterDecor() {
  const season = useSeason();
  const id = React.useId().replace(/:/g, "");
  if (!season.winter) return null;

  if (!season.christmas) {
    return (
      <svg
        aria-hidden
        viewBox="0 0 40 12"
        className="pointer-events-none absolute -top-[22%] left-[-8%] w-[116%]"
      >
        <path
          d="M2 11C1 6 6 3 11 4S16 1 22 2 30 3 33 5 39 7 38 11Z"
          fill="var(--md-snow-shadow)"
          transform="translate(0 1)"
        />
        <path d="M2 11C1 6 6 3 11 4S16 1 22 2 30 3 33 5 39 7 38 11Z" fill="var(--md-snow-top)" />
        <path d="M9 11c0 2 2 2 2 0M27 11c0 3 2.4 3 2.4 0" stroke="var(--md-snow-top)" strokeWidth="1.6" fill="none" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden
      viewBox="0 0 64 56"
      className="md-santa-hat pointer-events-none absolute -top-[34%] -left-[22%] w-[78%] -rotate-[18deg] drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]"
    >
      <defs>
        <linearGradient id={`${id}-red`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ef4444" />
          <stop offset="0.55" stopColor="#dc2626" />
          <stop offset="1" stopColor="#991b1b" />
        </linearGradient>
        <radialGradient id={`${id}-fur`} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dbe4ee" />
        </radialGradient>
      </defs>
      {/* hat body flopping over to the right */}
      <path
        d="M10 44C12 28 20 12 34 8C44 5 54 9 57 18C59 24 56 31 52 33C52 26 48 20 42 20C36 21 34 30 36 44Z"
        fill={`url(#${id}-red)`}
      />
      {/* fold shading */}
      <path d="M42 20C48 20 52 26 52 33C49 30 46 27 42 25Z" fill="#7f1d1d" opacity="0.45" />
      <path d="M18 40C20 28 25 18 33 13" stroke="#fca5a5" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.5" />
      {/* fluffy brim: a band of overlapping puffs */}
      <g fill={`url(#${id}-fur)`}>
        <rect x="5" y="40" width="37" height="11" rx="5.5" />
        <circle cx="9" cy="45.5" r="5.5" />
        <circle cx="16" cy="44" r="5.5" />
        <circle cx="23" cy="46" r="5.5" />
        <circle cx="30" cy="44" r="5.5" />
        <circle cx="37" cy="45.5" r="5.5" />
      </g>
      {/* pom-pom */}
      <circle cx="53" cy="36" r="7" fill={`url(#${id}-fur)`} />
      <circle cx="51" cy="34" r="2" fill="#fff" opacity="0.9" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Fairy lights along the header (Christmas, tablet + desktop)         */
/* ------------------------------------------------------------------ */

const BULB_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#ec4899"] as const;

/**
 * A string of warm bulbs hanging from the header's snowy edge. Each bulb
 * twinkles on its own beat (CSS, opacity/glow only). Hidden on phones —
 * a 56px header is busy enough there.
 */
export function FairyLights({ className }: { className?: string }) {
  const season = useSeason();
  if (!season.winter || !season.christmas) return null;
  const bulbs = Array.from({ length: 26 }, (_, i) => i);
  return (
    <div aria-hidden className={cn("md-fairy-lights pointer-events-none hidden h-6 w-full md:flex", className)}>
      {bulbs.map((i) => {
        const color = BULB_COLORS[i % BULB_COLORS.length];
        return (
          // One cell per bulb: a sagging length of wire across the cell and
          // the bulb hanging from its lowest point — the string stays
          // continuous at any screen width.
          <div key={i} className="relative h-full min-w-0 flex-1">
            <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="absolute inset-x-0 top-0 h-2.5 w-full">
              <path
                d="M0 1.5Q50 11 100 1.5"
                fill="none"
                stroke="var(--md-wire)"
                strokeWidth="1.6"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <svg
              viewBox="0 0 10 18"
              className="md-bulb absolute top-[7px] left-1/2 h-4 w-2.5 -translate-x-1/2"
              style={{ animationDelay: `${(i * 0.37) % 2.4}s`, color } as React.CSSProperties}
            >
              <rect x="3" y="0" width="4" height="4" rx="1" fill="var(--md-wire)" />
              <path d="M5 4C1.5 6 1 11 2.4 14.2 3.2 16 6.8 16 7.6 14.2 9 11 8.5 6 5 4Z" fill="currentColor" />
              <path d="M4 7C3 8.5 3 11 3.6 12.5" stroke="#fff" strokeWidth="1" strokeLinecap="round" opacity="0.7" fill="none" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Footer scene (desktop footer)                                       */
/* ------------------------------------------------------------------ */

/**
 * A quiet winter landscape across the top of the footer: three layers of
 * snowy hills, pines dusted with snow, a moon and a few twinkling stars.
 */
export function WinterScene({ className }: { className?: string }) {
  const season = useSeason();
  const id = React.useId().replace(/:/g, "");
  if (!season.winter) return null;

  const pine = (x: number, base: number, h: number, key: string) => {
    const w = h * 0.62;
    const tiers = [0, 0.3, 0.58];
    return (
      <g key={key}>
        <rect x={x - h * 0.04} y={base - h * 0.12} width={h * 0.08} height={h * 0.14} fill="var(--md-pine-trunk)" />
        {tiers.map((t, i) => {
          const top = base - h + t * h * 0.9;
          const bottom = top + h * (0.48 - i * 0.04);
          const half = (w / 2) * (0.6 + i * 0.22);
          return (
            <g key={i}>
              <path d={`M${x} ${top}L${x + half} ${bottom}H${x - half}Z`} fill="var(--md-pine)" />
              {/* snow on each tier */}
              <path
                d={`M${x} ${top}L${x + half * 0.55} ${top + (bottom - top) * 0.55}Q${x} ${top + (bottom - top) * 0.42} ${x - half * 0.55} ${top + (bottom - top) * 0.55}Z`}
                fill="var(--md-snow-top)"
              />
            </g>
          );
        })}
      </g>
    );
  };

  return (
    <div aria-hidden className={cn("pointer-events-none relative h-32 w-full overflow-hidden", className)}>
      <svg viewBox="0 0 1200 120" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id={`${id}-far`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--md-hill-far)" />
            <stop offset="1" stopColor="var(--md-snow-shade)" />
          </linearGradient>
          <linearGradient id={`${id}-near`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--md-snow-top)" />
            <stop offset="1" stopColor="var(--md-snow-shade)" />
          </linearGradient>
          <radialGradient id={`${id}-moon`}>
            <stop offset="0.6" stopColor="var(--md-moon)" />
            <stop offset="1" stopColor="var(--md-moon)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* moon + stars */}
        <circle cx="1040" cy="46" r="22" fill={`url(#${id}-moon)`} opacity="0.55" />
        <circle cx="1040" cy="46" r="11" fill="var(--md-moon)" />
        {[
          [120, 18],
          [260, 34],
          [410, 14],
          [600, 28],
          [760, 12],
          [900, 40],
          [1150, 52],
        ].map(([x, y], i) => (
          <path
            key={i}
            className="md-star"
            style={{ animationDelay: `${i * 0.55}s` } as React.CSSProperties}
            d={`M${x} ${y - 4}L${x + 1} ${y - 1}L${x + 4} ${y}L${x + 1} ${y + 1}L${x} ${y + 4}L${x - 1} ${y + 1}L${x - 4} ${y}L${x - 1} ${y - 1}Z`}
            fill="var(--md-star)"
          />
        ))}
        {/* far hills */}
        <path d="M0 120V70C120 52 220 60 330 66S560 44 700 58 930 74 1040 60 1160 54 1200 58V120Z" fill={`url(#${id}-far)`} />
        {/* pines on the far ridge */}
        {[
          [90, 72, 40],
          [120, 74, 30],
          [380, 66, 36],
          [640, 62, 44],
          [672, 64, 32],
          [960, 66, 38],
          [992, 66, 28],
        ].map(([x, b, h], i) => pine(x, b, h, `f${i}`))}
        {/* near hills */}
        <path d="M0 120V92C150 80 260 96 420 90S700 76 860 88 1100 98 1200 86V120Z" fill={`url(#${id}-near)`} />
        {[
          [210, 96, 58],
          [252, 98, 42],
          [520, 92, 48],
          [770, 86, 62],
          [814, 88, 44],
          [1120, 94, 54],
        ].map(([x, b, h], i) => pine(x, b, h, `n${i}`))}
        {/* drift glints */}
        <circle cx="520" cy="90" r="1.2" fill="#fff" />
        <circle cx="905" cy="94" r="1" fill="#fff" />
      </svg>
    </div>
  );
}
