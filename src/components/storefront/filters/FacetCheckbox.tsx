"use client";

import * as React from "react";
import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A custom, fully-styled checkbox row for the facet lists — never a native
 * `<input type=checkbox>` with default chrome. Renders as an accessible
 * `role="checkbox"` button so it is keyboard-operable (Space / Enter) and
 * announces its state, with a trailing count.
 *
 * Reduced-motion friendly: the check mark relies only on colour/opacity
 * transitions guarded by the caller's `motion-reduce` utilities where needed;
 * this component itself uses only `transition-colors`.
 */
export interface FacetCheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: React.ReactNode;
  /** Bounded match count shown on the right. Omit to hide. */
  count?: number;
  /** Visually de-emphasise + block interaction (e.g. zero-count value). */
  disabled?: boolean;
  /** Indeterminate ("some selected") state — used by group headers. */
  indeterminate?: boolean;
  className?: string;
}

export function FacetCheckbox({
  checked,
  onChange,
  label,
  count,
  disabled = false,
  indeterminate = false,
  className,
}: FacetCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors",
        "hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
          checked || indeterminate
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input bg-background group-hover:border-muted-foreground",
        )}
      >
        {indeterminate ? (
          <Minus className="size-3" strokeWidth={3} />
        ) : checked ? (
          <Check className="size-3" strokeWidth={3} />
        ) : null}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          checked ? "font-medium text-foreground" : "text-foreground/90",
        )}
      >
        {label}
      </span>
      {typeof count === "number" ? (
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            checked ? "text-primary" : "text-muted-foreground",
          )}
        >
          {count.toLocaleString("en-IN")}
        </span>
      ) : null}
    </button>
  );
}
