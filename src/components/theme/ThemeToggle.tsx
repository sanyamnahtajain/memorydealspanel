"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { motion, useReducedMotion, type Transition } from "motion/react"

import { cn } from "@/lib/utils"
import { useTheme, type Theme } from "./ThemeProvider"

const SNAPPY_SPRING: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 38,
  mass: 0.7,
}

/** No-op subscription — the client snapshot never changes after hydration. */
function subscribeNoop(): () => void {
  return () => {}
}

const OPTIONS: ReadonlyArray<{
  value: Theme
  label: string
  icon: typeof Sun
}> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
]

export interface ThemeToggleProps {
  /**
   * `"compact"` renders an icon-only control sized for headers/top bars.
   * `"full"` (default) adds text labels alongside the icons.
   */
  variant?: "full" | "compact"
  className?: string
}

/**
 * Custom animated segmented control for choosing the theme (Light / Dark).
 * A single spring-driven pill slides between the two options via a shared
 * `layoutId`. Fully keyboard-accessible via native radio semantics — never a
 * native `<select>`.
 */
export function ThemeToggle({ variant = "full", className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme()
  const reducedMotion = useReducedMotion()
  const spring: Transition = reducedMotion ? { duration: 0 } : SNAPPY_SPRING
  const compact = variant === "compact"

  // The stored theme is only known on the client (localStorage). Until mounted,
  // render the same "nothing selected" markup the server produced so hydration
  // matches; the active pill then animates in on the client. Resolved via
  // useSyncExternalStore so the server renders the neutral (false) branch and
  // the client corrects on hydration — no setState-in-effect.
  const mounted = React.useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  )

  const groupId = React.useId()

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-muted/50 p-0.5",
        className
      )}
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon
        const selected = mounted && theme === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            onClick={() => setTheme(option.value)}
            className={cn(
              "relative flex items-center justify-center gap-1.5 rounded-full text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95",
              compact ? "size-8" : "min-h-9 px-3",
              selected
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {selected && (
              <motion.span
                layoutId={`theme-toggle-active-${groupId}`}
                transition={spring}
                className="absolute inset-0 rounded-full bg-background shadow-xs ring-1 ring-border"
                aria-hidden
              />
            )}
            <Icon
              className="relative size-4 shrink-0"
              strokeWidth={selected ? 2.4 : 2}
              aria-hidden
            />
            {!compact && <span className="relative">{option.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
