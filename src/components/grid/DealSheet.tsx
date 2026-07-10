"use client";

/**
 * DealSheet — the public, Excel-like desktop data grid.
 *
 * Composes every builder layer through {@link useGridController}: virtualized
 * rows/columns, a pure selection model, a full keyboard map, typed cell
 * editors, optimistic autosave with per-row status + conflict chips, undo/redo,
 * clipboard copy/cut/paste, fill (handle + Ctrl+D), bulk actions, sortable /
 * filterable / resizable / reorderable / pinnable / hideable columns, saved
 * views, Ctrl+F search, a ghost quick-add row, and optional row grouping.
 *
 * The grid is GENERIC: it renders any `Row extends GridRow` from an injected
 * `ColumnDef<Row>[]` and persists through an injected `OnSave<Row>`. It hardcodes
 * no domain fields.
 */

import * as React from "react";
import {
  Redo2,
  Undo2,
  Plus,
  Search as SearchIcon,
  X,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  GitBranchPlus,
  Save,
  Eye,
  EyeOff,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import type { CellCoord, ColumnDef, GridRow, OnSave, SaveStatus } from "./types";
import { isColumnEditable } from "./types";
import {
  useVirtualRows,
  type GridDensity,
  HEADER_HEIGHT,
} from "./core/useVirtualRows";
import { useGridKeyboard } from "./core/useGridKeyboard";
import {
  GridDensityToggle,
  GridGutterHeader,
  GridHeaderRow,
  GridRowGutter,
  SelectionOutline,
} from "./core/GridChrome";
import { getCellComponents } from "./cells";
import { BulkActionBar, standardBulkActions } from "./data/BulkActionBar";
import { useGridController } from "./useGridController";

/* -------------------------------------------------------------------------- */
/*  Public props                                                              */
/* -------------------------------------------------------------------------- */

export interface DealSheetProps<Row extends GridRow = GridRow> {
  /** Stable grid identity (namespaces saved views in localStorage). */
  gridId: string;
  /** The rows to display. */
  rows: Row[];
  /** Column configuration; the engine reads type/validate/compute/format here. */
  columns: ColumnDef<Row>[];
  /** Injected persistence — receives `(rowId, patch)` and resolves on success. */
  onSave: OnSave<Row>;
  /** Optional handler to open an image manager for a row (ImageCell). */
  onOpenImages?: (rowId: string) => void;
  /** Optional column key to group rows under sticky group headers. */
  groupByKey?: keyof Row & string;
  /** Factory for the ghost quick-add row; when omitted, quick-add is hidden. */
  makeBlankRow?: () => Row;
  /** Initial vertical density. */
  density?: GridDensity;
  className?: string;
}

const GUTTER_WIDTH = 44;
const DEFAULT_COL_WIDTH = 160;

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function DealSheet<Row extends GridRow = GridRow>({
  gridId,
  rows,
  columns,
  onSave,
  onOpenImages,
  groupByKey,
  makeBlankRow,
  density: initialDensity = "compact",
  className,
}: DealSheetProps<Row>) {
  const ctrl = useGridController<Row>({
    gridId,
    rows,
    columns,
    onSave,
    onOpenImages,
    groupByKey,
    makeBlankRow,
  });

  const [density, setDensity] = React.useState<GridDensity>(initialDensity);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = React.useState<HTMLElement | null>(null);

  const { viewRows, viewColumns } = ctrl;

  /* --------------------------- column geometry -------------------------- */
  const widthOf = React.useCallback(
    (col: ColumnDef<Row>) =>
      ctrl.widths[col.key] ?? col.width ?? DEFAULT_COL_WIDTH,
    [ctrl.widths],
  );

  const columnWidths = React.useMemo(
    () => viewColumns.map(widthOf),
    [viewColumns, widthOf],
  );

  const widthsRecord = React.useMemo(() => {
    const rec: Record<string, number> = {};
    viewColumns.forEach((c) => (rec[c.key] = widthOf(c)));
    return rec;
  }, [viewColumns, widthOf]);

  const columnOffset = React.useCallback(
    (colIndex: number) => {
      let x = 0;
      for (let i = 0; i < colIndex && i < columnWidths.length; i++)
        x += columnWidths[i];
      return x;
    },
    [columnWidths],
  );

  const columnWidthAt = React.useCallback(
    (colIndex: number) => columnWidths[colIndex] ?? DEFAULT_COL_WIDTH,
    [columnWidths],
  );

  /* ----------------------------- virtualizer ---------------------------- */
  const getRowKey = React.useCallback(
    (index: number) => viewRows[index]?.id ?? index,
    [viewRows],
  );

  const virtual = useVirtualRows({
    rowCount: viewRows.length,
    columnWidths,
    density,
    scrollElement: scrollEl,
    pinnedColumnCount: 0, // pinning handled via sticky CSS on the cells
    getRowKey,
  });

  const headerHeight = HEADER_HEIGHT[density];

  /* ------------------------------- editing ------------------------------ */
  const isEditing = ctrl.editing !== null;

  const commitDown = React.useCallback(
    (dir: "down" | "up") => {
      if (ctrl.editing) {
        // Editors commit on blur; here we just leave edit mode and move.
        ctrl.cancelEdit();
      }
      ctrl.selection.moveActive(dir);
    },
    [ctrl],
  );

  const onTab = React.useCallback(
    (dir: "next" | "prev") => {
      if (ctrl.editing) ctrl.cancelEdit();
      ctrl.selection.moveActive(dir === "next" ? "right" : "left");
    },
    [ctrl],
  );

  /* ------------------------------ keyboard ------------------------------ */
  const keyboard = useGridKeyboard({
    selection: ctrl.selection,
    isEditing,
    enabled: true,
    onEditStart: (char) => {
      const active = ctrl.selection.activeCoord;
      if (active) ctrl.beginEdit(active, char);
    },
    onEditCommit: () => {
      // Editors own commit-on-Enter; just exit and step down.
      ctrl.cancelEdit();
      ctrl.selection.moveActive("down");
    },
    onEditCancel: ctrl.cancelEdit,
    onClear: ctrl.clearSelection,
    onTab,
    onCommitMove: commitDown,
    onCopy: ctrl.copySelection,
    onCut: ctrl.cutSelection,
    onPaste: ctrl.pasteFromClipboard,
    onFillDown: ctrl.fillDownSelection,
    onFillRight: ctrl.fillRightSelection,
    onUndo: ctrl.undo,
    onRedo: ctrl.redo,
  });

  // Ctrl/Cmd+F opens the in-grid search bar; the rest flows to the grid model.
  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      keyboard.onKeyDown(e);
    },
    [keyboard],
  );

  /* ----------------------------- scroll ref ----------------------------- */
  React.useEffect(() => {
    setScrollEl(scrollRef.current);
  }, []);

  // Scroll the active cell into view on keyboard navigation.
  const activeCoord = ctrl.selection.activeCoord;
  React.useEffect(() => {
    if (!activeCoord) return;
    const rowIndex = viewRows.findIndex((r) => r.id === activeCoord.rowId);
    if (rowIndex >= 0) virtual.scrollToRow(rowIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCoord?.rowId, activeCoord?.colKey]);

  /* -------------------------- selection bounds -------------------------- */
  const selectionBounds = ctrl.selection.bounds;

  /* -------------------------------- render ------------------------------ */
  const totalGridWidth = GUTTER_WIDTH + virtual.totalWidth;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      <GridToolbar
        ctrl={ctrl}
        density={density}
        onDensity={setDensity}
        searchOpen={searchOpen}
        onToggleSearch={() => setSearchOpen((v) => !v)}
      />

      {searchOpen ? (
        <SearchBar ctrl={ctrl} onClose={() => setSearchOpen(false)} />
      ) : null}

      <div
        ref={scrollRef}
        role="grid"
        aria-rowcount={viewRows.length}
        aria-colcount={viewColumns.length}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {/* Sizing surface: header + body share one wide, tall canvas. */}
        <div
          style={{ width: totalGridWidth }}
          className="relative min-w-full"
        >
          {/* Header (sticky top). */}
          <div className="sticky top-0 z-30 flex bg-card">
            <GridGutterHeader
              width={GUTTER_WIDTH}
              height={headerHeight}
              onSelectAll={ctrl.selection.selectAll}
            />
            <GridHeaderRow<Row>
              columns={viewColumns}
              widths={widthsRecord}
              sort={ctrl.sort}
              filters={ctrl.filters}
              height={headerHeight}
              onSort={ctrl.cycleSort}
              onSelectColumn={(colKey, opts) =>
                ctrl.selection.selectColumn(colKey, opts)
              }
              onResize={ctrl.resizeColumn}
              onReorder={ctrl.reorderColumn}
              onTogglePin={ctrl.togglePin}
              onFilter={ctrl.setFilter}
            />
          </div>

          {/* Body: a spacer sized to the full virtual height. */}
          <div
            style={{ height: virtual.totalHeight, width: totalGridWidth }}
            className="relative"
          >
            {virtual.virtualRows.map((vr) => {
              const row = viewRows[vr.index];
              if (!row) return null;
              return (
                <GridBodyRow<Row>
                  key={row.id}
                  row={row}
                  rowIndex={vr.index}
                  top={vr.start}
                  height={virtual.rowHeight}
                  columns={viewColumns}
                  widthOf={widthOf}
                  columnOffset={columnOffset}
                  gutterWidth={GUTTER_WIDTH}
                  ctrl={ctrl}
                />
              );
            })}

            {/* Animated selection outline over the body. */}
            <SelectionOutline
              bounds={selectionBounds}
              columnOffset={(ci) => GUTTER_WIDTH + columnOffset(ci)}
              columnWidth={columnWidthAt}
              rowHeight={virtual.rowHeight}
              rowOffset={0}
            />
          </div>

          {/* Ghost quick-add row pinned under the body. */}
          {makeBlankRow ? (
            <button
              type="button"
              onClick={() => {
                const created = ctrl.addBlankRow();
                if (created) {
                  const firstEditable = viewColumns.find((c) =>
                    isColumnEditable(c),
                  );
                  if (firstEditable) {
                    const coord: CellCoord = {
                      rowId: created.id,
                      colKey: firstEditable.key,
                    };
                    ctrl.selection.setActive(coord);
                    ctrl.beginEdit(coord);
                  }
                }
              }}
              style={{ height: virtual.rowHeight, width: totalGridWidth }}
              className="sticky left-0 flex items-center gap-2 border-t border-dashed border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <Plus className="size-3.5" />
              Add row
            </button>
          ) : null}
        </div>
      </div>

      <BulkActionBar
        count={ctrl.selectedRowIds.length}
        onClear={ctrl.selection.clear}
        actions={standardBulkActions({
          onAdjustPrice: () => {
            const col = firstOfType(viewColumns, "currency");
            if (!col) return;
            const input = window.prompt("Adjust price by percent (e.g. 10 or -5):");
            if (input === null) return;
            const percent = Number(input);
            if (!Number.isFinite(percent)) return;
            ctrl.bulkAdjustPrice(col.key, { percent });
          },
          onAddTag: () => {
            const col = firstOfType(viewColumns, "multi-tag");
            if (!col) return;
            const tag = window.prompt("Tag to add:");
            if (!tag) return;
            ctrl.bulkAddTag(col.key, tag);
          },
          onSetStatus: () => {
            const col = firstOfType(viewColumns, "select");
            if (!col || !col.options?.length) return;
            const value = window.prompt(
              `Set ${col.header} to (${col.options.map((o) => o.value).join(", ")}):`,
            );
            if (!value) return;
            const match = col.options.find(
              (o) => o.value === value || o.label === value,
            );
            ctrl.bulkSetField(col.key, match?.value ?? value);
          },
          onDelete: ctrl.bulkDelete,
        })}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Toolbar                                                                   */
/* -------------------------------------------------------------------------- */

interface ToolbarProps<Row extends GridRow> {
  ctrl: ReturnType<typeof useGridController<Row>>;
  density: GridDensity;
  onDensity: (d: GridDensity) => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
}

function GridToolbar<Row extends GridRow>({
  ctrl,
  density,
  onDensity,
  searchOpen,
  onToggleSearch,
}: ToolbarProps<Row>) {
  const [viewsOpen, setViewsOpen] = React.useState(false);
  const [hideOpen, setHideOpen] = React.useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Undo"
          title={ctrl.undoLabel ? `Undo: ${ctrl.undoLabel}` : "Undo"}
          disabled={!ctrl.canUndo}
          onClick={ctrl.undo}
        >
          <Undo2 />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Redo"
          title={ctrl.redoLabel ? `Redo: ${ctrl.redoLabel}` : "Redo"}
          disabled={!ctrl.canRedo}
          onClick={ctrl.redo}
        >
          <Redo2 />
        </Button>
      </div>

      <span className="h-5 w-px bg-border" aria-hidden />

      <Button
        type="button"
        size="sm"
        variant={searchOpen ? "secondary" : "ghost"}
        onClick={onToggleSearch}
      >
        <SearchIcon data-icon="inline-start" />
        Search
      </Button>

      {/* Saved views dropdown */}
      <div className="relative">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setViewsOpen((v) => !v)}
        >
          <Save data-icon="inline-start" />
          Views
          {ctrl.savedViews.length ? (
            <Badge variant="secondary" className="ml-1 tabular-nums">
              {ctrl.savedViews.length}
            </Badge>
          ) : null}
        </Button>
        {viewsOpen ? (
          <ViewsMenu
            ctrl={ctrl}
            onClose={() => setViewsOpen(false)}
          />
        ) : null}
      </div>

      {/* Hide/show columns dropdown */}
      <div className="relative">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setHideOpen((v) => !v)}
        >
          <Eye data-icon="inline-start" />
          Columns
        </Button>
        {hideOpen ? (
          <ColumnsMenu ctrl={ctrl} onClose={() => setHideOpen(false)} />
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <SaveStatusSummary ctrl={ctrl} />
        <GridDensityToggle density={density} onChange={onDensity} />
      </div>
    </div>
  );
}

