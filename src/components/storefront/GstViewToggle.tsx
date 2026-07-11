"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { setGstViewAction } from "@/server/actions/tax-settings"
import type { GstView } from "@/server/prefs/gst-view"

/**
 * GstViewToggle — a tiny segmented control letting a retailer flip prices
 * between GST-inclusive and GST-exclusive. Persists the choice to the
 * `gst_view` cookie via `setGstViewAction` and refreshes so server-rendered
 * prices re-render in the chosen mode.
 *
 * The catalogue stage decides WHERE to place this; it is only rendered when
 * GST is enabled and the viewer can see prices — this component makes no such
 * assumption itself.
 */
export function GstViewToggle({
  value,
  className,
}: {
  /** The current effective preference (from `getGstViewPreference()`). */
  value: GstView
  className?: string
}) {
  const [view, setView] = React.useState<GstView>(value)
  const [lastProp, setLastProp] = React.useState<GstView>(value)
  const [pending, startTransition] = React.useTransition()

  // Sync to a changed server-provided value during render (no effect needed).
  if (value !== lastProp) {
    setLastProp(value)
    setView(value)
  }

  function choose(next: GstView) {
    if (next === view || pending) return
    setView(next) // optimistic
    startTransition(async () => {
      await setGstViewAction(next)
    })
  }

  return (
    <div
      role="group"
      aria-label="GST price display"
      className={cn(
        "inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5 text-xs font-medium",
        className,
      )}
    >
      {(
        [
          { key: "incl", label: "Incl. GST" },
          { key: "excl", label: "Excl. GST" },
        ] as const
      ).map((opt) => {
        const active = view === opt.key
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={active}
            onClick={() => choose(opt.key)}
            className={cn(
              "rounded-md px-2.5 py-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
