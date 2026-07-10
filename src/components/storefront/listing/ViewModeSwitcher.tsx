"use client";

/**
 * ViewModeSwitcher — a CUSTOM animated segmented control for the listing view
 * (Grid / Compact / Table). Never a native <select>: three icon buttons with
 * tooltips and an active pill that slides between segments via a shared
 * layout animation (suppressed under reduced motion).
 *
 * It is controlled — the parent owns the current `value` — but its initial
 * value comes from `usePreferences().defaultViewMode`, and every change calls
 * `setDefaultViewMode` so the choice persists across pages and sessions.
 */

import * as React from "react";
import { LayoutGrid, Rows3, Table2, type LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { usePreferences, type ViewMode } from "@/components/preferences/PreferencesProvider";
import { VIEW_MODES } from "./types";

const OPTIONS: Record<ViewMode, { label: string; hint: string; Icon: LucideIcon }> = {
  grid: {
    label: "Grid view",
    hint: "Image-forward cards",
    Icon: LayoutGrid,
  },
  compact: {
    label: "Compact view",
    hint: "Dense rows",
    Icon: Rows3,
  },
  table: {
    label: "Table view",
    hint: "Sortable columns",
    Icon: Table2,
  },
};

export interface ViewModeSwitcherProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}

export function ViewModeSwitcher({ value, onChange, className }: ViewModeSwitcherProps) {
  const { setDefaultViewMode } = usePreferences();
  const reduced = useReducedMotion();
  const layoutId = React.useId();

  const select = (mode: ViewMode) => {
    if (mode === value) return;
    onChange(mode);
    // Persist so the app opens to this view next time.
    setDefaultViewMode(mode);
  };

  return (
    <div
      role="radiogroup"
      aria-label="View mode"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5 shadow-sm",
        className,
      )}
    >
      {VIEW_MODES.map((mode) => {
        const { label, hint, Icon } = OPTIONS[mode];
        const active = mode === value;
        return (
          <Tooltip key={mode} content={hint}>
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={label}
              onClick={() => select(mode)}
              className={cn(
                "relative inline-flex size-9 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                active
                  ? "text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active ? (
                <motion.span
                  layoutId={reduced ? undefined : `${layoutId}-pill`}
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-primary shadow-sm"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              ) : null}
              <Icon className="relative size-4.5" aria-hidden />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
