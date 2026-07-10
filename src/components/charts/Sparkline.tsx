"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { linePoints, resolveTone, round, scaleLinear } from "./chart-utils";
import type { ChartTone } from "./types";

interface SparklineProps {
  /** Raw values, oldest → newest. */
  data: number[];
  ariaLabel: string;
  tone?: ChartTone | (string & {});
  /** Fill a soft gradient under the line. @default true */
  area?: boolean;
  width?: number;
  height?: number;
  className?: string;
}

const VB_W = 120;
const VB_H = 32;
const PAD = 2;

/**
 * Tiny inline trend line — no axes, no labels. For embedding in a StatCard or
 * table cell. Accessible via `role="img"` + `aria-label` (the numeric summary
 * belongs on the surrounding card). Reduced-motion aware.
 */
export function Sparkline({
  data,
  ariaLabel,
  tone = "primary",
  area = true,
  width = 96,
  height = 28,
  className,
}: SparklineProps) {
  const reduced = useReducedMotion();
  const color = resolveTone(tone);
  const uid = React.useId().replace(/:/g, "");

  const max = Math.max(1, ...data);
  const min = Math.min(0, ...data);
  const plot = { x: PAD, y: PAD, width: VB_W - PAD * 2, height: VB_H - PAD * 2 };
  const pts = linePoints(data, plot, max, min);

  const areaPath =
    area && pts
      ? `M ${plot.x},${plot.y + plot.height} ` +
        pts
          .split(" ")
          .map((pt) => `L ${pt}`)
          .join(" ") +
        ` L ${plot.x + plot.width},${plot.y + plot.height} Z`
      : null;

  const lastY =
    data.length > 0
      ? plot.y + plot.height - scaleLinear(data[data.length - 1], min, max, 0, plot.height)
      : plot.y;

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      className={cn("overflow-visible", className)}
      style={{ width, height }}
    >
      {areaPath ? (
        <>
          <defs>
            <linearGradient id={`spark-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#spark-${uid})`} />
        </>
      ) : null}
      <motion.polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.7 }}
      />
      {data.length > 0 ? (
        <circle
          cx={round(plot.x + plot.width)}
          cy={round(lastY)}
          r={2}
          fill={color}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}
