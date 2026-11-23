import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Santa's sleigh (rath) pulled by his reindeer (heeran), Rudolph leading
 * with a glowing nose. Hand-drawn SVG, no downloaded artwork.
 *
 * Motion (globals.css, `.md-sleigh-*`): the reindeer gallop (front and back
 * legs in opposite phase, each deer a beat apart), the team bobs, Rudolph's
 * nose glows, the bells on the harness swing, and a trail of stardust
 * twinkles behind the runners. `flying={false}` freezes the pose.
 *
 * Faces right; the team leads. The sleigh carries the TMD badge.
 */
export function SantaSleigh({
  className,
  flying = true,
  title,
}: {
  className?: string;
  flying?: boolean;
  title?: string;
}) {
  const id = React.useId().replace(/:/g, "");
  const a = (cls: string) => (flying ? cls : undefined);
  const fur = `url(#${id}-fur)`;
  const red = `url(#${id}-red)`;
  const gold = `url(#${id}-gold)`;
  const deer = `url(#${id}-deer)`;

  const reindeer = (x: number, y: number, phase: number, rudolph: boolean, key: string) => (
    <g key={key} transform={`translate(${x} ${y})`}>
      <g className={a("md-sleigh-deer-bob")} style={{ animationDelay: `${-phase * 0.12}s` }}>
        {/* far legs (darker) */}
        <g fill="#5b3a24">
          <rect
            className={a("md-sleigh-leg-b")}
            style={{ animationDelay: `${-phase * 0.12}s` }}
            x="5"
            y="20"
            width="5"
            height="22"
            rx="2.5"
          />
          <rect
            className={a("md-sleigh-leg-f")}
            style={{ animationDelay: `${-phase * 0.12}s` }}
            x="35"
            y="18"
            width="5"
            height="22"
            rx="2.5"
          />
        </g>
        {/* body */}
        <path d="M0 16C2 6 14 2 26 3C38 4 46 8 48 16C49 24 42 28 30 28H14C5 28 -1 24 0 16Z" fill={deer} />
        <path d="M8 22C16 26 30 26 40 23" stroke="#e7c9a9" strokeWidth="3" strokeLinecap="round" opacity="0.6" fill="none" />
        {/* tail */}
        <path d="M0 12c-5-2-7 2-5 5 2 1 4 0 5-2z" fill="#f8fafc" />
        {/* harness with bells */}
        <path d="M30 4C31 12 31 20 30 28" stroke="#b91c1c" strokeWidth="4" fill="none" />
        <g className={a("md-sleigh-bells")}>
          <circle cx="30" cy="10" r="2.4" fill={gold} />
          <circle cx="30" cy="17" r="2.4" fill={gold} />
          <circle cx="30" cy="24" r="2.4" fill={gold} />
        </g>
        {/* near legs */}
        <g fill="#7c4a2d">
          <rect
            className={a("md-sleigh-leg-f")}
            style={{ animationDelay: `${-phase * 0.12 - 0.12}s` }}
            x="10"
            y="20"
            width="5.5"
            height="23"
            rx="2.75"
          />
          <rect
            className={a("md-sleigh-leg-b")}
            style={{ animationDelay: `${-phase * 0.12 - 0.12}s` }}
            x="40"
            y="18"
            width="5.5"
            height="23"
            rx="2.75"
          />
        </g>
        {/* hooves */}
        {/* neck + head */}
        <path d="M40 10C44 2 50 -6 56 -10L62 -4C58 2 52 10 48 16Z" fill={deer} />
        <path d="M54 -14C60 -18 68 -16 72 -11C74 -8 72 -5 68 -5H58C54 -6 52 -10 54 -14Z" fill={deer} />
        <path d="M58 -6C62 -4 67 -4 70 -6" stroke="#e7c9a9" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.7" />
        {/* ear */}
        <path d="M55 -14c-5-3-8-1-8 2 3 1 6 0 8-2z" fill="#5b3a24" />
        {/* antlers */}
        <g stroke="#a16207" strokeWidth="2.2" strokeLinecap="round" fill="none">
          <path d="M58 -15C56 -22 52 -26 47 -28M53 -22L50 -30M56 -19L60 -26" />
          <path d="M62 -15C62 -22 66 -27 71 -29M65 -22L63 -30M64 -19L70 -24" />
        </g>
        {/* eye */}
        <circle cx="63" cy="-11" r="1.3" fill="#111827" />
        <circle cx="63.4" cy="-11.4" r="0.45" fill="#fff" />
        {/* nose */}
        {rudolph ? (
          <g>
            <circle className={a("md-sleigh-rudolph")} cx="72" cy="-8.5" r="6" fill="#ef4444" opacity="0.35" />
            <circle cx="72" cy="-8.5" r="3" fill="#ef4444" />
            <circle cx="71.2" cy="-9.4" r="0.9" fill="#fff" opacity="0.8" />
          </g>
        ) : (
          <circle cx="72" cy="-8.5" r="2.4" fill="#1f2937" />
        )}
        {/* collar */}
        <path d="M44 6C47 9 51 9 54 6" stroke="#b91c1c" strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>
    </g>
  );

  return (
    <svg
      viewBox="0 0 460 150"
      className={cn("overflow-visible", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={`${id}-red`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ef4444" />
          <stop offset="1" stopColor="#991b1b" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
        <radialGradient id={`${id}-fur`} cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d9e2ec" />
        </radialGradient>
        <linearGradient id={`${id}-deer`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a16a43" />
          <stop offset="1" stopColor="#6b4226" />
        </linearGradient>
        <radialGradient id={`${id}-skin`} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#fde4cf" />
          <stop offset="1" stopColor="#efae86" />
        </radialGradient>
        <radialGradient id={`${id}-dust`}>
          <stop offset="0" stopColor="#fff7cc" />
          <stop offset="1" stopColor="#fff7cc" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-badge`}>
          <rect x="74" y="92" width="34" height="20" rx="4" />
        </clipPath>
      </defs>

      {/* stardust trail behind the runners */}
      <g className={a("md-sleigh-dust")}>
        {[
          [6, 120, 5],
          [-14, 112, 3.5],
          [-30, 124, 4],
          [-48, 114, 2.6],
          [-66, 122, 3],
          [-86, 116, 2],
        ].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill={`url(#${id}-dust)`} style={{ animationDelay: `${i * 0.18}s` }} className={a("md-sleigh-spark")} />
        ))}
      </g>

      {/* reins from Santa's hands to the team */}
      <path d="M118 72C170 70 220 74 268 80M118 74C190 84 300 86 372 80" stroke="#7f1d1d" strokeWidth="1.6" fill="none" />

      {/* ---------- the team: back pair, then Rudolph's pair in front ---------- */}
      {reindeer(250, 78, 0, false, "d1")}
      {reindeer(356, 74, 2, true, "d2")}

      {/* ---------- sleigh ---------- */}
      <g className={a("md-sleigh-bob")}>
        {/* sack of presents */}
        <path d="M18 70C10 52 22 36 40 38C56 40 62 54 56 72Z" fill="#7c2d12" />
        <path d="M24 48c6-4 16-4 22 0" stroke="#a3511f" strokeWidth="2" fill="none" />
        <rect x="26" y="30" width="16" height="14" rx="2" fill="#16a34a" />
        <rect x="33" y="30" width="3" height="14" fill="#ef4444" />
        <rect x="40" y="24" width="12" height="20" rx="2" fill="#1e3a8a" />
        <rect x="43" y="27" width="6" height="12" rx="1.5" fill="none" stroke="#93c5fd" strokeWidth="1" />
        <rect x="14" y="36" width="14" height="12" rx="2" fill="#e11d48" />
        <rect x="20" y="36" width="2.6" height="12" fill="#fbbf24" />

        {/* Santa (seated) */}
        <g>
          <path d="M70 84C66 66 74 52 90 52C104 52 112 64 110 84Z" fill={red} />
          <rect x="86" y="54" width="7" height="30" rx="3.5" fill={fur} />
          <rect x="68" y="70" width="44" height="7" rx="2" fill="#111827" />
          <rect x="84" y="68.5" width="10" height="10" rx="2" fill="none" stroke={gold} strokeWidth="2.2" />
          {/* arm holding the reins */}
          <path d="M100 62C108 64 114 68 118 72" stroke={red} strokeWidth="10" strokeLinecap="round" fill="none" />
          <circle cx="119" cy="73" r="5" fill="#0f172a" />
          {/* head */}
          <circle cx="90" cy="38" r="12" fill={`url(#${id}-skin)`} />
          <g fill={fur}>
            <circle cx="84" cy="47" r="8.5" />
            <circle cx="92" cy="51" r="9" />
            <circle cx="99" cy="46" r="7.5" />
            <circle cx="90" cy="58" r="6" />
          </g>
          <path d="M89 45c-3-3-8-2-9 1 3 2 6 2 9-1zM91 45c3-3 8-2 9 1-3 2-6 2-9-1z" fill="#fff" />
          <circle cx="98" cy="40" r="3" fill="#f87171" />
          <ellipse cx="94" cy="34.5" rx="1.4" ry="1.9" fill="#1f2937" />
          <path d="M90 30.5c2.5-2 6-2 8-0.4" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          {/* hat streaming back in the wind */}
          <path d="M78 30C76 16 86 10 98 14C102 16 104 21 102 27Z" fill={red} />
          <path d="M80 20C72 14 60 16 54 22" stroke={red} strokeWidth="8" strokeLinecap="round" fill="none" />
          <circle className={a("md-sleigh-pom")} cx="52" cy="23" r="5.5" fill={fur} />
          <rect x="76" y="26" width="29" height="8" rx="4" fill={fur} transform="rotate(-8 90 30)" />
        </g>

        {/* sleigh body with gold trim */}
        <path d="M20 72H118C128 72 134 80 132 92C130 106 118 114 102 114H44C28 114 18 102 16 88Z" fill={red} />
        <path d="M20 72H118C128 72 134 80 132 92" stroke={gold} strokeWidth="3.2" fill="none" strokeLinecap="round" />
        <path d="M28 104C40 110 90 110 110 104" stroke={gold} strokeWidth="1.6" fill="none" opacity="0.8" />
        <path d="M30 84c6-6 14-6 18 0M44 84c4 6 10 6 14 0" stroke={gold} strokeWidth="1.6" fill="none" opacity="0.85" />
        {/* TMD badge on the side */}
        <rect x="72" y="90" width="38" height="24" rx="5" fill="#fff" stroke="#fde68a" strokeWidth="1.5" />
        <image
          href="/brand/logo.png"
          x="74"
          y="92"
          width="34"
          height="20"
          preserveAspectRatio="xMidYMid meet"
          clipPath={`url(#${id}-badge)`}
        />
        {/* runners: struts + curled gold blade */}
        <path d="M44 114V124M100 114V124" stroke={gold} strokeWidth="3" strokeLinecap="round" />
        <path
          d="M10 126H128C142 126 150 118 148 108C147 102 141 100 138 104C136 107 139 110 142 108"
          stroke={gold}
          strokeWidth="3.6"
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