function ViewsMenu<Row extends GridRow>({
  ctrl,
  onClose,
}: {
  ctrl: ReturnType<typeof useGridController<Row>>;
  onClose: () => void;
}) {
  const ref = useDismiss<HTMLDivElement>(onClose);
  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-40 mt-1 w-60 rounded-lg border border-border bg-popover p-1.5 shadow-lg"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
        onClick={() => {
          const name = window.prompt("Name this view:");
          if (name) ctrl.saveCurrentView(name);
          onClose();
        }}
      >
        <Plus className="size-3.5" />
        Save current view…
      </button>
      {ctrl.savedViews.length ? (
        <div className="my-1 h-px bg-border" />
      ) : null}
      {ctrl.savedViews.map((v) => (
        <div
          key={v.id}
          className={cn(
            "flex items-center gap-1 rounded-md px-1 hover:bg-muted",
            ctrl.activeViewId === v.id && "bg-primary/10",
          )}
        >
          <button
            type="button"
            className="flex-1 truncate px-1 py-1.5 text-left text-sm"
            onClick={() => {
              ctrl.applySavedView(v.id);
              onClose();
            }}
          >
            {v.name}
          </button>
          <button
            type="button"
            aria-label={`Delete view ${v.name}`}
            className="rounded p-1 text-muted-foreground hover:text-destructive"
            onClick={() => ctrl.removeSavedView(v.id)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function ColumnsMenu<Row extends GridRow>({
  ctrl,
  onClose,
}: {
  ctrl: ReturnType<typeof useGridController<Row>>;
  onClose: () => void;
}) {
  const ref = useDismiss<HTMLDivElement>(onClose);
  // Use the full column list (including hidden) so users can restore them.
  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-40 mt-1 max-h-72 w-56 overflow-auto rounded-lg border border-border bg-popover p-1.5 shadow-lg"
    >
      {ctrl.viewColumns
        .concat(
          Array.from(ctrl.columnByKey.values()).filter(
            (c) => !ctrl.viewColumns.some((vc) => vc.key === c.key),
          ),
        )
        .map((col) => {
          const isHidden = ctrl.hidden.has(col.key);
          return (
            <button
              key={col.key}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => ctrl.toggleHidden(col.key)}
            >
              {isHidden ? (
                <EyeOff className="size-3.5 text-muted-foreground" />
              ) : (
                <Eye className="size-3.5 text-primary" />
              )}
              <span className={cn("truncate", isHidden && "text-muted-foreground")}>
                {col.header}
              </span>
            </button>
          );
        })}
    </div>
  );
}

function SaveStatusSummary<Row extends GridRow>({
  ctrl,
}: {
  ctrl: ReturnType<typeof useGridController<Row>>;
}) {
  if (ctrl.hasErrors) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
        <AlertTriangle className="size-3.5" />
        Save error
      </span>
    );
  }
  if (ctrl.isSaving) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Saving…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CheckCircle2 className="size-3.5 text-emerald-500" />
      All changes saved
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Search bar (Ctrl+F)                                                       */
/* -------------------------------------------------------------------------- */

function SearchBar<Row extends GridRow>({
  ctrl,
  onClose,
}: {
  ctrl: ReturnType<typeof useGridController<Row>>;
  onClose: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5">
      <SearchIcon className="size-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={ctrl.search}
        onChange={(e) => ctrl.setSearch(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) ctrl.gotoPrevMatch();
            else ctrl.gotoNextMatch();
          } else if (e.key === "Escape") {
            e.preventDefault();
            ctrl.setSearch("");
            onClose();
          }
        }}
        placeholder="Find in grid…"
        className="h-7 max-w-xs"
      />
      <span className="tabular-nums text-xs text-muted-foreground">
        {ctrl.searchMatches.length
          ? `${ctrl.activeMatchIndex + 1} / ${ctrl.searchMatches.length}`
          : ctrl.search
            ? "No matches"
            : ""}
      </span>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Previous match"
        disabled={!ctrl.searchMatches.length}
        onClick={ctrl.gotoPrevMatch}
      >
        <ChevronRight className="rotate-[-90deg]" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Next match"
        disabled={!ctrl.searchMatches.length}
        onClick={ctrl.gotoNextMatch}
      >
        <ChevronDown />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Close search"
        onClick={() => {
          ctrl.setSearch("");
          onClose();
        }}
      >
        <X />
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Body row                                                                  */
/* -------------------------------------------------------------------------- */

interface BodyRowProps<Row extends GridRow> {
  row: Row;
  rowIndex: number;
  top: number;
  height: number;
  columns: ColumnDef<Row>[];
  widthOf: (col: ColumnDef<Row>) => number;
  columnOffset: (colIndex: number) => number;
  gutterWidth: number;
  ctrl: ReturnType<typeof useGridController<Row>>;
}

const GridBodyRow = React.memo(function GridBodyRow<Row extends GridRow>({
  row,
  rowIndex,
  top,
  height,
  columns,
  widthOf,
  gutterWidth,
  ctrl,
}: BodyRowProps<Row>) {
  const status = ctrl.getRowStatus(row.id);
  const rowSelected = ctrl.selectedRowIds.includes(row.id);

  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 1}
      className="absolute left-0 flex"
      style={{ top, height, transform: "translateZ(0)" }}
    >
      <GridRowGutter
        rowNumber={rowIndex + 1}
        selected={rowSelected}
        height={height}
        width={gutterWidth}
        onSelect={(opts) => ctrl.selection.selectRow(row.id, opts)}
      />

      {columns.map((col) => {
        const coord: CellCoord = { rowId: row.id, colKey: col.key };
        return (
          <GridCell<Row>
            key={col.key}
            coord={coord}
            column={col}
            row={row}
            width={widthOf(col)}
            height={height}
            ctrl={ctrl}
          />
        );
      })}

      {/* Per-row save-status pill + conflict chip. */}
      <RowStatusPill status={status} onRetry={() => ctrl.retryRow(row.id)} />
    </div>
  );
}) as <Row extends GridRow>(props: BodyRowProps<Row>) => React.ReactElement;

