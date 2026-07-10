"use client";

/**
 * Row (and optional column) virtualization for the DealSheet grid.
 *
 * Wraps `@tanstack/react-virtual` so the grid can render tens of thousands of
 * rows at 60fps by only mounting the cells inside the viewport. Row height is
 * driven by a `density` token (compact / comfortable) and columns can be
 * horizontally virtualized too — with the pinned (sticky) first column always
 * rendered so it never blanks while scrolling.
 *
 * The hook is generic over the row type only to the extent that it needs a
 * stable key per row; it hardcodes no domain fields.
 */

import * as React from "react";
import {
  useVirtualizer,
  type Virtualizer,
  type VirtualItem,
} from "@tanstack/react-virtual";

/** Vertical density of the grid; maps to a fixed row height. */
export type GridDensity = "compact" | "comfortable";

/** Row height in px per density. Compact is tight/spreadsheet-like. */
export const ROW_HEIGHT: Record<GridDensity, number> = {
  compact: 28,
  comfortable: 40,
};

/** Header row height in px per density. */
export const HEADER_HEIGHT: Record<GridDensity, number> = {
  compact: 32,
  comfortable: 40,
};

/** How many rows/cols to render beyond the viewport edges (smoothness buffer). */
const DEFAULT_OVERSCAN = 8;

export interface UseVirtualRowsOptions {
  /** Total number of (visible) rows. */
  rowCount: number;
  /** Ordered column widths in px, left→right (post reorder/hide). */
  columnWidths: readonly number[];
  /** Vertical density; selects the row height. */
  density: GridDensity;
  /** Scroll container element (the grid viewport). */
  scrollElement: HTMLElement | null;
  /**
   * Number of leading columns pinned to the left (sticky). These are always
   * rendered and excluded from horizontal virtualization. Defaults to 1.
   */
  pinnedColumnCount?: number;
  /** Whether to virtualize columns horizontally. Off by default (few columns). */
  virtualizeColumns?: boolean;
  /** Overscan buffer; larger = smoother fast scroll, more DOM. */
  overscan?: number;
  /**
   * Stable key per row index — pass the row id so React keys stay stable across
   * sort/filter and the virtualizer can preserve measured sizes.
   */
  getRowKey?: (index: number) => string | number;
}

export interface PinnedColumn {
  /** Absolute column index. */
  index: number;
  /** Left offset in px (cumulative width of preceding pinned columns). */
  start: number;
  /** Column width in px. */
  size: number;
}

export interface UseVirtualRowsResult {
  /** The row virtualizer instance (for imperative `scrollToIndex`, etc.). */
  rowVirtualizer: Virtualizer<HTMLElement, Element>;
  /** Virtual rows currently in the viewport. */
  virtualRows: VirtualItem[];
  /** Total scrollable height in px (drives the vertical spacer). */
  totalHeight: number;
  /** Resolved row height for the current density. */
  rowHeight: number;

  /** The sticky/pinned leading columns, always rendered. */
  pinnedColumns: PinnedColumn[];
  /** Combined px width of all pinned columns (left inset for scrollables). */
  pinnedWidth: number;

  /** Virtual (scrollable) columns in view — `null` when column virtualization is off. */
  virtualColumns: VirtualItem[] | null;
  /** Total scrollable width in px (drives the horizontal spacer). */
  totalWidth: number;

  /** Imperatively scroll a row index into view. */
  scrollToRow: (index: number, align?: "auto" | "start" | "center" | "end") => void;
  /** Imperatively scroll a column index into view (no-op if not virtualizing). */
  scrollToColumn: (index: number, align?: "auto" | "start" | "center" | "end") => void;
}

export function useVirtualRows(
  options: UseVirtualRowsOptions,
): UseVirtualRowsResult {
  const {
    rowCount,
    columnWidths,
    density,
    scrollElement,
    pinnedColumnCount = 1,
    virtualizeColumns = false,
    overscan = DEFAULT_OVERSCAN,
    getRowKey,
  } = options;

  const rowHeight = ROW_HEIGHT[density];

  // A stable getter for the scroll element the virtualizer polls each render.
  const getScrollElement = React.useCallback(
    () => scrollElement,
    [scrollElement],
  );

  /* ------------------------------- rows -------------------------------- */
  const estimateRowSize = React.useCallback(() => rowHeight, [rowHeight]);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement,
    estimateSize: estimateRowSize,
    overscan,
    ...(getRowKey ? { getItemKey: getRowKey } : {}),
  });

  // Re-measure when density (and thus row height) changes so offsets stay exact.
  React.useEffect(() => {
    rowVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight]);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalHeight = rowVirtualizer.getTotalSize();

  /* ----------------------------- pinned cols --------------------------- */
  const clampedPinned = Math.min(
    Math.max(0, pinnedColumnCount),
    columnWidths.length,
  );

  const { pinnedColumns, pinnedWidth } = React.useMemo(() => {
    const cols: PinnedColumn[] = [];
    let start = 0;
    for (let i = 0; i < clampedPinned; i++) {
      const size = columnWidths[i] ?? 0;
      cols.push({ index: i, start, size });
      start += size;
    }
    return { pinnedColumns: cols, pinnedWidth: start };
  }, [clampedPinned, columnWidths]);

  /* ---------------------------- scrollable cols ------------------------ */
  // Only the non-pinned tail is horizontally virtualized. When column
  // virtualization is disabled we render them all (typical: < ~40 columns).
  const scrollableCount = Math.max(0, columnWidths.length - clampedPinned);

  const getScrollableColSize = React.useCallback(
    (i: number) => columnWidths[i + clampedPinned] ?? 0,
    [columnWidths, clampedPinned],
  );

  const colVirtualizer = useVirtualizer({
    count: scrollableCount,
    getScrollElement,
    estimateSize: getScrollableColSize,
    overscan,
    horizontal: true,
    // Guard: react-virtual needs a valid element; it self-disables until mounted.
  });

  // Keep column sizes fresh when widths change (resize/reorder).
  React.useEffect(() => {
    if (virtualizeColumns) colVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnWidths, virtualizeColumns]);

  const scrollableTotal = virtualizeColumns
    ? colVirtualizer.getTotalSize()
    : sum(columnWidths.slice(clampedPinned));

  const totalWidth = pinnedWidth + scrollableTotal;

  const virtualColumns = virtualizeColumns
    ? colVirtualizer.getVirtualItems()
    : null;

  /* ------------------------------ imperative --------------------------- */
  const scrollToRow = React.useCallback(
    (index: number, align: "auto" | "start" | "center" | "end" = "auto") => {
      rowVirtualizer.scrollToIndex(index, { align });
    },
    [rowVirtualizer],
  );

  const scrollToColumn = React.useCallback(
    (index: number, align: "auto" | "start" | "center" | "end" = "auto") => {
      if (!virtualizeColumns) return;
      const scrollable = index - clampedPinned;
      if (scrollable < 0) return; // pinned columns are always visible
      colVirtualizer.scrollToIndex(scrollable, { align });
    },
    [virtualizeColumns, colVirtualizer, clampedPinned],
  );

  return {
    rowVirtualizer,
    virtualRows,
    totalHeight,
    rowHeight,
    pinnedColumns,
    pinnedWidth,
    virtualColumns,
    totalWidth,
    scrollToRow,
    scrollToColumn,
  };
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
