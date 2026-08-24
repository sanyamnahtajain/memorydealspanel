"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

/**
 * CRED-style boot splash for the INSTALLED app (owner request): a dark,
 * cinematic launch sequence — particle field, rotating sheen, the TMD mark
 * springing in inside an orbiting arc, the wordmark rising letter by letter
 * with a shimmer sweep, then a two-panel curtain lift into the app.
 *
 * Rules of engagement:
 *  - STANDALONE display-mode only (the browser never gets an app boot).
 *  - Once per app session (sessionStorage), never on /admin, tap to skip,
 *    reduced-motion → a short static fade.
 *  - Hands off seamlessly from the pre-paint `#md-boot` cover the root layout
 *    paints (same backdrop + mark), so there is no flash of app content.
 */

const PLAYED_KEY = "md-splash-played";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Deterministic drifting particles (SSR-safe — no Math.random). */
const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  left: `${(i * 53) % 100}%`,
  top: `${(i * 37 + 11) % 100}%`,
  drift: 8 + ((i * 13) % 18),
  delay: (i % 6) * 0.35,
  size: i % 4 === 0 ? 3 : 2,
  dim: i % 3 === 0,
}));

const LETTERS = APP_NAME.toUpperCase().split("");

export function SplashScreen() {
  const reduced = useReducedMotion();
  const [phase, setPhase] = React.useState<"idle" | "playing" | "exiting">("idle");

  React.useEffect(() => {
    const clearBoot = () => delete document.documentElement.dataset.mdBoot;
    let play = false;
    try {
      play =
        isStandalone() &&
        !window.sessionStorage.getItem(PLAYED_KEY) &&
        !window.location.pathname.startsWith("/admin");
      if (play) window.sessionStorage.setItem(PLAYED_KEY, "1");
    } catch {
      play = false;
    }
    if (!play) {
      clearBoot();
      return;
    }
    // Scheduled (never sync in the effect body) per the repo's lint rule. The
    // static #md-boot cover stays up until this overlay has painted over it.
    const start = setTimeout(() => {
      setPhase("playing");
      clearBoot();
    }, 0);
    const exit = setTimeout(() => setPhase("exiting"), reduced ? 900 : 2600);
    return () => {
      clearTimeout(start);
      clearTimeout(exit);
      clearBoot();
    };
  }, [reduced]);

  // Scroll lock while the boot plays.
  React.useEffect(() => {
    if (phase === "idle") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [phase]);

  if (phase === "idle") return null;

  const skip = () => setPhase("exiting");

  return (
    <AnimatePresence>
      {phase === "playing" && (
        <motion.div
          key="splash"
          role="presentation"
          onClick={skip}
          initial={false}
          exit={{ opacity: 0, transition: { duration: 0.25, delay: 0.55 } }}
          className="fixed inset-0 z-[100] overflow-hidden bg-[#0A0A0B]"
        >
          {/* Slow-rotating sheen — the "expensive" light. */}
          {!reduced && (
            <motion.div
              aria-hidden
              initial={{ rotate: 0, opacity: 0 }}
              animate={{ rotate: 360, opacity: 1 }}
              transition={{
                rotate: { duration: 14, repeat: Infinity, ease: "linear" },
                opacity: { duration: 1.2 },
              }}
              className="absolute top-1/2 left-1/2 size-[180vmax] -translate-x-1/2 -translate-y-1/2"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0deg, rgba(37,99,235,0.10) 40deg, transparent 90deg, transparent 200deg, rgba(148,163,184,0.05) 240deg, transparent 300deg)",
              }}
            />
          )}
          {/* Vignette. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.55) 100%)",
            }}
          />
          {/* Particle drift. */}
          {!reduced &&
            PARTICLES.map((p, i) => (
              <motion.span
                key={i}
                aria-hidden
                initial={{ opacity: 0, y: 0 }}
                animate={{ opacity: [0, p.dim ? 0.18 : 0.4, 0], y: -p.drift * 4 }}
                transition={{
                  duration: 4.5,
                  delay: p.delay,
                  repeat: Infinity,
                  ease: "easeOut",
                }}
                className="absolute rounded-full bg-white"
                style={{ left: p.left, top: p.top, width: p.size, height: p.size }}
              />
            ))}

          {/* Center stack — inset by the safe areas for notched phones. */}
          <div
            className="relative flex h-full flex-col items-center justify-center px-8"
            style={{
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            {/* Mark + orbiting arc. */}
            <div className="relative">
              {!reduced && (
                <motion.svg
                  aria-hidden
                  viewBox="0 0 120 120"
                  className="absolute -inset-5 size-[calc(100%+2.5rem)]"
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 200, opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 1.5, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
                >
                  <circle
                    cx="60"
                    cy="60"
                    r="56"
                    fill="none"
                    stroke="rgba(37,99,235,0.9)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray="140 212"
                  />
                </motion.svg>
              )}
              <motion.span
                initial={reduced ? false : { scale: 0.5, opacity: 0, filter: "blur(10px)" }}
                animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
                transition={{ type: "spring", stiffness: 210, damping: 17, delay: 0.1 }}
                className="flex size-20 items-center justify-center rounded-2xl bg-white shadow-[0_0_60px_rgba(37,99,235,0.35)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- boot art, must not lazy-init next/image */}
                <img src="/brand/logo.png" alt="" width={56} height={56} className="object-contain" />
              </motion.span>
            </div>

            {/* Wordmark — per-letter rise from a clipped baseline. */}
            <div className="mt-8 overflow-hidden" aria-label={APP_NAME}>
              <div className="flex" aria-hidden>
                {LETTERS.map((ch, i) => (
                  <motion.span
                    key={i}
                    initial={reduced ? false : { y: "110%", opacity: 0 }}
                    animate={{ y: "0%", opacity: 1 }}
                    transition={{
                      duration: 0.55,
                      delay: reduced ? 0 : 0.75 + i * 0.03,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="font-heading text-xl font-bold tracking-[0.22em] text-white"
                  >
                    {ch === " " ? " " : ch}
                  </motion.span>
                ))}
              </div>
            </div>

            {/* Shimmer sweep across the wordmark. */}
            {!reduced && (
              <motion.div
                aria-hidden
                initial={{ x: "-130%" }}
                animate={{ x: "130%" }}
                transition={{ duration: 0.9, delay: 1.5, ease: "easeInOut" }}
                className="pointer-events-none -mt-7 h-7 w-72"
                style={{
                  background:
                    "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)",
                }}
              />
            )}

            <motion.p
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: reduced ? 0 : 1.9, duration: 0.5 }}
              className="mt-4 text-center text-[0.7rem] tracking-wide text-white/45"
            >
              {APP_TAGLINE}
            </motion.p>
          </div>

          {/* Curtain exit — two panels lift with a stagger (plays on unmount
              via the parent exit? No: panels animate IN as the cover lifts). */}
        </motion.div>
      )}
      {phase === "exiting" && !reduced && (
        <React.Fragment key="curtain">
          {/* Two-panel curtain that lifts off the app. */}
          {[0, 1].map((i) => (
            <motion.div
              key={i}
              aria-hidden
              initial={{ y: 0 }}
              animate={{ y: "-102%" }}
              transition={{
                duration: 0.62,
                delay: i * 0.09,
                ease: [0.83, 0, 0.17, 1],
              }}
              onAnimationComplete={i === 1 ? () => setPhase("idle") : undefined}
              className="fixed inset-0 bg-[#0A0A0B]"
              style={{ zIndex: 99 - i }}
            />
          ))}
        </React.Fragment>
      )}
      {phase === "exiting" && reduced && (
        <motion.div
          key="fade"
          aria-hidden
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          onAnimationComplete={() => setPhase("idle")}
          className="fixed inset-0 z-[100] bg-[#0A0A0B]"
        />
      )}
    </AnimatePresence>
  );
}
