/**
 * Custom, dependency-free SVG chart kit. Import via `@/components/charts`.
 *
 * Every chart is responsive (viewBox + container), themed with semantic tokens
 * only, accessible (role=img + aria-label + a visually-hidden data table),
 * animated-in with reduced-motion support, and uses a custom hover tooltip
 * (never the native SVG `<title>`).
 */
export { ChartCard, ChartCardSkeleton } from "./ChartCard";
export { LineChart } from "./LineChart";
export { BarChart } from "./BarChart";
export { DonutChart } from "./DonutChart";
export { Sparkline } from "./Sparkline";
export { ChartDataTable } from "./ChartDataTable";
export { ChartTooltip, useContainerWidth } from "./ChartTooltip";
export type { TooltipState } from "./ChartTooltip";
export type { ChartPoint, ChartSeries, DonutSlice, BarDatum, ChartTone } from "./types";
export {
  SERIES_COLORS,
  TONE_COLORS,
  resolveTone,
  seriesColor,
  formatCompact,
  formatFull,
  niceMax,
} from "./chart-utils";
