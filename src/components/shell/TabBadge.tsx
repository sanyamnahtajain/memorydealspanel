"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

/**
 * Animated count badge used in tab bars, sidebars and the notification bell.
 * Pops in/out with a spring; re-pops when the count changes. Renders nothing
 * for counts <= 0 so callers can pass counts through unconditionally.
 *
 * Position is absolute — the parent must be `relative`.
 */
export function TabBadge({
  count,
  className,
  label = "notifications",
}: {
  count?: number
  className?: string
  /** Accessible noun for screen readers, e.g. "pending requests". */
  label?: string
}) {
  const reducedMotion = useReducedMotion()
  const visible = typeof count === "number" && count > 0

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {visible && (
        <motion.span
          key={count}
          initial={reducedMotion ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
          transition={
            reducedMotion
              ? { duration: 0.12 }
              : { type: "spring", stiffness: 640, damping: 32, mass: 0.6 }
          }
          className={cn(
            "pointer-events-none absolute -top-1 -right-1.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold tabular-nums text-primary-foreground ring-2 ring-background",
            className
          )}
        >
          {count! > 99 ? "99+" : count}
          <span className="sr-only">
            {" "}
            {label}
          </span>
        </motion.span>
      )}
    </AnimatePresence>
  )
}
