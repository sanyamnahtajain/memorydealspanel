import type { ChartTone } from "./chart-utils";

/** A single point in a time series or categorical series. */
export interface ChartPoint {
  /** X-axis label (date string, category name, …). */
  label: string;
  /** Numeric value plotted on the Y axis. */
  value: number;
}

/** A named series for multi-series charts (approvals vs rejections, …). */
export interface ChartSeries {
  name: string;
  points: ChartPoint[];
  /** Explicit tone; falls back to the series palette by index when omitted. */
  tone?: ChartTone;
}

/** A slice for the donut chart. */
export interface DonutSlice {
  label: string;
  value: number;
  /** Explicit tone; falls back to the series palette by index when omitted. */
  tone?: ChartTone;
}

/** A single bar for the bar chart. */
export interface BarDatum {
  label: string;
  value: number;
  /** Optional secondary text (e.g. SKU) shown in the tooltip. */
  hint?: string;
  tone?: ChartTone;
}

export type { ChartTone };
