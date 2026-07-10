"use client";

/**
 * Colored option chip shared by SelectCell and MultiTagCell. Colors come from
 * `CellOption.color`, which may be either a semantic token name we map to a
 * tinted style, or a raw hex/CSS color we apply inline. When no color is given
 * we fall back to a neutral (muted) chip.
 */

import * as React from "react";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CellOption } from "@/components/grid/types";

/** Semantic token names we render as pre-tuned tinted chips (border/bg/text). */
const SEMANTIC_CHIP: Record<string, string> = {
  success: "border-success/25 bg-success/10 text-success",
  warning:
    "border-warning/35 bg-warning/15 text-warning-foreground dark:text-warning",
  destructive: "border-destructive/25 bg-destructive/10 text-destructive",
  primary: "border-primary/25 bg-primary/10 text-primary",
  muted: "border-border bg-muted text-muted-foreground",
  accent: "border-border bg-accent text-accent-foreground",
};

const NEUTRAL_CHIP = "border-border bg-secondary text-secondary-foreground";

/** True when the string looks like a raw CSS color (hex / rgb / hsl). */
function isRawColor(color: string): boolean {
  return (
    color.startsWith("#") ||
    color.startsWith("rgb") ||
    color.startsWith("hsl")
  );
}

/** Resolve an option's color into either token classes or an inline style. */
export function chipStyle(color: string | undefined): {
  className: string;
  style?: React.CSSProperties;
} {
  if (!color) return { className: NEUTRAL_CHIP };
  if (SEMANTIC_CHIP[color]) return { className: SEMANTIC_CHIP[color] };
  if (isRawColor(color)) {
    // Raw hex/CSS color: tint background + border from the color, keep readable
    // text by letting the color define the accent and using currentColor mix.
    return {
      className: "border",
      style: {
        borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
        color,
      },
    };
  }
  return { className: NEUTRAL_CHIP };
}

interface OptionChipProps {
  option: CellOption;
  /** Renders a remove (×) button that fires `onRemove`. */
  onRemove?: () => void;
  className?: string;
}

/** A single colored token chip for a chosen option. */
export function OptionChip({ option, onRemove, className }: OptionChipProps) {
  const { className: colorClass, style } = chipStyle(option.color);
  return (
    <span
      data-slot="option-chip"
      style={style}
      className={cn(
        "inline-flex h-5 max-w-full items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        colorClass,
        className,
      )}
    >
      <span className="truncate">{option.label}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${option.label}`}
          onMouseDown={(e) => {
            // mousedown (not click) so we act before the input's blur closes us.
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-0.5 grid size-3.5 shrink-0 place-items-center rounded-full opacity-70 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/15"
        >
          <XIcon className="size-2.5" />
        </button>
      ) : null}
    </span>
  );
}

/** Look up an option by its stored value. */
export function findOption(
  options: CellOption[] | undefined,
  value: unknown,
): CellOption | undefined {
  if (!options) return undefined;
  return options.find((o) => o.value === value);
}
