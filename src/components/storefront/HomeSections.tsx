"use client";

/**
 * HomeSections — staggers the entrance of the home page's content sections
 * (trust strip, category grid, rails, the dark panel…) and owns the page's
 * section rhythm: 2.5rem between sections on phones, 4rem from md. Purely
 * presentational: it wraps server-rendered children in a motion container
 * and reveals them in sequence, respecting reduced-motion. Contains no data
 * and no prices.
 *
 * A child that renders NOTHING (a Suspense rail with no signal, a shelf with
 * no reels) leaves an empty wrapper behind; `[&>*:empty]:hidden` collapses it
 * so the gap above and below never doubles.
 */

import * as React from "react";
import { motion, type Variants } from "motion/react";

import { cn } from "@/lib/utils";
import { staggerItemVariants } from "@/components/motion/primitives";
import { useEntranceInitial } from "@/components/motion/useEntrance";

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

interface HomeSectionsProps {
  children: React.ReactNode;
  className?: string;
}

export function HomeSections({ children, className }: HomeSectionsProps) {
  const entranceInitial = useEntranceInitial("hidden" as const);
  return (
    <motion.div
      className={cn(
        "mt-10 space-y-10 md:mt-14 md:space-y-16 [&>*:empty]:hidden",
        className,
      )}
      variants={container}
      initial={entranceInitial}
      animate="show"
    >
      {React.Children.map(children, (child) =>
        child == null ? null : (
          <motion.div variants={staggerItemVariants}>{child}</motion.div>
        ),
      )}
    </motion.div>
  );
}
