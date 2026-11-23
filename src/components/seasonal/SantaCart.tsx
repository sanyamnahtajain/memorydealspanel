import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Santa pushing a TMD shopping cart full of presents — hand-drawn SVG, no
 * downloaded artwork (no licensing to worry about, crisp at any size).
 *
 * Detail: two-tone coat with folds and gold buttons, fur trim, belt and
 * buckle, curly beard, bushy brows, rosy nose, mittens, boots with soles.
 * The cart carries the shop's own logo on a badge and a waving TMD pennant,
 * gift boxes, a phone box and a charger.
 *
 * Motion (plain CSS in globals.css, `.md-santa-*`): a two-step walk with
 * opposite leg + arm swing and a body bob, spinning wheels with a spray of
 * snow, the hat's pom-pom bouncing, a blink every few seconds, frosty breath
 * puffs, and the pennant waving. `walking={false}` freezes the pose.
 *
 * Faces right; the cart leads.
 */
export function SantaCart({
  className,
  walking = true,
  title,
}: {
  className?: string;
  walking?: boolean;
  /** Accessible name; omit for pure decoration (aria-hidden). */
  title?: string;
}) {
  const id = React.useId().replace(/:/g, "");
  const a = (cls: string) => (walking ? cls : undefined);
  const fur = `url(#${id}-fur)`;
  const coat = `url(#${id}-coat)`;
  return (
    <svg
      viewBox="0 0 250 170"
      className={cn("overflow-visible", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={`${id}-coat`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f05252" />
          <stop offset="0.55" stopColor="#dc2626" />
          <stop offset="1" stopColor="#991b1b" />
        </linearGradient>
        <linearGradient id={`${id}-coatDark`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c81e1e" />
          <stop offset="1" stopColor="#7f1d1d" />
        </linearGradient>
        <radialGradient id={`${id}-fur`} cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d9e2ec" />
        </radialGradient>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e2e8f0" />
          <stop offset="0.5" stopColor="#94a3b8" />
          <stop offset="1" stopColor="#475569" />
        </linearGradient>
        <radialGradient id={`${id}-skin`} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#fde4cf" />
          <stop offset="1" stopColor="#efae86" />
        </radialGradient>
        <linearGradient id={`${id}-boot`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f2937" />
          <stop offset="1" stopColor="#030712" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
        <clipPath id={`${id}-badge`}>
          <rect x="146" y="80" width="34" height="22" rx="4" />
        </clipPath>
      </defs>

      {/* ground shadow */}
      <ellipse cx="128" cy="158" rx="104" ry="5.5" fill="#0f172a" opacity="0.13" />

      {/* ============================ CART ============================ */}
      <g className={a("md-santa-bob-cart")}>
        {/* TMD pennant on a pole at the back of the basket */}
        <path d="M214 62V14" stroke="#64748b" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="214" cy="13" r="2.6" fill={`url(#${id}-gold)`} />
        <g className={a("md-santa-flag")} style={{ transformOrigin: "214px 18px" }}>
          <path d="M214 17C224 15 232 19 244 17L240 26L244 35C232 37 224 33 214 35Z" fill="#1d4ed8" />
          <path d="M214 17C224 15 232 19 244 17L240 26L244 35C232 37 224 33 214 35Z" fill="#fff" opacity="0.08" />
          <text
            x="227"
            y="29.5"
            textAnchor="middle"
            fontSize="9"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
            fill="#fff"
            letterSpacing="0.5"
          >
            TMD
          </text>
        </g>

        {/* presents poking out of the basket */}
        <g>
          <rect x="124" y="36" width="34" height="32" rx="2.5" fill="#e11d48" />
          <rect x="124" y="36" width="34" height="8" rx="2" fill="#be123c" opacity="0.5" />
          <rect x="138" y="36" width="6" height="32" fill={`url(#${id}-gold)`} />
          <rect x="124" y="48" width="34" height="6" fill={`url(#${id}-gold)`} />
          <path d="M141 36c-8-10-17-4-9 1zM141 36c8-10 17-4 9 1z" fill="#f59e0b" />
          <circle cx="141" cy="36" r="2.4" fill="#d97706" />

          {/* phone box (navy, phone outline) */}
          <rect x="160" y="26" width="26" height="42" rx="3" fill="#1e3a8a" />
          <rect x="160" y="26" width="26" height="6" rx="3" fill="#2563eb" opacity="0.6" />
          <rect x="165.5" y="32" width="15" height="28" rx="3" fill="none" stroke="#93c5fd" strokeWidth="1.7" />
          <rect x="170.5" y="34" width="5" height="1.4" rx="0.7" fill="#93c5fd" />
          <circle cx="173" cy="56.5" r="1.2" fill="#93c5fd" />

          {/* green box, red ribbon */}
          <rect x="188" y="40" width="26" height="28" rx="2.5" fill="#16a34a" />
          <rect x="198.5" y="40" width="5" height="28" fill="#ef4444" />
          <rect x="188" y="51" width="26" height="5" fill="#ef4444" />
          <path d="M201 40c-6-8-13-3-7 1zM201 40c6-8 13-3 7 1z" fill="#dc2626" />

          {/* charger cube */}
          <rect x="144" y="56" width="17" height="15" rx="3" fill="#f8fafc" stroke="#cbd5e1" />
          <rect x="148" y="51" width="2.4" height="6" rx="1" fill="#94a3b8" />
          <rect x="154.5" y="51" width="2.4" height="6" rx="1" fill="#94a3b8" />
          <path d="M151 63l2.6-3.4v2.6h2.1l-2.6 3.4V63z" fill="#22c55e" />
        </g>

        {/* basket: wire mesh with a chrome rim */}
        <path d="M116 64H226L214 112H129Z" fill="#e2e8f0" opacity="0.35" />
        <g stroke={`url(#${id}-metal)`} strokeWidth="2" fill="none" strokeLinecap="round">
          {[132, 148, 164, 180, 196, 211].map((x, i) => (
            <path key={x} d={`M${x} 64L${x + 3.4 - i * 0.7} 112`} />
          ))}
          <path d="M119.5 80H222M123 96H218" />
        </g>
        <path d="M116 64H226L214 112H129Z" fill="none" stroke={`url(#${id}-metal)`} strokeWidth="3.4" strokeLinejoin="round" />
        <path d="M118 65.5H224" stroke="#fff" strokeWidth="1" opacity="0.7" />

        {/* TMD logo badge on the basket front */}
        <rect x="144" y="78" width="38" height="26" rx="5" fill="#fff" stroke="#cbd5e1" strokeWidth="1.2" />
        <image
          href="/brand/logo.png"
          x="146"
          y="80"
          width="34"
          height="22"
          preserveAspectRatio="xMidYMid meet"
          clipPath={`url(#${id}-badge)`}
        />

        {/* chassis, bumper, handle */}
        <g stroke="#475569" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M129 112L136 132H212L214 112" />
          <path d="M116 64L104 48" />
        </g>
        <path d="M210 132h10" stroke="#ef4444" strokeWidth="4" strokeLinecap="round" />
        <rect x="95" y="42" width="15" height="7.5" rx="3.75" fill="#0f172a" transform="rotate(-50 102.5 45.75)" />

        {/* snow spray behind the wheels */}
        <g className={a("md-santa-spray")} fill="#fff">
          <circle cx="126" cy="140" r="2" opacity="0.9" />
          <circle cx="121" cy="136" r="1.4" opacity="0.7" />
          <circle cx="186" cy="140" r="2" opacity="0.9" />
          <circle cx="181" cy="135" r="1.3" opacity="0.7" />
        </g>

        {/* wheels */}
        {[140, 202].map((cx) => (
          <g key={cx} transform={`translate(${cx} 142)`}>
            <g className={a("md-santa-wheel")}>
              <circle r="10.5" fill="#1f2937" />
              <circle r="10.5" fill="none" stroke="#374151" strokeWidth="2" />
              <circle r="5" fill="#cbd5e1" />
              <path d="M0-10V10M-10 0H10M-7-7L7 7M7-7L-7 7" stroke="#94a3b8" strokeWidth="1.1" />
              <circle r="1.8" fill="#475569" />
            </g>
          </g>
        ))}
      </g>

      {/* ============================ SANTA ============================ */}
      <g className={a("md-santa-bob")}>
        {/* back arm (swings) */}
        <g className={a("md-santa-arm-b")} style={{ transformOrigin: "52px 66px" }}>
          <path d="M52 66C46 78 42 88 44 96" stroke={`url(#${id}-coatDark)`} strokeWidth="11" strokeLinecap="round" fill="none" />
          <circle cx="44" cy="98" r="5.5" fill={fur} />
          <circle cx="44" cy="103" r="5.5" fill="#0f172a" />
        </g>

        {/* back leg */}
        <g className={a("md-santa-leg-b")} style={{ transformOrigin: "52px 108px" }}>
          <rect x="45" y="104" width="15" height="34" rx="6.5" fill={`url(#${id}-coatDark)`} />
          <rect x="44" y="128" width="17" height="7" rx="3" fill={fur} />
          <path d="M42 135h18c7 0 11 4 11 9v2H42z" fill={`url(#${id}-boot)`} />
          <rect x="42" y="144" width="29" height="3" rx="1.5" fill="#6b4f3a" />
        </g>

        {/* coat body */}
        <path
          d="M30 108C25 84 34 58 57 56C79 54 92 72 92 92C92 104 86 113 73 115H39C34 115 31 112 30 108Z"
          fill={coat}
        />
        {/* coat folds */}
        <path d="M40 72C36 84 36 96 40 106" stroke="#7f1d1d" strokeWidth="2.2" fill="none" opacity="0.4" strokeLinecap="round" />
        <path d="M84 78C88 88 88 98 84 106" stroke="#fca5a5" strokeWidth="2" fill="none" opacity="0.35" strokeLinecap="round" />
        {/* fur hem + front placket + buttons */}
        <rect x="27" y="107" width="67" height="12" rx="6" fill={fur} />
        <circle cx="33" cy="113" r="2" fill="#fff" />
        <circle cx="52" cy="111" r="2.4" fill="#fff" />
        <circle cx="76" cy="113" r="2.2" fill="#fff" />
        <rect x="67" y="60" width="9.5" height="48" rx="4.75" fill={fur} transform="rotate(8 71.75 84)" />
        <circle cx="70.5" cy="72" r="1.9" fill={`url(#${id}-gold)`} />
        <circle cx="72" cy="99" r="1.9" fill={`url(#${id}-gold)`} />
        {/* belt + buckle */}
        <rect x="30" y="86" width="62" height="10" rx="2" fill="#111827" />
        <rect x="30" y="86" width="62" height="2.5" rx="1" fill="#374151" />
        <rect x="62" y="83.5" width="15" height="15" rx="2.5" fill="none" stroke={`url(#${id}-gold)`} strokeWidth="3" />

        {/* front leg */}
        <g className={a("md-santa-leg-a")} style={{ transformOrigin: "66px 108px" }}>
          <rect x="58" y="104" width="15" height="34" rx="6.5" fill={coat} />
          <rect x="57" y="128" width="17" height="7" rx="3" fill={fur} />
          <path d="M55 135h18c7 0 11 4 11 9v2H55z" fill={`url(#${id}-boot)`} />
          <rect x="55" y="144" width="29" height="3" rx="1.5" fill="#6b4f3a" />
          <path d="M61 138h12" stroke="#fff" strokeWidth="1.2" opacity="0.3" strokeLinecap="round" />
        </g>

        {/* front arm reaching the cart handle */}
        <path d="M68 70C80 68 92 60 100 48" stroke={coat} strokeWidth="13" strokeLinecap="round" fill="none" />
        <path d="M72 66C82 64 90 58 96 50" stroke="#fca5a5" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.35" />
        <circle cx="97" cy="51" r="7" fill={fur} />
        <path d="M98 40c6-1 10 3 9 8s-6 7-10 4c-3-3-3-10 1-12z" fill="#0f172a" />
        <path d="M100 43c3 0 5 2 4.5 4" stroke="#334155" strokeWidth="1.2" fill="none" />

        {/* ------------------- head ------------------- */}
        <g>
          <circle cx="50" cy="42" r="10" fill={fur} />
          <circle cx="63" cy="38" r="14" fill={`url(#${id}-skin)`} />
          {/* beard: two-tone cloud of curls */}
          <g fill={fur}>
            <circle cx="53" cy="49" r="10" />
            <circle cx="63" cy="55" r="11" />
            <circle cx="73" cy="50" r="9" />
            <circle cx="57" cy="61" r="8" />
            <circle cx="68" cy="62" r="7.5" />
            <circle cx="62" cy="68" r="6" />
          </g>
          <g stroke="#cbd5e1" strokeWidth="1.1" fill="none" strokeLinecap="round" opacity="0.9">
            <path d="M55 52c2 2 4 2 5 0M64 58c2 2 4 2 5 0M58 64c1.5 1.5 3 1.5 4 0M70 53c1.5 1.5 3 1.5 4 0" />
          </g>
          {/* mustache: two lobes */}
          <path d="M61 47c-3-4-10-3-11 1 4 2 8 2 11-1z" fill="#fff" />
          <path d="M63 47c3-4 10-3 11 1-4 2-8 2-11-1z" fill="#fff" />
          {/* nose, cheek */}
          <circle cx="73" cy="42" r="3.6" fill="#f87171" />
          <circle cx="72" cy="41" r="1.1" fill="#fff" opacity="0.6" />
          <circle cx="65" cy="43" r="3.4" fill="#fda4af" opacity="0.65" />
          {/* eye (blinks) + bushy brow */}
          <g className={a("md-santa-blink")} style={{ transformOrigin: "68px 35px" }}>
            <ellipse cx="68" cy="35" rx="1.7" ry="2.3" fill="#1f2937" />
            <circle cx="68.6" cy="34.2" r="0.6" fill="#fff" />
          </g>
          <path d="M63 30.5c3-2.4 7-2.4 9.5-0.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" />
        </g>

        {/* frosty breath */}
        <g className={a("md-santa-breath")} fill="#fff">
          <circle cx="83" cy="47" r="2.6" opacity="0.7" />
          <circle cx="88" cy="44" r="3.2" opacity="0.5" />
          <circle cx="94" cy="42" r="2.4" opacity="0.35" />
        </g>

        {/* ------------------- hat ------------------- */}
        <g className={a("md-santa-hat-tip")} style={{ transformOrigin: "62px 28px" }}>
          <path d="M48 31C45 15 56 5 70 7C77 8 80 14 77 26Z" fill={coat} />
          <path d="M70 7C76 9 79 15 77 24" stroke="#7f1d1d" strokeWidth="2" fill="none" opacity="0.4" />
          <path d="M51 20C44 17 35 21 33 32" stroke={coat} strokeWidth="10" strokeLinecap="round" fill="none" />
          <g className={a("md-santa-pom")} style={{ transformOrigin: "32px 34px" }}>
            <circle cx="32" cy="35" r="7" fill={fur} />
            <circle cx="30" cy="33" r="2" fill="#fff" />
          </g>
        </g>
        <rect x="44" y="24" width="37" height="10" rx="5" fill={fur} transform="rotate(-6 62.5 29)" />
        <circle cx="52" cy="29" r="1.4" fill="#fff" />
        <circle cx="70" cy="26.5" r="1.2" fill="#fff" />
      </g>
    </svg>
  );
}
