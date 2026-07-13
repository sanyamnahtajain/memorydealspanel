"use client";

/**
 * MobileCardEditor — the touch-first surface for the DealSheet grid.
 *
 * Same props and same {@link useGridController} brain as the desktop
 * `DealSheet`, re-projected as a scrollable list of editable cards. Each row is
 * a card; tapping a field opens the SAME typed cell `Editor` inline. Long-press
 * enters multi-select mode (checkbox per card) and surfaces the shared
 * `BulkActionBar` at the bottom. Autosave, undo/redo and conflict handling are
 * identical — this is a different *view*, not a different engine.
 */

import * as React from "react";
import {
  Undo2,
  Redo2,
  Search as SearchIcon,
  X,
  Plus,
  Loader2,
  AlertTriangle,
  GitBranchPlus,
  CheckCircle2,
  Check,
  ListChecks,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { usePromptDialog } from "@/components/ui/prompt-dialog";

import type { CellCoord, ColumnDef, GridRow, SaveStatus } from "./types";
import { isColumnEditable } from "./types";
import { getCellComponents } from "./cells";
import { BulkActionBar, standardBulkActions } from "./data/BulkActionBar";
import { useGridController } from "./useGridController";
import type { DealSheetProps } from "./DealSheet";

/** Mobile editor shares the exact public contract of the desktop grid. */
export type MobileCardEditorProps<Row extends GridRow = GridRow> =
  DealSheetProps<Row>;

const LONG_PRESS_MS = 450;

export function MobileCardEditor<Row extends GridRow = GridRow>({
  gridId,
  rows,
  columns,
  onSave,
  onOpenImages,
  groupByKey,
  makeBlankRow,
  className,
}: MobileCardEditorProps<Row>) {
  const ctrl = useGridController<Row>({
    gridId,
    rows,
    columns,
    onSave,
    onOpenImages,
    groupByKey,
    makeBlankRow,
  });

  const [multiSelect, setMultiSelect] = React.useState(false);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = React.useState(false);
  const { prompt, element: promptElement } = usePromptDialog();

  const { viewRows, viewColumns, groups } = ctrl;

  const toggleChecked = React.useCallback((rowId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  const enterMultiSelect = React.useCallback((rowId: string) => {
    setMultiSelect(true);
    setChecked(new Set([rowId]));
  }, []);

  const exitMultiSelect = React.useCallback(() => {
    setMultiSelect(false);
    setChecked(new Set());
  }, []);

  const checkedIds = React.useMemo(() => Array.from(checked), [checked]);

  /** Ids currently visible after search/filter — the scope of "select all". */
  const visibleIds = React.useMemo(
    () => viewRows.map((r) => r.id),
    [viewRows],
  );
  const allVisibleChecked =
    visibleIds.length > 0 && visibleIds.every((id) => checked.has(id));

  /** Enter selection mode with nothing checked (the discoverable entry point). */
  const startSelecting = React.useCallback(() => {
    setMultiSelect(true);
    setChecked(new Set());
  }, []);

  /** Toggle every visible card on/off in one tap. */
  const toggleSelectAll = React.useCallback(() => {
    setChecked(allVisibleChecked ? new Set() : new Set(visibleIds));
  }, [allVisibleChecked, visibleIds]);

  const renderCard = (row: Row) => (
    <MobileCard<Row>
      key={row.id}
      row={row}
      columns={viewColumns}
      ctrl={ctrl}
      multiSelect={multiSelect}
      checked={checked.has(row.id)}
      onToggleChecked={() => toggleChecked(row.id)}
      onLongPress={() => enterMultiSelect(row.id)}
    />
  );

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col", className)}>
      {/* Top bar */}
      <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2 py-1.5">
        {multiSelect ? (
          <>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Exit selection"
              onClick={exitMultiSelect}
            >
              <X />
            </Button>
            <span className="text-sm font-medium tabular-nums">
              {checkedIds.length} selected
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={toggleSelectAll}
              disabled={visibleIds.length === 0}
            >
              {allVisibleChecked ? "Clear all" : "Select all"}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Undo"
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
              disabled={!ctrl.canRedo}
              onClick={ctrl.redo}
            >
              <Redo2 />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant={searchOpen ? "secondary" : "ghost"}
              aria-label="Search"
              onClick={() => setSearchOpen((v) => !v)}
            >
              <SearchIcon />
            </Button>
            {/* Discoverable entry to multi-select — no long-press needed. */}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={startSelecting}
            >
              <ListChecks data-icon="inline-start" />
              Select
            </Button>
            <MobileSaveStatus ctrl={ctrl} />
          </>
        )}
      </div>

      {searchOpen && !multiSelect ? (
        <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
          <SearchIcon className="size-4 text-muted-foreground" />
          <Input
            value={ctrl.search}
            onChange={(e) => ctrl.setSearch(e.target.value)}
            placeholder="Find…"
            className="h-8"
            autoFocus
          />
          {ctrl.search ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Clear search"
              onClick={() => ctrl.setSearch("")}
            >
              <X />
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Card list */}
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2 pb-24">
        {groups
          ? groups.map((g) => (
              <section key={g.key} className="space-y-2">
                <h3 className="sticky top-0 z-10 -mx-2 bg-background/90 px-3 py-1 text-xs font-semibold text-muted-foreground backdrop-blur">
                  {g.label}
                  <span className="ml-1 tabular-nums opacity-60">
                    ({g.rows.length})
                  </span>
                </h3>
                {g.rows.map(renderCard)}
              </section>
            ))
          : viewRows.map(renderCard)}

        {viewRows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No rows.
          </p>
        ) : null}

        {makeBlankRow && !multiSelect ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => ctrl.addBlankRow()}
          >
            <Plus data-icon="inline-start" />
            Add row
          </Button>
        ) : null}
      </div>

      {/* Bulk bar (mobile multi-select) */}
      <BulkActionBar
        count={multiSelect ? checkedIds.length : 0}
        onClear={exitMultiSelect}
        actions={standardBulkActions({
          onAdjustPrice: async () => {
            const col = viewColumns.find((c) => c.type === "currency");
            if (!col) return;
            const input = await prompt({
              title: "Adjust price",
              description: "Change every selected price by a percentage.",
              label: "Percent change",
              kind: "number",
              placeholder: "e.g. 10 or -5",
              validate: (v) =>
                v.trim() === "" || !Number.isFinite(Number(v))
                  ? "Enter a number, e.g. 10 or -5."
                  : null,
            });
            if (input === null) return;
            const percent = Number(input);
            if (Number.isFinite(percent)) {
              ctrl.bulkAdjustPrice(col.key, { percent }, checkedIds);
            }
          },
          onAddTag: async () => {
            const col = viewColumns.find((c) => c.type === "multi-tag");
            if (!col) return;
            const tag = await prompt({
              title: "Add tag",
              label: "Tag to add",
              kind: "text",
              placeholder: "Tag name",
              validate: (v) => (v.trim() === "" ? "Enter a tag." : null),
            });
            if (tag) ctrl.bulkAddTag(col.key, tag, checkedIds);
          },
          onActivate: () => {
            const col = viewColumns.find((c) => c.type === "toggle");
            if (col) ctrl.bulkSetField(col.key, true, checkedIds);
          },
          onDeactivate: () => {
            const col = viewColumns.find((c) => c.type === "toggle");
            if (col) ctrl.bulkSetField(col.key, false, checkedIds);
          },
          onDelete: () => {
            ctrl.bulkDelete(checkedIds);
            exitMultiSelect();
          },
        })}
      />

      {promptElement}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Card                                                                      */
/* -------------------------------------------------------------------------- */

interface CardProps<Row extends GridRow> {
  row: Row;
  columns: ColumnDef<Row>[];
  ctrl: ReturnType<typeof useGridController<Row>>;
  multiSelect: boolean;
  checked: boolean;
  onToggleChecked: () => void;
  onLongPress: () => void;
}

function MobileCard<Row extends GridRow>({
  row,
  columns,
  ctrl,
  multiSelect,
  checked,
  onToggleChecked,
  onLongPress,
}: CardProps<Row>) {
  const status = ctrl.getRowStatus(row.id);
  const pressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPress = React.useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const onPointerDown = React.useCallback(() => {
    clearPress();
    pressTimer.current = setTimeout(onLongPress, LONG_PRESS_MS);
  }, [clearPress, onLongPress]);

  React.useEffect(() => clearPress, [clearPress]);

  // Prefer the first text-ish column as the card title.
  const titleCol = columns[0];
  const bodyCols = columns.slice(1);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerUp={clearPress}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
      // In selection mode the whole card is one big tap target so it's easy to
      // pick rows on a phone; the fields are disabled so no edit fires.
      onClick={multiSelect ? onToggleChecked : undefined}
      className={cn(
        "rounded-xl border border-border bg-card p-3 shadow-sm transition-colors",
        multiSelect && "cursor-pointer",
        checked && "ring-2 ring-primary",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        {multiSelect ? (
          <button
            type="button"
            aria-label={checked ? "Deselect row" : "Select row"}
            aria-pressed={checked}
            onClick={(e) => {
              e.stopPropagation();
              onToggleChecked();
            }}
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-md border",
              checked
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border",
            )}
          >
            {checked ? <Check className="size-3.5" /> : null}
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <MobileField<Row>
            row={row}
            column={titleCol}
            ctrl={ctrl}
            emphasize
            disabled={multiSelect}
          />
        </div>
        <CardStatus status={status} onRetry={() => ctrl.retryRow(row.id)} />
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        {bodyCols.map((col) => (
          <div key={col.key} className="min-w-0">
            <dt className="mb-0.5 truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {col.header}
            </dt>
            <dd className="min-w-0">
              <MobileField<Row>
                row={row}
                column={col}
                ctrl={ctrl}
                disabled={multiSelect}
              />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Field (tap-to-edit)                                                       */
/* -------------------------------------------------------------------------- */

interface FieldProps<Row extends GridRow> {
  row: Row;
  column: ColumnDef<Row>;
  ctrl: ReturnType<typeof useGridController<Row>>;
  emphasize?: boolean;
  disabled?: boolean;
}

function MobileField<Row extends GridRow>({
  row,
  column,
  ctrl,
  emphasize,
  disabled,
}: FieldProps<Row>) {
  const coord: CellCoord = { rowId: row.id, colKey: column.key };
  const { Renderer, Editor } = getCellComponents(column.type);
  const editable = isColumnEditable(column);
  const value = row[column.key as keyof Row];

  const isEditing =
    ctrl.editing?.rowId === coord.rowId &&
    ctrl.editing?.colKey === coord.colKey;

  if (isEditing && Editor) {
    return (
      <div className="rounded-md ring-2 ring-primary">
        <Editor
          value={value}
          column={column as ColumnDef}
          row={row}
          actions={ctrl.cellActions}
          onCommit={(next) => ctrl.commitEdit(coord, next)}
          onCancel={ctrl.cancelEdit}
          className="w-full"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled || !editable}
      onClick={() => {
        if (!disabled && editable) ctrl.beginEdit(coord);
      }}
      className={cn(
        "block w-full rounded-md text-left transition-colors",
        editable && !disabled && "hover:bg-muted/60 active:bg-muted",
        emphasize ? "text-base font-semibold" : "text-sm",
      )}
    >
      <Renderer
        value={value}
        column={column as ColumnDef}
        row={row}
        actions={ctrl.cellActions}
        className="flex min-h-[1.75rem] w-full items-center truncate px-1"
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Status bits                                                               */
/* -------------------------------------------------------------------------- */

function MobileSaveStatus<Row extends GridRow>({
  ctrl,
}: {
  ctrl: ReturnType<typeof useGridController<Row>>;
}) {
  if (ctrl.hasErrors)
    return (
      <span className="inline-flex items-center gap-1 pr-1 text-xs text-destructive">
        <AlertTriangle className="size-3.5" />
        Error
      </span>
    );
  if (ctrl.isSaving)
    return (
      <span className="inline-flex items-center gap-1 pr-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Saving
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 pr-1 text-xs text-muted-foreground">
      <CheckCircle2 className="size-3.5 text-success" />
      Saved
    </span>
  );
}

function CardStatus({
  status,
  onRetry,
}: {
  status: { status: SaveStatus; error?: string; conflict: boolean };
  onRetry: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {status.conflict ? (
        <Tooltip content="Changed elsewhere">
          <span
            aria-label="Changed elsewhere"
            className="inline-flex items-center gap-0.5 rounded-full border border-warning/60 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
          >
            <GitBranchPlus className="size-3" />
          </span>
        </Tooltip>
      ) : null}
      {status.status === "error" ? (
        <Tooltip content={status.error ?? "Retry"}>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-0.5 rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
          >
            <AlertTriangle className="size-3" />
            Retry
          </button>
        </Tooltip>
      ) : status.status === "saving" ? (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
      ) : null}
    </div>
  );
}

export default MobileCardEditor;
