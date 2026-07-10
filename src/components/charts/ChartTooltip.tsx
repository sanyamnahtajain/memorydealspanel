"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TooltipState {
  /** Left offset within the chart container, in px. */
  x: number;
  /** Top offset within the chart container, in px. */
  y: number;
  title: string;
  /** One or more value rows shown under the title. */
  rows: { label?: string; value: string; tone?: string }[];
}

/**
 * Custom hover tooltip for the chart kit — deliberately NOT the native SVG
 * `<title>` (which is slow, unstyled and inaccessible to keyboard focus). The
 * chart tracks a `TooltipState` and renders this floating card, positioned
 * within a `relative` container. It nudges itself to stay inside the box.
 */
export function ChartTooltip({
  state,
  containerWidth,
}: {
  state: TooltipState | null;
  containerWidth: number;
}) {
  if (!state) return null;

  // Keep the card from overflowing the right edge: flip to the left of the
  // cursor when we're past the midpoint.
  const flip = containerWidth > 0 && state.x > containerWidth * 0.6;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none absolute z-10 max-w-[12rem] -translate-y-full rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md",
        flip ? "-translate-x-full" : "translate-x-0",
      )}
      style={{
        left: state.x + (flip ? -8 : 8),
        top: state.y - 8,
      }}
    >
      <p className="font-medium text-foreground">{state.title}</p>
      <div className="mt-0.5 space-y-0.5">
        {state.rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {row.tone ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: row.tone }}
              />
            ) : null}
            {row.label ? (
              <span className="text-muted-foreground">{row.label}</span>
            ) : null}
            <span className="ml-auto font-tabular font-semibold text-foreground">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Tracks the rendered pixel width of a chart container so tooltip positioning
 * (which flips near the right edge) can reason about real geometry despite the
 * SVG using an abstract viewBox. SSR-safe: starts at 0, corrects on mount.
 */
export function useContainerWidth<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [width, setWidth] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}
