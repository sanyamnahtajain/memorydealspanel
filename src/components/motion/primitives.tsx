"use client";

/**
 * Motion primitives — small, composable animation wrappers used across the app.
 * All primitives respect the user's reduced-motion preference and pull their
 * feel exclusively from the shared tokens (./tokens.ts).
 */

import * as React from "react";
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  type Variants,
} from "motion/react";
import { cn } from "@/lib/utils";
import { durations, easeOut, springs, stagger } from "./tokens";

/* ------------------------------------------------------------------ */
/* FadeUp                                                              */
/* ------------------------------------------------------------------ */

interface FadeUpProps {
  children: React.ReactNode;
  /** Delay before the entrance starts, in seconds. */
  delay?: number;
  /** Vertical travel distance in px. */
  distance?: number;
  className?: string;
}

/** Fades content in while sliding it up slightly. The default entrance. */
export function FadeUp({ children, delay = 0, distance = 12, className }: FadeUpProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: distance }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.gentle, delay }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Stagger                                                             */
/* ------------------------------------------------------------------ */

const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: springs.gentle },
};

interface StaggerProps {
  children: React.ReactNode;
  /** Delay before the first child animates, in seconds. */
  delay?: number;
  /** Gap between each child's entrance, in seconds. Defaults to the standard 40 ms. */
  interval?: number;
  className?: string;
  /** Class applied to each generated item wrapper. */
  itemClassName?: string;
}

/**
 * Staggers the entrance of its direct children. Each child is wrapped in a
 * motion item automatically — pass a list of cards, rows, etc.
 */
export function Stagger({
  children,
  delay = 0,
  interval = stagger,
  className,
  itemClassName,
}: StaggerProps) {
  const reduced = useReducedMotion();

  const containerVariants: Variants = {
    hidden: {},
    show: {
      transition: reduced
        ? { staggerChildren: 0, delayChildren: 0 }
        : { staggerChildren: interval, delayChildren: delay },
    },
  };

  return (
    <motion.div
      className={className}
      variants={containerVariants}
      initial={reduced ? "show" : "hidden"}
      animate="show"
    >
      {React.Children.map(children, (child, index) =>
        child == null ? null : (
          <motion.div key={index} className={itemClassName} variants={staggerItemVariants}>
            {child}
          </motion.div>
        ),
      )}
    </motion.div>
  );
}

/**
 * Variants for custom stagger items when you need direct control over the
 * motion element (e.g. a motion.li inside a Stagger-like container).
 */
export { staggerItemVariants };

/* ------------------------------------------------------------------ */
/* ScaleTap                                                            */
/* ------------------------------------------------------------------ */

interface ScaleTapProps {
  children: React.ReactNode;
  /** Scale applied while pressed. */
  scale?: number;
  className?: string;
}

/** Press-feedback wrapper: scales its content down slightly while tapped. */
export function ScaleTap({ children, scale = 0.97, className }: ScaleTapProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      whileTap={reduced ? undefined : { scale }}
      transition={springs.snappy}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* AnimatedNumber                                                      */
/* ------------------------------------------------------------------ */

const defaultNumberFormat = (n: number) => Math.round(n).toLocaleString("en-IN");

interface AnimatedNumberProps {
  /** Target value. Changes animate a count-up/down to the new value. */
  value: number;
  /**
   * Formats the in-flight (fractional) value for display.
   * Defaults to rounded en-IN grouping. For prices, pass a paise formatter.
   */
  format?: (value: number) => string;
  className?: string;
}

/**
 * Renders a number that counts toward `value` whenever it changes.
 * Uses tabular numerals so digits don't jitter horizontally.
 */
export function AnimatedNumber({
  value,
  format = defaultNumberFormat,
  className,
}: AnimatedNumberProps) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(value);
  const formatRef = React.useRef(format);
  React.useEffect(() => {
    formatRef.current = format;
  }, [format]);

  useMotionValueEvent(motionValue, "change", (latest) => {
    if (ref.current) {
      ref.current.textContent = formatRef.current(latest);
    }
  });

  React.useEffect(() => {
    if (reduced) {
      motionValue.jump(value);
      if (ref.current) {
        ref.current.textContent = formatRef.current(value);
      }
      return;
    }
    const controls = animate(motionValue, value, {
      duration: durations.slow,
      ease: easeOut,
    });
    return () => controls.stop();
  }, [value, reduced, motionValue]);

  // Children are rendered once for SSR/first paint; afterwards the motion
  // value drives textContent directly (no re-renders per frame).
  const [initialText] = React.useState(() => format(value));

  return (
    <span ref={ref} className={cn("font-tabular", className)}>
      {initialText}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Collapse                                                            */
/* ------------------------------------------------------------------ */

interface CollapseProps {
  /** Whether the content is expanded. */
  open: boolean;
  children: React.ReactNode;
  className?: string;
}

/** Smoothly expands/collapses its content vertically. */
export function Collapse({ open, children, className }: CollapseProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={cn("overflow-hidden", className)}
      initial={false}
      animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
      transition={
        reduced ? { duration: 0 } : { duration: durations.base, ease: easeOut }
      }
      aria-hidden={!open}
    >
      {children}
    </motion.div>
  );
}
