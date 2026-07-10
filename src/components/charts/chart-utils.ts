/**
 * Shared primitives for the hand-built SVG chart kit.
 *
 * The charts are drawn in an abstract, unitless coordinate space (a fixed
 * `viewBox`) and stretched responsively by their container — no measurement,
 * no chart library. These helpers keep the geometry math in one tested place
 * and pin every stroke/fill to a semantic token via the `series` palette.
 */

/** Ordered series palette — semantic CSS variables only (never raw hex). */
export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/** Named semantic colors for single-tone charts. */
export const TONE_COLORS = {
  primary: "var(--primary)",
  success: "var(--success)",
  warning: "var(--warning)",
  destructive: "var(--destructive)",
  muted: "var(--muted-foreground)",
} as const;

export type ChartTone = keyof typeof TONE_COLORS;

/** Resolve a tone name (or an explicit CSS color) to a paintable value. */
export function resolveTone(tone: ChartTone | (string & {}) = "primary"): string {
  return (TONE_COLORS as Record<string, string>)[tone] ?? tone;
}

/** Pick a series color by index, wrapping around the palette. */
export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

/** Compact integer formatter shared by axes and tooltips (1.2k, 3.4M). */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(n / 1_000)}k`;
  return `${Math.round(n)}`;
}

function trim(n: number): string {
  // One decimal, but drop a trailing ".0" so "1.0k" renders as "1k".
  return n.toFixed(1).replace(/\.0$/, "");
}

/** Full-grouping integer formatter for the visually-hidden data table. */
const groupFmt = new Intl.NumberFormat("en-IN");
export function formatFull(n: number): string {
  return groupFmt.format(n);
}

/**
 * Map a value in `[min, max]` onto a pixel span `[from, to]`.
 * `max === min` collapses to the midpoint so flat series still render.
 */
export function scaleLinear(
  value: number,
  min: number,
  max: number,
  from: number,
  to: number,
): number {
  if (max === min) return (from + to) / 2;
  const t = (value - min) / (max - min);
  return from + t * (to - from);
}

/**
 * Build an SVG polyline `points` string for a series, mapping each value onto
 * the plot rect. `y` is inverted (SVG origin is top-left).
 */
export function linePoints(
  values: number[],
  bounds: { x: number; y: number; width: number; height: number },
  max: number,
  min = 0,
): string {
  const n = values.length;
  if (n === 0) return "";
  return values
    .map((v, i) => {
      const x = n === 1 ? bounds.x + bounds.width / 2 : bounds.x + (i / (n - 1)) * bounds.width;
      const y = bounds.y + bounds.height - (scaleLinear(v, min, max, 0, bounds.height) - 0);
      return `${round(x)},${round(y)}`;
    })
    .join(" ");
}

/** Round to 2dp to keep generated path strings compact and deterministic. */
export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Describe an SVG arc segment of a donut/pie as a filled path (annulus wedge).
 * Angles are in radians, measured clockwise from 12 o'clock.
 */
export function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number,
): string {
  // Guard the full-circle case: SVG arcs can't draw a 360° sweep in one segment.
  const sweep = endAngle - startAngle;
  const clamped = Math.min(sweep, Math.PI * 2 - 1e-4);
  const end = startAngle + clamped;

  const p0 = polar(cx, cy, rOuter, startAngle);
  const p1 = polar(cx, cy, rOuter, end);
  const p2 = polar(cx, cy, rInner, end);
  const p3 = polar(cx, cy, rInner, startAngle);
  const largeArc = clamped > Math.PI ? 1 : 0;

  return [
    `M ${round(p0.x)} ${round(p0.y)}`,
    `A ${round(rOuter)} ${round(rOuter)} 0 ${largeArc} 1 ${round(p1.x)} ${round(p1.y)}`,
    `L ${round(p2.x)} ${round(p2.y)}`,
    `A ${round(rInner)} ${round(rInner)} 0 ${largeArc} 0 ${round(p3.x)} ${round(p3.y)}`,
    "Z",
  ].join(" ");
}

/** Point on a circle at `angle` radians clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  return {
    x: cx + r * Math.sin(angle),
    y: cy - r * Math.cos(angle),
  };
}

/** Nice-ish max: round a raw peak up to a readable tick so bars don't touch the top. */
export function niceMax(peak: number): number {
  if (peak <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(peak)));
  const normalized = peak / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}
