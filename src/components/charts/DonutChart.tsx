"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { arcPath, formatFull, resolveTone, seriesColor } from "./chart-utils";
import type { DonutSlice } from "./types";
import { ChartDataTable } from "./ChartDataTable";

interface DonutChartProps {
  data: DonutSlice[];
  ariaLabel: string;
  /** Big number shown in the hole. Defaults to the total. */
  centerLabel?: string;
  /** Caption under the center number. @default "total" */
  centerCaption?: string;
  size?: number;
  className?: string;
}

const VB = 200;
const CX = VB / 2;
const CY = VB / 2;
const R_OUTER = 88;
const R_INNER = 58;

/**
 * Hand-built donut chart with an inline legend. Each slice is an SVG annulus
 * wedge; hovering (or focusing) a legend row highlights its slice. Accessible
 * (role=img + hidden table), reduced-motion aware.
 */
export function DonutChart({
  data,
  ariaLabel,
  centerLabel,
  centerCaption = "total",
  size = 180,
  className,
}: DonutChartProps) {
  const reduced = useReducedMotion();
  const [active, setActive] = React.useState<number | null>(null);

  const total = data.reduce((sum, d) => sum + d.value, 0);

  // Precompute wedge angles (clockwise from 12 o'clock). Each wedge's start is
  // the sum of every preceding slice's fraction — computed with `reduce` so no
  // captured accumulator is reassigned (satisfies react-hooks/immutability).
  const wedges = React.useMemo(() => {
    const TAU = Math.PI * 2;
    const fractions = data.map((d) => (total > 0 ? d.value / total : 0));
    return data.map((d, i) => {
      const start = fractions.slice(0, i).reduce((sum, f) => sum + f, 0);
      return {
        ...d,
        frac: fractions[i],
        start: start * TAU,
        end: (start + fractions[i]) * TAU,
        color: resolveTone(d.tone ?? undefined) || seriesColor(i),
      };
    });
  }, [data, total]);

  const center = centerLabel ?? formatFull(total);

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-5",
        className,
      )}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          viewBox={`0 0 ${VB} ${VB}`}
          role="img"
          aria-label={ariaLabel}
          className="h-full w-full"
        >
          {total === 0 ? (
            <circle
              cx={CX}
              cy={CY}
              r={(R_OUTER + R_INNER) / 2}
              fill="none"
              className="stroke-muted"
              strokeWidth={R_OUTER - R_INNER}
            />
          ) : (
            wedges.map((w, i) => {
              const dimmed = active !== null && active !== i;
              return (
                <motion.path
                  key={`${w.label}-${i}`}
                  d={arcPath(CX, CY, R_OUTER, R_INNER, w.start, w.end)}
                  fill={w.color}
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: dimmed ? 0.35 : 1 }}
                  transition={{ duration: 0.4, delay: reduced ? 0 : i * 0.06 }}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  style={{ cursor: "pointer" }}
                />
              );
            })
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-tabular text-xl font-semibold tabular-nums text-foreground">
            {center}
          </span>
          <span className="text-[11px] text-muted-foreground">{centerCaption}</span>
        </div>
      </div>

      {/* Legend */}
      <ul className="grid w-full min-w-0 gap-1.5">
        {wedges.map((w, i) => (
          <li key={`${w.label}-legend-${i}`}>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-fast hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                active !== null && active !== i && "opacity-60",
              )}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: w.color }}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                {w.label}
              </span>
              <span className="font-tabular text-xs font-semibold tabular-nums text-foreground">
                {formatFull(w.value)}
              </span>
              <span className="w-10 text-right text-xs text-muted-foreground">
                {total > 0 ? `${Math.round(w.frac * 100)}%` : "0%"}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <ChartDataTable
        caption={ariaLabel}
        columns={["Segment", "Value"]}
        rows={data.map((d) => ({ label: d.label, values: [d.value] }))}
      />
    </div>
  );
}
