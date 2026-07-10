"use client";

/**
 * Presentational "chrome" for the DealSheet grid — everything around the cells:
 *
 * - `GridHeaderRow`     sortable / resizable / reorderable / pinnable headers,
 *                       each with an inline filter input.
 * - `GridRowGutter`     the sticky row-number column (+ full-row select).
 * - `GridDensityToggle` compact / comfortable switch.
 * - `SelectionOutline`  an animated (motion/react) outline around the active
 *                       selection rectangle; respects reduced-motion.
 *
 * These are pure view components: they render from props and emit callbacks.
 * All state (selection, sort, order, widths) lives in the grid shell / core
 * hooks. Nothing here reads domain fields — it works off `ColumnDef` + geometry.
 */

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  GripVertical,
  Pin,
  PinOff,
  Rows2,
  Rows3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { springs } from "@/components/motion/tokens";
import type { ColumnDef, GridRow, SortSpec } from "../types";
import type { GridDensity } from "./useVirtualRows";
import type { SelectionBounds } from "./selection";

/* -------------------------------------------------------------------------- */
/*  Density toggle                                                            */
/* -------------------------------------------------------------------------- */

export interface GridDensityToggleProps {
  density: GridDensity;
  onChange: (density: GridDensity) => void;
  className?: string;
}

/** Compact ⇄ comfortable row-density switch. */
export function GridDensityToggle({
  density,
  onChange,
  className,
}: GridDensityToggleProps) {
  return (
    <div
      role="group"
      aria-label="Row density"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5",
        className,
      )}
    >
      <DensityButton
        active={density === "compact"}
        label="Compact rows"
        onClick={() => onChange("compact")}
      >
        <Rows3 className="size-3.5" />
      </DensityButton>
      <DensityButton
        active={density === "comfortable"}
        label="Comfortable rows"
        onClick={() => onChange("comfortable")}
      >
        <Rows2 className="size-3.5" />
      </DensityButton>
    </div>
  );
}

function DensityButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Row-number gutter                                                        */
/* -------------------------------------------------------------------------- */

export interface GridRowGutterProps {
  /** 1-based row number to display. */
  rowNumber: number;
  /** Whether the whole row is selected. */
  selected?: boolean;
  /** Row height in px (from density). */
  height: number;
  /** Gutter width in px. */
  width: number;
  /** Toggle whole-row selection; `range`/`additive` mirror the selection API. */
  onSelect?: (opts: { additive: boolean; range: boolean }) => void;
  className?: string;
}

/** A single sticky row-number cell doubling as a full-row select handle. */
export function GridRowGutter({
  rowNumber,
  selected = false,
  height,
  width,
  onSelect,
  className,
}: GridRowGutterProps) {
  return (
    <button
      type="button"
      aria-label={`Select row ${rowNumber}`}
      aria-pressed={selected}
      data-selected={selected || undefined}
      onClick={(e) =>
        onSelect?.({ additive: e.metaKey || e.ctrlKey, range: e.shiftKey })
      }
      style={{ height, width }}
      className={cn(
        "sticky left-0 z-20 flex shrink-0 items-center justify-center border-r border-b border-border bg-muted/40 text-xs tabular-nums transition-colors select-none",
        selected
          ? "bg-primary/15 font-medium text-primary"
          : "text-muted-foreground hover:bg-muted",
        className,
      )}
    >
      {rowNumber}
    </button>
  );
}

