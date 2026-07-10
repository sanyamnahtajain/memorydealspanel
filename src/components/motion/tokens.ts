/**
 * Motion design tokens — the single source of truth for animation feel.
 *
 * Mirrors the CSS custom properties declared in src/app/globals.css
 * (--dur-fast / --dur-base / --dur-slow / --ease-spring). Every animated
 * component imports from here so the whole app moves as one.
 */
import type { Transition } from "motion/react";

/** Spring transitions for motion/react `transition` props. */
export const springs = {
  /** Snappy — direct interactions: taps, toggles, small reveals. */
  snappy: { type: "spring", stiffness: 420, damping: 30 } as const,
  /** Gentle — layout shifts, page-level movement, larger surfaces. */
  gentle: { type: "spring", stiffness: 210, damping: 26, mass: 1 } as const,
} satisfies Record<string, Transition>;

/** Durations in seconds (motion/react convention). CSS vars use ms. */
export const durations = {
  fast: 0.15,
  base: 0.22,
  slow: 0.3,
} as const;

/** Duration tokens as milliseconds, matching the CSS custom properties. */
export const durationsMs = {
  fast: 150,
  base: 220,
  slow: 300,
} as const;

/** Standard stagger between sibling children, in seconds (40 ms). */
export const stagger = 0.04;

/** Cubic-bezier approximation of the spring feel, for tween fallbacks. */
export const easeSpring: [number, number, number, number] = [0.2, 0.9, 0.25, 1.05];

/** Standard decel ease-out, for entrances and fades. */
export const easeOut: [number, number, number, number] = [0.16, 1, 0.3, 1];

export type SpringName = keyof typeof springs;
export type DurationName = keyof typeof durations;