/* -------------------------------------------------------------------------- */
/*  Cell                                                                      */
/* -------------------------------------------------------------------------- */

interface CellProps<Row extends GridRow> {
  coord: CellCoord;
  column: ColumnDef<Row>;
  row: Row;
  width: number;
  height: number;
  ctrl: ReturnType<typeof useGridController<Row>>;
}

function GridCell<Row extends GridRow>({
  coord,
  column,
  row,
  width,
  height,
  ctrl,
}: CellProps<Row>) {
  const { Renderer, Editor } = getCellComponents(column.type);
  const editable = isColumnEditable(column);
  const isActive = ctrl.selection.isActive(coord);
  const isSelected = ctrl.selection.isSelected(coord);
  const isEditing =
    ctrl.editing?.rowId === coord.rowId &&
    ctrl.editing?.colKey === coord.colKey;
  const isSearchMatch =
    ctrl.search.trim() !== "" &&
    ctrl.searchMatches.some(
      (m) => m.rowId === coord.rowId && m.colKey === coord.colKey,
    );

  const value = row[column.key as keyof Row];
  const pinned = column.pinned === "left";

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (e.shiftKey) ctrl.selection.extendTo(coord);
      else ctrl.selection.beginDrag(coord);
    },
    [ctrl.selection, coord],
  );

  const onDoubleClick = React.useCallback(() => {
    if (editable) ctrl.beginEdit(coord);
  }, [editable, ctrl, coord]);

  return (
    <div
      role="gridcell"
      data-active={isActive || undefined}
      data-selected={isSelected || undefined}
      onPointerDown={onPointerDown}
      onPointerEnter={(e) => {
        // Drag-select: extend when the primary button is held.
        if (e.buttons === 1) ctrl.selection.extendTo(coord);
      }}
      onDoubleClick={onDoubleClick}
      style={{ width, height }}
      className={cn(
        "relative shrink-0 overflow-hidden border-r border-b border-border/70 text-sm",
        pinned && "sticky z-10 bg-card shadow-[1px_0_0_0_var(--border)]",
        isSelected && !isEditing && "bg-primary/5",
        isSearchMatch && "ring-1 ring-inset ring-amber-400/70",
      )}
    >
      {isEditing && Editor ? (
        <Editor
          value={value}
          column={column as ColumnDef}
          row={row}
          initialInput={ctrl.editSeed}
          actions={ctrl.cellActions}
          onCommit={(next) => ctrl.commitEdit(coord, next)}
          onCancel={ctrl.cancelEdit}
          className="h-full w-full"
        />
      ) : (
        <Renderer
          value={value}
          column={column as ColumnDef}
          row={row}
          actions={ctrl.cellActions}
          className="flex h-full w-full items-center px-2"
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Row status pill                                                           */
/* -------------------------------------------------------------------------- */

const STATUS_META: Record<
  SaveStatus,
  { label: string; className: string } | null
> = {
  idle: null,
  saving: { label: "Saving", className: "text-muted-foreground" },
  saved: { label: "Saved", className: "text-emerald-600" },
  error: { label: "Retry", className: "text-destructive" },
};

function RowStatusPill({
  status,
  onRetry,
}: {
  status: { status: SaveStatus; error?: string; conflict: boolean };
  onRetry: () => void;
}) {
  const meta = STATUS_META[status.status];
  if (!meta && !status.conflict) return null;

  return (
    <div className="pointer-events-none sticky right-1 z-10 ml-auto flex items-center gap-1 self-center pr-1">
      {status.conflict ? (
        <span
          className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
          title="This row changed elsewhere while you were editing"
        >
          <GitBranchPlus className="size-3" />
          Conflict
        </span>
      ) : null}
      {status.status === "error" ? (
        <button
          type="button"
          onClick={onRetry}
          className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
          title={status.error ?? "Save failed — click to retry"}
        >
          <AlertTriangle className="size-3" />
          Retry
        </button>
      ) : status.status === "saving" ? (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
        </span>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Small helpers                                                             */
/* -------------------------------------------------------------------------- */

function firstOfType<Row extends GridRow>(
  columns: ColumnDef<Row>[],
  type: ColumnDef<Row>["type"],
): ColumnDef<Row> | undefined {
  return columns.find((c) => c.type === type);
}

/** Close-on-outside-click / Escape for lightweight popover menus. */
function useDismiss<T extends HTMLElement>(onClose: () => void) {
  const ref = React.useRef<T>(null);
  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return ref;
}

export default DealSheet;