/** The gutter header cell (aligns with the header row). */
export function GridGutterHeader({
  width,
  height,
  onSelectAll,
  className,
}: {
  width: number;
  height: number;
  onSelectAll?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label="Select all"
      title="Select all"
      onClick={onSelectAll}
      style={{ width, height }}
      className={cn(
        "sticky left-0 top-0 z-30 shrink-0 border-r border-b border-border bg-muted/60 text-muted-foreground transition-colors hover:bg-muted",
        className,
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Header row                                                                */
/* -------------------------------------------------------------------------- */

export interface GridHeaderCellCallbacks<Row extends GridRow = GridRow> {
  /** Cycle sort for a column (asc → desc → none). Shift preserves multi-sort. */
  onSort?: (colKey: string, additive: boolean) => void;
  /** Toggle a whole-column selection (header click when not on a control). */
  onSelectColumn?: (colKey: string, opts: { additive: boolean; range: boolean }) => void;
  /** Live-resize a column to `width` px (drag on the right edge). */
  onResize?: (colKey: string, width: number) => void;
  /** Commit a reorder: move `colKey` before `beforeColKey` (null = to the end). */
  onReorder?: (colKey: string, beforeColKey: string | null) => void;
  /** Toggle the column's left-pin. */
  onTogglePin?: (colKey: string) => void;
  /** Update a column's filter query. */
  onFilter?: (colKey: string, query: string) => void;
  /** Column being referenced by callbacks is a `ColumnDef<Row>`. */
  readonly _row?: Row;
}

export interface GridHeaderRowProps<Row extends GridRow = GridRow>
  extends GridHeaderCellCallbacks<Row> {
  /** Columns in display order (pinned first). */
  columns: readonly ColumnDef<Row>[];
  /** Resolved width per column key (px). */
  widths: Record<string, number>;
  /** Active sort directives, primary first. */
  sort?: readonly SortSpec[];
  /** Active filter queries by column key. */
  filters?: Record<string, string>;
  /** Column keys currently fully selected (highlighted). */
  selectedColumns?: ReadonlySet<string>;
  /** Header row height in px (density). */
  height: number;
  /** Left inset (pinned width) applied so non-pinned headers start correctly. */
  className?: string;
}

/** The full header row: one `GridHeaderCell` per column. */
export function GridHeaderRow<Row extends GridRow = GridRow>({
  columns,
  widths,
  sort,
  filters,
  selectedColumns,
  height,
  className,
  onSort,
  onSelectColumn,
  onResize,
  onReorder,
  onTogglePin,
  onFilter,
}: GridHeaderRowProps<Row>) {
  const [dragKey, setDragKey] = React.useState<string | null>(null);

  const sortFor = React.useCallback(
    (key: string): SortSpec | undefined => sort?.find((s) => s.colKey === key),
    [sort],
  );

  return (
    <div
      role="row"
      className={cn("flex", className)}
      style={{ height }}
    >
      {columns.map((col) => (
        <GridHeaderCell<Row>
          key={col.key}
          col={col}
          width={widths[col.key] ?? col.width ?? DEFAULT_COL_WIDTH}
          height={height}
          sort={sortFor(col.key)}
          filter={filters?.[col.key] ?? ""}
          selected={selectedColumns?.has(col.key) ?? false}
          dragging={dragKey === col.key}
          dropTarget={dragKey !== null && dragKey !== col.key}
          onSort={onSort}
          onSelectColumn={onSelectColumn}
          onResize={onResize}
          onTogglePin={onTogglePin}
          onFilter={onFilter}
          onDragStart={() => setDragKey(col.key)}
          onDragEnd={() => setDragKey(null)}
          onDrop={(beforeKey) => {
            if (dragKey && dragKey !== col.key) onReorder?.(dragKey, beforeKey);
            setDragKey(null);
          }}
        />
      ))}
    </div>
  );
}

const DEFAULT_COL_WIDTH = 160;
const MIN_COL_WIDTH = 56;

interface GridHeaderCellProps<Row extends GridRow> {
  col: ColumnDef<Row>;
  width: number;
  height: number;
  sort?: SortSpec;
  filter: string;
  selected: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onSort?: (colKey: string, additive: boolean) => void;
  onSelectColumn?: (colKey: string, opts: { additive: boolean; range: boolean }) => void;
  onResize?: (colKey: string, width: number) => void;
  onTogglePin?: (colKey: string) => void;
  onFilter?: (colKey: string, query: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: (beforeColKey: string | null) => void;
}

function GridHeaderCell<Row extends GridRow>({
  col,
  width,
  height,
  sort,
  filter,
  selected,
  dragging,
  dropTarget,
  onSort,
  onSelectColumn,
  onResize,
  onTogglePin,
  onFilter,
  onDragStart,
  onDragEnd,
  onDrop,
}: GridHeaderCellProps<Row>) {
  const pinned = col.pinned === "left";

  /* ---- column resize via pointer drag on the right edge ---- */
  const resizeRef = React.useRef<{ startX: number; startW: number } | null>(null);
  const beginResize = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { startX: e.clientX, startW: width };
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
    },
    [width],
  );
  const onResizeMove = React.useCallback(
    (e: React.PointerEvent) => {
      const s = resizeRef.current;
      if (!s) return;
      const next = Math.max(MIN_COL_WIDTH, Math.round(s.startW + (e.clientX - s.startX)));
      onResize?.(col.key, next);
    },
    [col.key, onResize],
  );
  const endResize = React.useCallback((e: React.PointerEvent) => {
    resizeRef.current = null;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div
      role="columnheader"
      aria-sort={
        sort ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
      data-col={col.key}
      data-selected={selected || undefined}
      data-pinned={pinned || undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/grid-col", col.key);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (dropTarget) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(col.key);
      }}
      style={{ width, height }}
      className={cn(
        "group/header relative flex shrink-0 flex-col justify-center border-r border-b border-border bg-muted/60 text-left transition-colors",
        pinned && "sticky z-20",
        selected && "bg-primary/10",
        dragging && "opacity-50",
        dropTarget && "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
      )}
    >
      <div className="flex items-center gap-1 px-2 pt-1">
        <GripVertical
          aria-hidden
          className="size-3 shrink-0 cursor-grab text-muted-foreground/40 opacity-0 transition-opacity group-hover/header:opacity-100"
        />
        <button
          type="button"
          onClick={(e) => {
            // Plain click sorts; modifier-click selects the whole column.
            if (e.altKey) {
              onSelectColumn?.(col.key, {
                additive: e.metaKey || e.ctrlKey,
                range: e.shiftKey,
              });
            } else {
              onSort?.(col.key, e.shiftKey);
            }
          }}
          title={`${col.header} — click to sort, Alt+click to select column`}
          className="flex min-w-0 flex-1 items-center gap-1 truncate text-xs font-semibold text-foreground outline-none"
        >
          <span className="truncate">{col.header}</span>
          <SortGlyph dir={sort?.dir} />
        </button>
        <button
          type="button"
          aria-label={pinned ? "Unpin column" : "Pin column left"}
          title={pinned ? "Unpin column" : "Pin column left"}
          onClick={() => onTogglePin?.(col.key)}
          className={cn(
            "inline-flex size-4 items-center justify-center rounded text-muted-foreground/50 transition-opacity hover:text-foreground",
            pinned ? "opacity-100 text-primary" : "opacity-0 group-hover/header:opacity-100",
          )}
        >
          {pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
        </button>
      </div>

      <div className="px-1.5 pb-1">
        <input
          value={filter}
          onChange={(e) => onFilter?.(col.key, e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Filter…"
          aria-label={`Filter ${col.header}`}
          className="h-5 w-full rounded border border-transparent bg-background/60 px-1.5 text-[11px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:border-border focus:border-ring focus:bg-background"
        />
      </div>

      {/* Resize handle */}
      <div
        role="separator"
        aria-label={`Resize ${col.header}`}
        aria-orientation="vertical"
        onPointerDown={beginResize}
        onPointerMove={onResizeMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onDragStart={(e) => e.preventDefault()}
        className="absolute top-0 right-0 z-10 h-full w-1.5 translate-x-1/2 cursor-col-resize touch-none hover:bg-primary/40"
      />
    </div>
  );
}

function SortGlyph({ dir }: { dir?: "asc" | "desc" }) {
  if (dir === "asc") return <ArrowUp className="size-3 shrink-0 text-primary" />;
  if (dir === "desc") return <ArrowDown className="size-3 shrink-0 text-primary" />;
  return (
    <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover/header:opacity-100" />
  );
}

/* -------------------------------------------------------------------------- */
/*  Selection outline                                                         */
/* -------------------------------------------------------------------------- */

export interface SelectionOutlineProps {
  /** Selection bounds in index space, or null to hide. */
  bounds: SelectionBounds | null;
  /** Cumulative left offset (px) for a column index. */
  columnOffset: (colIndex: number) => number;
  /** Width (px) for a column index. */
  columnWidth: (colIndex: number) => number;
  /** Row height in px. */
  rowHeight: number;
  /** Top offset (px) of the first data row (i.e. header height). */
  rowOffset?: number;
  className?: string;
}

/**
 * An animated outline drawn around the current selection rectangle. It springs
 * smoothly between selections (and snaps instantly when reduced motion is on).
 * Purely positional — it reads geometry callbacks, never the data.
 */
export function SelectionOutline({
  bounds,
  columnOffset,
  columnWidth,
  rowHeight,
  rowOffset = 0,
  className,
}: SelectionOutlineProps) {
  const reduced = useReducedMotion();
  if (!bounds) return null;

  const left = columnOffset(bounds.minCol);
  const top = rowOffset + bounds.minRow * rowHeight;
  let width = 0;
  for (let c = bounds.minCol; c <= bounds.maxCol; c++) width += columnWidth(c);
  const height = (bounds.maxRow - bounds.minRow + 1) * rowHeight;

  return (
    <motion.div
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-10 rounded-[3px] border-2 border-primary bg-primary/5 shadow-[0_0_0_1px_var(--color-background)]",
        className,
      )}
      initial={false}
      animate={{ left, top, width, height }}
      transition={reduced ? { duration: 0 } : springs.snappy}
      style={{ left, top, width, height }}
    />
  );
}
