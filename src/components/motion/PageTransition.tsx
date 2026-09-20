"use client";

/**
 * PageTransition — subtle fade/slide applied to route content on navigation.
 *
 * A thin client boundary: children are typically Server Components passed
 * through as an opaque ReactNode, so RSC payloads/streaming are unaffected.
 * The content re-animates whenever the pathname changes.
 */

import * as React from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { durations, easeOut } from "./tokens";
import { useEntranceInitial } from "@/components/motion/useEntrance";

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

export function PageTransition({ children, className }: PageTransitionProps) {
  const pathname = usePathname();
  const entranceInitial = useEntranceInitial({ opacity: 0, y: 8 });

  return (
    <motion.div
      key={pathname}
      className={className}
      initial={entranceInitial}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: durations.base, ease: easeOut }}
    >
      {children}
    </motion.div>
  );
}
