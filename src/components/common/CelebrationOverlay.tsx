"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * Full-screen celebration takeover for milestone events (order placed,
 * request sent, …): a solid backdrop, a springing ring + draw-on check, a
 * radial confetti burst, then a clean fade-out revealing the page beneath.
 *
 * PWA-correct by construction: `fixed inset-0` covers the real viewport in
 * standalone display-mode (including under the notch), the CONTENT is inset by
 * the safe areas, and scroll is locked while visible. Reduced-motion users get
 * a brief static confirmation instead of the show.
 */

const CONFETTI_COLORS = [
  "bg-emerald-500",
  "bg-blue-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
];

/** Deterministic pseudo-random confetti spread (no Math.random — SSR-safe). */
const PIECES = Array.from({ length: 26 }, (_, i) => {
  const angle = (i / 26) * Math.PI * 2;
  const radius = 34 + ((i * 7) % 3) * 14; // 34 / 48 / 62 vmin rings
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    delay: 0.18 + (i % 5) * 0.05,
    size: i % 3 === 0 ? "size-2.5" : "size-1.5",
    round: i % 2 === 0,
  };
});

export interface CelebrationOverlayProps {
  title: string;
  subtitle?: string;
  /** Small extra content under the text (e.g. an order number, a badge). */
  footer?: React.ReactNode;
  /** How long the takeover stays before fading (default 2400ms). */
  durationMs?: number;
  /** Called once the overlay has fully left. */
  onDone?: () => void;
}

export function CelebrationOverlay({
  title,
  subtitle,
  footer,
  durationMs = 2400,
  onDone,
}: CelebrationOverlayProps) {
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState(true);
  const doneRef = React.useRef(onDone);
  React.useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  // Auto-dismiss (shorter when reduced motion — it's just a confirmation).
  React.useEffect(() => {
    const t = setTimeout(() => setOpen(false), reduced ? 900 : durationMs);
    return () => clearTimeout(t);
  }, [durationMs, reduced]);

  // Scroll lock while the takeover is up.
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <AnimatePresence onExitComplete={() => doneRef.current?.()}>
      {open && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: reduced ? 0 : 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.45, ease: "easeIn" } }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-background"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative flex flex-col items-center px-6 text-center"
            style={{
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            {/* Confetti burst — radial, viewport-scaled, decorative. */}
            {!reduced &&
              PIECES.map((p, i) => (
                <motion.span
                  key={i}
                  aria-hidden
                  initial={{ x: 0, y: 0, opacity: 0, scale: 1, rotate: 0 }}
                  animate={{
                    x: `${p.x}vmin`,
                    y: `${p.y}vmin`,
                    opacity: [0, 1, 1, 0],
                    scale: 0.5,
                    rotate: p.round ? 0 : 220,
                  }}
                  transition={{ duration: 1.3, delay: p.delay, ease: "easeOut" }}
                  className={`absolute top-1/3 left-1/2 ${p.size} ${p.round ? "rounded-full" : "rounded-[2px]"} ${p.color}`}
                />
              ))}

            {/* Pulse ring + check. */}
            <div className="relative">
              {!reduced && (
                <motion.span
                  aria-hidden
                  initial={{ scale: 0.6, opacity: 0.5 }}
                  animate={{ scale: 2.1, opacity: 0 }}
                  transition={{ duration: 1.1, delay: 0.15, ease: "easeOut" }}
                  className="absolute inset-0 rounded-full border-2 border-green-500/60"
                />
              )}
              <motion.span
                initial={reduced ? false : { scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 15 }}
                className="flex size-24 items-center justify-center rounded-full bg-green-500/10 text-green-600 dark:text-green-400"
              >
                <svg viewBox="0 0 24 24" className="size-12" fill="none" aria-hidden>
                  <motion.path
                    d="M4 12.5l5 5L20 6.5"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.55, delay: 0.2, ease: "easeOut" }}
                  />
                </svg>
              </motion.span>
            </div>

            <motion.div
              initial={reduced ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduced ? 0 : 0.45 }}
              className="mt-6 flex flex-col items-center gap-2"
            >
              <h2 className="font-heading text-2xl font-semibold text-foreground">
                {title}
              </h2>
              {subtitle ? (
                <p className="max-w-sm text-sm text-pretty text-muted-foreground">
                  {subtitle}
                </p>
              ) : null}
              {footer ? <div className="mt-2">{footer}</div> : null}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
