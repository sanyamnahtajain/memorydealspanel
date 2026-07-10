"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { formatCompact, formatFull, niceMax, resolveTone, round } from "./chart-utils";
import type { BarDatum } from "./types";
import { ChartDataTable } from "./ChartDataTable";
import { ChartTooltip, useContainerWidth, type TooltipState } from "./ChartTooltip";

interface BarChartProps {
  data: BarDatum[];
  /** "horizontal" (labels on the left) or "vertical" (labels on the bottom). */
  orientation?: "horizontal" | "vertical";
  ariaLabel: string;
  /** Default bar tone when a datum has none. @default "primary" */
  tone?: BarDatum["tone"];
  /** Height per horizontal row / total height for vertical. */
  height?: number;
  className?: string;
}

/**
 * Hand-built bar chart. Horizontal is ideal for ranked lists (top products),
 * vertical for small categorical comparisons. Responsive, accessible
 * (role=img + hidden table), animated grow-in (reduced-motion aware), custom
 * hover tooltip.
 */
export function BarChart({
  data,
  orientation = "horizontal",
  ariaLabel,
  tone = "primary",
  height,
  className,
}: BarChartProps) {
  if (orientation === "vertical") {
    return (
      <VerticalBars
        data={data}
        ariaLabel={ariaLabel}
        tone={tone}
        height={height ?? 200}
        className={className}
      />
    );
  }
  return (
    <HorizontalBars data={data} ariaLabel={ariaLabel} tone={tone} className={className} />
  );
}

/* ------------------------------------------------------------------ */
/* Horizontal                                                          */
/* ------------------------------------------------------------------ */

function HorizontalBars({
  data,
  ariaLabel,
  tone,
  className,
}: {
  data: BarDatum[];
  ariaLabel: string;
  tone: BarDatum["tone"];
  className?: string;
}) {
  const reduced = useReducedMotion();
  const { ref, width } = useContainerWidth<HTMLDivElement>();
  const [tip, setTip] = React.useState<TooltipState | null>(null);
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));

  return (
    <div ref={ref} className={cn("relative w-full", className)}>
      <ul
        role="img"
        aria-label={ariaLabel}
        className="flex flex-col gap-2.5"
      >
        {data.map((d, i) => {
          const pct = (d.value / max) * 100;
          const color = resolveTone(d.tone ?? tone);
          return (
            <li
              key={`${d.label}-${i}`}
              className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3"
              onPointerEnter={(e) => {
                const rect = ref.current?.getBoundingClientRect();
                if (!rect) return;
                const target = e.currentTarget.getBoundingClientRect();
                setTip({
                  x: target.left - rect.left + target.width * 0.5,
                  y: target.top - rect.top,
                  title: d.label,
                  rows: [
                    ...(d.hint ? [{ label: d.hint, value: "" }] : []),
                    { value: formatFull(d.value), tone: color },
                  ],
                });
              }}
              onPointerLeave={() => setTip(null)}
            >
              <span className="truncate text-xs text-foreground" title={d.label}>
                {d.label}
              </span>
              <span className="relative h-4 overflow-hidden rounded-full bg-muted">
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ background: color }}
                  initial={reduced ? false : { width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, delay: i * 0.05, ease: "easeOut" }}
                />
              </span>
              <span className="min-w-8 text-right font-tabular text-xs font-semibold tabular-nums text-foreground">
                {formatCompact(d.value)}
              </span>
            </li>
          );
        })}
      </ul>

      <ChartTooltip state={tip} containerWidth={width} />

      <ChartDataTable
        caption={ariaLabel}
        columns={["Item", "Value"]}
        rows={data.map((d) => ({ label: d.label, values: [d.value] }))}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vertical                                                            */
/* ------------------------------------------------------------------ */

const VB_W = 640;

function VerticalBars({
  data,
  ariaLabel,
  tone,
  height,
  className,
}: {
  data: BarDatum[];
  ariaLabel: string;
  tone: BarDatum["tone"];
  height: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const { ref, width } = useContainerWidth<HTMLDivElement>();
  const [tip, setTip] = React.useState<TooltipState | null>(null);

  const VB_H = 200;
  const PAD = { top: 12, right: 8, bottom: 30, left: 34 };
  const plot = {
    x: PAD.left,
    y: PAD.top,
    width: VB_W - PAD.left - PAD.right,
    height: VB_H - PAD.top - PAD.bottom,
  };
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const n = data.length;
  const slot = n > 0 ? plot.width / n : plot.width;
  const barW = Math.min(48, slot * 0.6);
  const yTicks = [0, max / 2, max];

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
        {yTicks.map((v, i) => {
          const y = plot.y + plot.height - (v / max) * plot.height;
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

        {data.map((d, i) => {
          const cx = plot.x + slot * i + slot / 2;
          const h = (d.value / max) * plot.height;
          const y = plot.y + plot.height - h;
          const color = resolveTone(d.tone ?? tone);
          return (
            <g
              key={`${d.label}-${i}`}
              onPointerEnter={(e) => {
                const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
                if (!rect) return;
                setTip({
                  x: (cx / VB_W) * rect.width,
                  y: (y / VB_H) * rect.height,
                  title: d.label,
                  rows: [
                    ...(d.hint ? [{ label: d.hint, value: "" }] : []),
                    { value: formatFull(d.value), tone: color },
                  ],
                });
              }}
              onPointerLeave={() => setTip(null)}
              style={{ cursor: "pointer" }}
            >
              <motion.rect
                x={round(cx - barW / 2)}
                width={round(barW)}
                rx={3}
                fill={color}
                initial={reduced ? false : { height: 0, y: plot.y + plot.height }}
                animate={{ height: round(h), y: round(y) }}
                transition={{ duration: 0.6, delay: i * 0.05, ease: "easeOut" }}
              />
              {/* Transparent full-height hit target for reliable hover. */}
              <rect
                x={round(cx - slot / 2)}
                y={plot.y}
                width={round(slot)}
                height={plot.height}
                fill="transparent"
              />
              <text
                x={round(cx)}
                y={VB_H - 10}
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: 10 }}
              >
                {truncate(d.label, 10)}
              </text>
            </g>
          );
        })}
      </svg>

      <ChartTooltip state={tip} containerWidth={width} />

      <ChartDataTable
        caption={ariaLabel}
        columns={["Item", "Value"]}
        rows={data.map((d) => ({ label: d.label, values: [d.value] }))}
      />
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
