"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import {
  formatCompact,
  formatFull,
  linePoints,
  niceMax,
  resolveTone,
  round,
  scaleLinear,
} from "./chart-utils";
import type { ChartSeries } from "./types";
import { ChartDataTable } from "./ChartDataTable";
import { ChartTooltip, useContainerWidth, type TooltipState } from "./ChartTooltip";

const VB_W = 640;
const VB_H = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 34 };

interface LineChartProps {
  /** One or more series. All series must share the same x-axis labels. */
  series: ChartSeries[];
  /** Draw a filled gradient under the (first) line. @default false */
  area?: boolean;
  /** Accessible summary; also used as the visually-hidden table caption. */
  ariaLabel: string;
  /** Show at most this many x-axis tick labels (thinned evenly). @default 6 */
  maxTicks?: number;
  height?: number;
  className?: string;
}

/**
 * Hand-built line / area chart for daily time series. Responsive via a fixed
 * `viewBox` stretched by the container; accessible via `role="img"` + a
 * visually-hidden data table; animated draw-in that collapses under
 * `prefers-reduced-motion`; custom (non-native) hover tooltip.
 */
export function LineChart({
  series,
  area = false,
  ariaLabel,
  maxTicks = 6,
  height = 200,
  className,
}: LineChartProps) {
  const reduced = useReducedMotion();
  const { ref, width } = useContainerWidth<HTMLDivElement>();
  const [tip, setTip] = React.useState<TooltipState | null>(null);

  const labels = React.useMemo(
    () => series[0]?.points.map((p) => p.label) ?? [],
    [series],
  );
  const n = labels.length;

  const plot = {
    x: PAD.left,
    y: PAD.top,
    width: VB_W - PAD.left - PAD.right,
    height: VB_H - PAD.top - PAD.bottom,
  };

  const peak = Math.max(
    1,
    ...series.flatMap((s) => s.points.map((p) => p.value)),
  );
  const max = niceMax(peak);

  // Evenly thinned x tick indices.
  const tickIdx = React.useMemo(() => {
    if (n <= maxTicks) return labels.map((_, i) => i);
    const step = (n - 1) / (maxTicks - 1);
    return Array.from({ length: maxTicks }, (_, i) => Math.round(i * step));
  }, [n, maxTicks, labels]);

  // Y grid lines (0, mid, max).
  const yTicks = [0, max / 2, max];

  const uid = React.useId().replace(/:/g, "");

  const handleMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * VB_W;
    const t = n === 1 ? 0 : (px - plot.x) / plot.width;
    const idx = Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
    const cx =
      n === 1 ? plot.x + plot.width / 2 : plot.x + (idx / (n - 1)) * plot.width;
    setTip({
      x: (cx / VB_W) * rect.width,
      y: (plot.y / VB_H) * rect.height,
      title: labels[idx],
      rows: series.map((s, si) => ({
        label: series.length > 1 ? s.name : undefined,
        value: formatFull(s.points[idx]?.value ?? 0),
        tone: resolveTone(s.tone ?? undefined) || seriesToneFallback(si),
      })),
    });
  };

  return (
    <div ref={ref} className={cn("relative w-full", className)}>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        className="w-full"
        style={{ height }}
      >
        {/* Y grid + labels */}
        {yTicks.map((v, i) => {
          const y = plot.y + plot.height - scaleLinear(v, 0, max, 0, plot.height);
          return (
            <g key={i}>
              <line
                x1={plot.x}
                x2={plot.x + plot.width}
                y1={round(y)}
                y2={round(y)}
                className="stroke-border"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                strokeDasharray={i === 0 ? undefined : "3 4"}
              />
              <text
                x={plot.x - 6}
                y={round(y) + 3}
                textAnchor="end"
                className="fill-muted-foreground"
                style={{ fontSize: 10 }}
              >
                {formatCompact(v)}
              </text>
            </g>
          );
        })}

        {/* X tick labels */}
        {tickIdx.map((idx) => {
          const x =
            n === 1
              ? plot.x + plot.width / 2
              : plot.x + (idx / (n - 1)) * plot.width;
          return (
            <text
              key={idx}
              x={round(x)}
              y={VB_H - 8}
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: 10 }}
            >
              {labels[idx]}
            </text>
          );
        })}

        {/* Series */}
        {series.map((s, si) => {
          const stroke = resolveTone(s.tone ?? undefined) || seriesToneFallback(si);
          const values = s.points.map((p) => p.value);
          const pts = linePoints(values, plot, max);

          const areaPath =
            area && si === 0 && pts
              ? `M ${plot.x},${plot.y + plot.height} ` +
                pts
                  .split(" ")
                  .map((pt) => `L ${pt}`)
                  .join(" ") +
                ` L ${plot.x + plot.width},${plot.y + plot.height} Z`
              : null;

          return (
            <g key={si}>
              {areaPath ? (
                <>
                  <defs>
                    <linearGradient id={`area-${uid}-${si}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={stroke} stopOpacity={0.24} />
                      <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <motion.path
                    d={areaPath}
                    fill={`url(#area-${uid}-${si})`}
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                  />
                </>
              ) : null}
              <motion.polyline
                points={pts}
                fill="none"
                stroke={stroke}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                initial={reduced ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.8, delay: si * 0.1 }}
              />
              {/* End dot marker on the last point. */}
              {values.length > 0 ? (
                <circle
                  cx={round(
                    n === 1 ? plot.x + plot.width / 2 : plot.x + plot.width,
                  )}
                  cy={round(
                    plot.y +
                      plot.height -
                      scaleLinear(values[values.length - 1], 0, max, 0, plot.height),
                  )}
                  r={2.5}
                  fill={stroke}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </g>
          );
        })}

        {/* Hover hit-area + cursor guide */}
        {tip ? (
          <line
            x1={round((tip.x / Math.max(width, 1)) * VB_W)}
            x2={round((tip.x / Math.max(width, 1)) * VB_W)}
            y1={plot.y}
            y2={plot.y + plot.height}
            className="stroke-muted-foreground/40"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <rect
          x={plot.x}
          y={plot.y}
          width={plot.width}
          height={plot.height}
          fill="transparent"
          onPointerMove={handleMove}
          onPointerLeave={() => setTip(null)}
          style={{ cursor: "crosshair" }}
        />
      </svg>

      <ChartTooltip state={tip} containerWidth={width} />

      <ChartDataTable
        caption={ariaLabel}
        columns={["Point", ...series.map((s) => s.name)]}
        rows={labels.map((label, i) => ({
          label,
          values: series.map((s) => s.points[i]?.value ?? 0),
        }))}
      />
    </div>
  );
}

/** Fallback series tone by index (mirrors the chart palette order). */
function seriesToneFallback(index: number): string {
  return [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ][index % 5];
}
