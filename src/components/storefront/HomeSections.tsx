"use client";

/**
 * HomeSections — staggers the entrance of the home page's content sections
 * (category grid, featured strip, …). Purely presentational: it wraps
 * server-rendered children in a motion container and reveals them in
 * sequence, respecting reduced-motion. Contains no data and no prices.
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
      className={cn("mt-8 space-y-10", className)}
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
