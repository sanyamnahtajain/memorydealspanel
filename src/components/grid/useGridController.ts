"use client";

/**
 * DealSheet — the shared grid controller.
 *
 * This hook is the single brain wired by BOTH the desktop `DealSheet` and the
 * `MobileCardEditor`. It composes the four builder layers into one coherent,
 * DOM-free (mostly) state machine:
 *
 *   - rows state + optimistic writes           (local `useState` + autosave)
 *   - view (sort / filter / hide / order / pin) (savedViews pure helpers)
 *   - selection                                (useGridSelection)
 *   - autosave + undo/redo                     (engine hooks)
 *   - clipboard / fill / bulk                  (data engines)
 *   - saved views + global search              (savedViews + local search state)
 *
 * It knows nothing about "product": every field comes from the injected
 * `columns: ColumnDef<Row>[]` and `onSave`. The two surface components render
 * from this controller and forward their gestures back into it.
 */

import * as React from "react";
import { toast } from "sonner";

import type {
  CellCoord,
  ColumnDef,
  GridRow,
  OnSave,
  SavedView,
  SortSpec,
} from "./types";
import { isColumnEditable } from "./types";
import { useGridSelection } from "./core/useGridSelection";
import { useAutosave, type RowStatus } from "./engine/useAutosave";
import { useUndoRedo } from "./engine/useUndoRedo";
import { cellRegistry, type CellActions } from "./cells";
import {
  applyPaste,
  parseTSV,
  resolveRange,
  serializeSelectionToTSV,
} from "./data/clipboard";
import { fillDown } from "./data/fill";
import {
  addTag,
  adjustCurrency,
  removeTag,
  setField,
  softDelete,
} from "./data/bulk";
import {
  applyColumnLayout,
  applyFilters,
  applySort,
  deleteView,
  loadViews,
  upsertView,
} from "./data/savedViews";

/* -------------------------------------------------------------------------- */
/*  Public options / result                                                   */
/* -------------------------------------------------------------------------- */

export interface GridControllerOptions<Row extends GridRow> {
  gridId: string;
  rows: Row[];
  columns: ColumnDef<Row>[];
  onSave: OnSave<Row>;
  onOpenImages?: (rowId: string) => void;
  /** Optional column key to group rows by (headers between groups). */
  groupByKey?: keyof Row & string;
  /** Factory for the ghost quick-add row's seed values. */
  makeBlankRow?: () => Row;
}

/** A contiguous group of rows sharing the `groupByKey` value. */
export interface RowGroup<Row extends GridRow> {
  key: string;
  label: string;
  rows: Row[];
}

export interface GridControllerResult<Row extends GridRow> {
  /* data + view ------------------------------------------------------------ */
  /** The raw, unsorted/unfiltered rows (source of truth). */
  allRows: Row[];
  /** Rows after filter + sort (the visible order). */
  viewRows: Row[];
  /** Columns after order + hide (pinned first). */
  viewColumns: ColumnDef<Row>[];
  /** Visible rows grouped by `groupByKey` (single group when unset). */
  groups: RowGroup<Row>[] | null;

  /* selection -------------------------------------------------------------- */
  selection: ReturnType<typeof useGridSelection>;

  /* editing ---------------------------------------------------------------- */
  editing: CellCoord | null;
  editSeed: string | undefined;
  beginEdit: (coord: CellCoord, seed?: string) => void;
  cancelEdit: () => void;
  commitEdit: (coord: CellCoord, next: unknown) => void;
  /** Commit a value to an arbitrary cell (used by mobile field taps). */
  commitCell: (coord: CellCoord, next: unknown) => void;

  /* save state ------------------------------------------------------------- */
  getRowStatus: (rowId: string) => RowStatus;
  isSaving: boolean;
  hasErrors: boolean;
  clearConflict: (rowId: string) => void;
  retryRow: (rowId: string) => void;

  /* undo / redo ------------------------------------------------------------ */
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | undefined;
  redoLabel: string | undefined;

  /* clipboard / fill ------------------------------------------------------- */
  copySelection: () => void;
  cutSelection: () => void;
  pasteFromClipboard: () => void;
  clearSelection: () => void;
  fillDownSelection: () => void;
  fillRightSelection: () => void;

  /* bulk ------------------------------------------------------------------- */
  selectedRowIds: string[];
  /**
   * Bulk ops target `ids` when provided, otherwise the current row selection.
   * The mobile long-press multi-select passes its checked set explicitly (React
   * batching means the shared selection isn't guaranteed fresh mid-gesture).
   */
  bulkAdjustPrice: (
    colKey: string,
    params: { percent?: number; delta?: number },
    ids?: string[],
  ) => void;
  bulkAddTag: (colKey: string, tag: string, ids?: string[]) => void;
  bulkRemoveTag: (colKey: string, tag: string, ids?: string[]) => void;
  bulkSetField: (colKey: string, value: unknown, ids?: string[]) => void;
  bulkDelete: (ids?: string[]) => void;

  /* view controls ---------------------------------------------------------- */
  sort: SortSpec[];
  filters: Record<string, string>;
  hidden: Set<string>;
  columnOrder: string[];
  widths: Record<string, number>;
  cycleSort: (colKey: string, additive: boolean) => void;
  setFilter: (colKey: string, query: string) => void;
  toggleHidden: (colKey: string) => void;
  reorderColumn: (colKey: string, beforeColKey: string | null) => void;
  resizeColumn: (colKey: string, width: number) => void;
  togglePin: (colKey: string) => void;

  /* saved views ------------------------------------------------------------ */
  savedViews: SavedView[];
  activeViewId: string | null;
  saveCurrentView: (name: string) => void;
  applySavedView: (viewId: string) => void;
  removeSavedView: (viewId: string) => void;

  /* search ----------------------------------------------------------------- */
  search: string;
  setSearch: (q: string) => void;
  searchMatches: CellCoord[];
  activeMatchIndex: number;
  gotoNextMatch: () => void;
  gotoPrevMatch: () => void;

  /* ghost quick-add -------------------------------------------------------- */
  addBlankRow: () => Row | null;

  /* injected cell actions -------------------------------------------------- */
  cellActions: CellActions;
  columnByKey: Map<string, ColumnDef<Row>>;
}

/* -------------------------------------------------------------------------- */
/*  Hook                                                                      */
/* -------------------------------------------------------------------------- */

export function useGridController<Row extends GridRow>(
  options: GridControllerOptions<Row>,
): GridControllerResult<Row> {
  const { gridId, columns, onSave, onOpenImages, groupByKey, makeBlankRow } =
    options;

  /* ----------------------------- rows state ----------------------------- */
  const [allRows, setRows] = React.useState<Row[]>(options.rows);

  // Re-seed local rows when the caller swaps the source data set.
  const rowsPropRef = React.useRef(options.rows);
  React.useEffect(() => {
    if (rowsPropRef.current !== options.rows) {
      rowsPropRef.current = options.rows;
      setRows(options.rows);
    }
  }, [options.rows]);

  // A live index for O(1) row lookups by id (rebuilt when rows change).
  const rowById = React.useMemo(() => {
    const map = new Map<string, Row>();
    for (const r of allRows) map.set(r.id, r);
    return map;
  }, [allRows]);
  const rowByIdRef = React.useRef(rowById);
  React.useEffect(() => {
    rowByIdRef.current = rowById;
  }, [rowById]);

  const columnByKey = React.useMemo(() => {
    const map = new Map<string, ColumnDef<Row>>();
    for (const c of columns) map.set(c.key, c);
    return map;
  }, [columns]);

  const applyPatch = React.useCallback(
    (rowId: string, patch: Partial<Row>) => {
      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  const getRow = React.useCallback(
    (rowId: string): Row | undefined => rowByIdRef.current.get(rowId),
    [],
  );

  /* ------------------------------ autosave ------------------------------ */
  const autosave = useAutosave<Row>({
    onSave,
    applyPatch,
    getRow,
    debounceMs: 350,
  });
  const saveRef = React.useRef(autosave.save);
  React.useEffect(() => {
    saveRef.current = autosave.save;
  }, [autosave.save]);

  /* ------------------------------ undo/redo ----------------------------- */
  const undoRedo = useUndoRedo<Row>({
    setRows,
    persist: (rowId, patch) => saveRef.current(rowId, patch),
  });

  /* -------------------------------- view -------------------------------- */
  const [sort, setSort] = React.useState<SortSpec[]>([]);
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = React.useState<string[]>(() =>
    columns.map((c) => c.key),
  );
  const [pins, setPins] = React.useState<Set<string>>(
    () => new Set(columns.filter((c) => c.pinned === "left").map((c) => c.key)),
  );
  const [widths, setWidths] = React.useState<Record<string, number>>({});
  const [search, setSearchState] = React.useState("");

  // Base columns with live pin overrides folded in.
  const pinnedColumns = React.useMemo<ColumnDef<Row>[]>(
    () =>
      columns.map((c) =>
        pins.has(c.key)
          ? { ...c, pinned: "left" as const }
          : c.pinned
            ? { ...c, pinned: undefined }
            : c,
      ),
    [columns, pins],
  );

  // Ordered + visible columns; pinned columns always float to the front.
  const viewColumns = React.useMemo(() => {
    const laid = applyColumnLayout(pinnedColumns, {
      columnOrder,
      hidden: Array.from(hidden),
    });
    const pinnedFirst = [...laid].sort((a, b) => {
      const ap = a.pinned === "left" ? 0 : 1;
      const bp = b.pinned === "left" ? 0 : 1;
      return ap - bp;
    });
    return pinnedFirst;
  }, [pinnedColumns, columnOrder, hidden]);

  // Filtered + sorted rows (the visible order the user navigates).
  const searchFilteredRows = React.useMemo(() => {
    const byFilter = applyFilters(allRows, filters, columns);
    const q = search.trim().toLowerCase();
    if (!q) return byFilter;
    return byFilter.filter((row) =>
      columns.some((col) => matchesSearch(row[col.key], col, q)),
    );
  }, [allRows, filters, columns, search]);

  const viewRows = React.useMemo(
    () => applySort(searchFilteredRows, sort),
    [searchFilteredRows, sort],
  );

  /* ------------------------------ selection ----------------------------- */
  const rowIds = React.useMemo(() => viewRows.map((r) => r.id), [viewRows]);
  const colKeys = React.useMemo(
    () => viewColumns.map((c) => c.key),
    [viewColumns],
  );
  const selection = useGridSelection({ rowIds, colKeys });

  /* ------------------------------- editing ------------------------------ */
  const [editing, setEditing] = React.useState<CellCoord | null>(null);
  const [editSeed, setEditSeed] = React.useState<string | undefined>(undefined);

  const beginEdit = React.useCallback(
    (coord: CellCoord, seed?: string) => {
      const col = columnByKey.get(coord.colKey);
      if (!col || !isColumnEditable(col)) return;
      setEditing(coord);
      setEditSeed(seed);
    },
    [columnByKey],
  );

  const cancelEdit = React.useCallback(() => {
    setEditing(null);
    setEditSeed(undefined);
  }, []);

  const commitCell = React.useCallback(
    (coord: CellCoord, next: unknown) => {
      const row = rowByIdRef.current.get(coord.rowId);
      if (!row) return;
      const prev = row[coord.colKey as keyof Row];
      if (valuesEqual(prev, next)) return;
      undoRedo.recordEdit(coord, prev, next);
      saveRef.current(coord.rowId, { [coord.colKey]: next } as Partial<Row>);
    },
    [undoRedo],
  );

  const commitEdit = React.useCallback(
    (coord: CellCoord, next: unknown) => {
      commitCell(coord, next);
      setEditing(null);
      setEditSeed(undefined);
    },
    [commitCell],
  );

  /* ------------------------------ clipboard ----------------------------- */
  const copySelection = React.useCallback(() => {
    const range = selection.range;
    if (!range) return;
    const tsv = serializeSelectionToTSV(viewRows, range, viewColumns);
    void writeClipboard(tsv);
    toast.success("Copied to clipboard");
  }, [selection.range, viewRows, viewColumns]);

  const clearSelection = React.useCallback(() => {
    const coords = selection.selectedCoords();
    if (coords.length === 0) return;
    const changes = [];
    for (const coord of coords) {
      const col = columnByKey.get(coord.colKey);
      if (!col || !isColumnEditable(col)) continue;
      const row = rowByIdRef.current.get(coord.rowId);
      if (!row) continue;
      const prev = row[coord.colKey as keyof Row];
      const next = emptyValueFor(col);
      if (valuesEqual(prev, next)) continue;
      changes.push({ coord, prev, next });
    }
    if (changes.length === 0) return;
    undoRedo.recordBulk(`Clear ${changes.length} cells`, changes);
    for (const c of changes) {
      saveRef.current(c.coord.rowId, {
        [c.coord.colKey]: c.next,
      } as Partial<Row>);
    }
  }, [selection, columnByKey, undoRedo]);

  const cutSelection = React.useCallback(() => {
    copySelection();
    clearSelection();
  }, [copySelection, clearSelection]);

  const pasteFromClipboard = React.useCallback(() => {
    const anchor = selection.activeCoord;
    if (!anchor) return;
    void readClipboard().then((text) => {
      if (!text) return;
      const block = parseTSV(text);
      const result = applyPaste(viewRows, anchor, block, viewColumns);
      if (!result.command) {
        if (result.overflow.extraRows > 0) {
          toast.info(
            `${result.overflow.extraRows} pasted row(s) fell outside the grid`,
          );
        }
        if (result.skipped.length > 0) {
          toast.warning(`${result.skipped.length} cell(s) skipped`);
        }
        return;
      }
      undoRedo.recordPaste(result.command.anchor, result.command.changes);
      persistChanges(result.command.changes, saveRef.current);
      if (result.skipped.length > 0) {
        toast.warning(`${result.skipped.length} cell(s) skipped`);
      }
      toast.success(`Pasted ${result.command.changes.length} cells`);
    });
  }, [selection.activeCoord, viewRows, viewColumns, undoRedo]);

  /* -------------------------------- fill -------------------------------- */
  const fillDownSelection = React.useCallback(() => {
    const range = selection.range;
    if (!range) return;
    const result = fillDown(viewRows, range, viewColumns);
    if (!result.command) return;
    undoRedo.recordFill(
      result.command.source,
      result.command.target,
      result.command.changes,
    );
    persistChanges(result.command.changes, saveRef.current);
  }, [selection.range, viewRows, viewColumns, undoRedo]);

  const fillRightSelection = React.useCallback(() => {
    // Fill-right seeds the leftmost column of the selection across each row.
    const range = selection.range;
    if (!range) return;
    const bounds = resolveRange(
      range,
      viewRows,
      viewColumns as import("./types").ColumnDef[],
    );
    if (!bounds || bounds.left === bounds.right) return;

    const changes = [];
    for (let r = bounds.top; r <= bounds.bottom; r++) {
      const row = viewRows[r];
      const seedCol = viewColumns[bounds.left];
      const seed = row[seedCol.key];
      for (let c = bounds.left + 1; c <= bounds.right; c++) {
        const col = viewColumns[c];
        if (!isColumnEditable(col)) continue;
        const prev = row[col.key];
        if (valuesEqual(prev, seed)) continue;
        changes.push({
          coord: { rowId: row.id, colKey: col.key },
          prev,
          next: seed,
        });
      }
    }
    if (changes.length === 0) return;
    undoRedo.recordBulk(`Fill ${changes.length} cells`, changes);
    persistChanges(changes, saveRef.current);
  }, [selection.range, viewRows, viewColumns, undoRedo]);

  /* -------------------------------- bulk -------------------------------- */
  const selectedRowIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const coord of selection.selectedCoords()) ids.add(coord.rowId);
    return Array.from(ids);
  }, [selection]);

  const runBulk = React.useCallback(
    (result: {
      command: { label: string; changes: import("./types").CellChange[] } | null;
    }) => {
      if (!result.command) return;
      undoRedo.recordBulk(result.command.label, result.command.changes);
      persistChanges(result.command.changes, saveRef.current);
      toast.success(`${result.command.label} (${result.command.changes.length})`);
    },
    [undoRedo],
  );

  const selectedRowIdsRef = React.useRef(selectedRowIds);
  React.useEffect(() => {
    selectedRowIdsRef.current = selectedRowIds;
  }, [selectedRowIds]);
  const targetIds = React.useCallback(
    (ids?: string[]) => ids ?? selectedRowIdsRef.current,
    [],
  );

  const bulkAdjustPrice = React.useCallback(
    (colKey: string, params: { percent?: number; delta?: number }, ids?: string[]) => {
      runBulk(
        adjustCurrency(allRows, targetIds(ids), colKey as keyof Row & string, params),
      );
    },
    [allRows, targetIds, runBulk],
  );

  const bulkAddTag = React.useCallback(
    (colKey: string, tag: string, ids?: string[]) => {
      runBulk(addTag(allRows, targetIds(ids), colKey as keyof Row & string, tag));
    },
    [allRows, targetIds, runBulk],
  );

  const bulkRemoveTag = React.useCallback(
    (colKey: string, tag: string, ids?: string[]) => {
      runBulk(
        removeTag(allRows, targetIds(ids), colKey as keyof Row & string, tag),
      );
    },
    [allRows, targetIds, runBulk],
  );

  const bulkSetField = React.useCallback(
    (colKey: string, value: unknown, ids?: string[]) => {
      runBulk(
        setField(allRows, targetIds(ids), colKey as keyof Row & string, value),
      );
    },
    [allRows, targetIds, runBulk],
  );

  const bulkDelete = React.useCallback(
    (ids?: string[]) => {
      runBulk(softDelete(allRows, targetIds(ids)));
      selection.clear();
    },
    [allRows, targetIds, runBulk, selection],
  );

  /* ---------------------------- view controls --------------------------- */
  const [activeViewId, setActiveViewId] = React.useState<string | null>(null);

  const cycleSort = React.useCallback((colKey: string, additive: boolean) => {
    setActiveViewId(null);
    setSort((prev) => {
      const existing = prev.find((s) => s.colKey === colKey);
      const rest = additive ? prev.filter((s) => s.colKey !== colKey) : [];
      if (!existing) return [...rest, { colKey, dir: "asc" }];
      if (existing.dir === "asc")
        return [...rest, { colKey, dir: "desc" }];
      return rest; // desc → none
    });
  }, []);

  const setFilter = React.useCallback((colKey: string, query: string) => {
    setActiveViewId(null);
    setFilters((prev) => {
      const next = { ...prev };
      if (query.trim() === "") delete next[colKey];
      else next[colKey] = query;
      return next;
    });
  }, []);

  const toggleHidden = React.useCallback((colKey: string) => {
    setActiveViewId(null);
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(colKey)) next.delete(colKey);
      else next.add(colKey);
      return next;
    });
  }, []);

  const reorderColumn = React.useCallback(
    (colKey: string, beforeColKey: string | null) => {
      setActiveViewId(null);
      setColumnOrder((prev) => {
        const base = prev.length ? prev.slice() : columns.map((c) => c.key);
        const from = base.indexOf(colKey);
        if (from < 0) return base;
        base.splice(from, 1);
        if (beforeColKey === null) {
          base.push(colKey);
        } else {
          const to = base.indexOf(beforeColKey);
          base.splice(to < 0 ? base.length : to, 0, colKey);
        }
        return base;
      });
    },
    [columns],
  );

  const resizeColumn = React.useCallback((colKey: string, width: number) => {
    setWidths((prev) => ({ ...prev, [colKey]: width }));
  }, []);

  const togglePin = React.useCallback((colKey: string) => {
    setActiveViewId(null);
    setPins((prev) => {
      const next = new Set(prev);
      if (next.has(colKey)) next.delete(colKey);
      else next.add(colKey);
      return next;
    });
  }, []);

  /* ----------------------------- saved views ---------------------------- */
  // Lazy-initialized from localStorage on mount. `gridId` is a stable identity
  // for a grid instance; to switch grids, remount with a different React `key`.
  const [savedViews, setSavedViews] = React.useState<SavedView[]>(() =>
    loadViews(gridId),
  );

  const saveCurrentView = React.useCallback(
    (name: string) => {
      const view: SavedView = {
        id: `view_${Date.now().toString(36)}`,
        name,
        filters: { ...filters },
        sort: sort.map((s) => ({ ...s })),
        hidden: Array.from(hidden),
        columnOrder: columnOrder.slice(),
      };
      const next = upsertView(gridId, view);
      setSavedViews(next);
      setActiveViewId(view.id);
      toast.success(`Saved view "${name}"`);
    },
    [gridId, filters, sort, hidden, columnOrder],
  );

  const applySavedView = React.useCallback(
    (viewId: string) => {
      const view = savedViews.find((v) => v.id === viewId);
      if (!view) return;
      setFilters({ ...view.filters });
      setSort(view.sort.map((s) => ({ ...s })));
      setHidden(new Set(view.hidden));
      if (view.columnOrder.length) setColumnOrder(view.columnOrder.slice());
      setActiveViewId(viewId);
    },
    [savedViews],
  );

  const removeSavedView = React.useCallback(
    (viewId: string) => {
      const next = deleteView(gridId, viewId);
      setSavedViews(next);
      if (activeViewId === viewId) setActiveViewId(null);
    },
    [gridId, activeViewId],
  );

  /* ------------------------------- search ------------------------------- */
  const [activeMatchIndex, setActiveMatchIndex] = React.useState(0);
  const setSearch = React.useCallback((q: string) => {
    setSearchState(q);
    setActiveMatchIndex(0); // restart cycling whenever the query changes
  }, []);

  const searchMatches = React.useMemo<CellCoord[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const out: CellCoord[] = [];
    for (const row of viewRows) {
      for (const col of viewColumns) {
        if (matchesSearch(row[col.key], col, q)) {
          out.push({ rowId: row.id, colKey: col.key });
        }
      }
    }
    return out;
  }, [search, viewRows, viewColumns]);

  const gotoMatch = React.useCallback(
    (index: number) => {
      if (searchMatches.length === 0) return;
      const wrapped =
        ((index % searchMatches.length) + searchMatches.length) %
        searchMatches.length;
      setActiveMatchIndex(wrapped);
      selection.setActive(searchMatches[wrapped]);
    },
    [searchMatches, selection],
  );

  const gotoNextMatch = React.useCallback(
    () => gotoMatch(activeMatchIndex + 1),
    [gotoMatch, activeMatchIndex],
  );
  const gotoPrevMatch = React.useCallback(
    () => gotoMatch(activeMatchIndex - 1),
    [gotoMatch, activeMatchIndex],
  );

  /* --------------------------- ghost quick-add -------------------------- */
  const addBlankRow = React.useCallback((): Row | null => {
    const blank = makeBlankRow?.();
    if (!blank) return null;
    setRows((prev) => [...prev, blank]);
    // Persist the new row so the backend learns about it.
    saveRef.current(blank.id, blank as Partial<Row>);
    return blank;
  }, [makeBlankRow]);

  /* ---------------------------- retry / status -------------------------- */
  const retryRow = React.useCallback(
    (rowId: string) => {
      const row = rowByIdRef.current.get(rowId);
      if (!row) return;
      // Re-issue a save of the full row to recover from a failed persist.
      saveRef.current(rowId, row as Partial<Row>);
    },
    [],
  );

  /* ------------------------------ grouping ------------------------------ */
  const groups = React.useMemo<RowGroup<Row>[] | null>(() => {
    if (!groupByKey) return null;
    const col = columnByKey.get(groupByKey);
    const out: RowGroup<Row>[] = [];
    let current: RowGroup<Row> | null = null;
    for (const row of viewRows) {
      const raw = row[groupByKey];
      const key = raw === null || raw === undefined ? "" : String(raw);
      const label = groupLabel(raw, col);
      if (!current || current.key !== key) {
        current = { key, label, rows: [] };
        out.push(current);
      }
      current.rows.push(row);
    }
    return out;
  }, [groupByKey, viewRows, columnByKey]);

  /* --------------------------- cell actions ----------------------------- */
  const cellActions = React.useMemo<CellActions>(
    () => ({ onOpenImages }),
    [onOpenImages],
  );

  return {
    allRows,
    viewRows,
    viewColumns,
    groups,
    selection,
    editing,
    editSeed,
    beginEdit,
    cancelEdit,
    commitEdit,
    commitCell,
    getRowStatus: autosave.getRowStatus,
    isSaving: autosave.isSaving,
    hasErrors: autosave.hasErrors,
    clearConflict: autosave.clearConflict,
    retryRow,
    undo: undoRedo.undo,
    redo: undoRedo.redo,
    canUndo: undoRedo.canUndo,
    canRedo: undoRedo.canRedo,
    undoLabel: undoRedo.undoLabel,
    redoLabel: undoRedo.redoLabel,
    copySelection,
    cutSelection,
    pasteFromClipboard,
    clearSelection,
    fillDownSelection,
    fillRightSelection,
    selectedRowIds,
    bulkAdjustPrice,
    bulkAddTag,
    bulkRemoveTag,
    bulkSetField,
    bulkDelete,
    sort,
    filters,
    hidden,
    columnOrder,
    widths,
    cycleSort,
    setFilter,
    toggleHidden,
    reorderColumn,
    resizeColumn,
    togglePin,
    savedViews,
    activeViewId,
    saveCurrentView,
    applySavedView,
    removeSavedView,
    search,
    setSearch,
    searchMatches,
    activeMatchIndex,
    gotoNextMatch,
    gotoPrevMatch,
    addBlankRow,
    cellActions,
    columnByKey,
  };
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function persistChanges<Row extends GridRow>(
  changes: import("./types").CellChange[],
  save: (rowId: string, patch: Partial<Row>) => void,
): void {
  const byRow = new Map<string, Record<string, unknown>>();
  for (const change of changes) {
    const { rowId, colKey } = change.coord;
    let patch = byRow.get(rowId);
    if (!patch) {
      patch = {};
      byRow.set(rowId, patch);
    }
    patch[colKey] = change.next;
  }
  for (const [rowId, patch] of byRow) {
    save(rowId, patch as Partial<Row>);
  }
}

function matchesSearch<Row extends GridRow>(
  value: unknown,
  col: ColumnDef<Row>,
  q: string,
): boolean {
  if (value === null || value === undefined) return false;
  let text: string;
  if (col.format) {
    try {
      text = col.format(value);
    } catch {
      text = defaultText(value);
    }
  } else {
    text = defaultText(value);
  }
  return text.toLowerCase().includes(q);
}

function defaultText(value: unknown): string {
  if (Array.isArray(value)) return value.join(" ");
  return String(value);
}

function groupLabel<Row extends GridRow>(
  raw: unknown,
  col?: ColumnDef<Row>,
): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  const opt = col?.options?.find((o) => o.value === raw);
  if (opt) return opt.label;
  if (col?.format) {
    try {
      return col.format(raw);
    } catch {
      /* fall through */
    }
  }
  return String(raw);
}

/** A sensible "empty" value for a column when clearing cells. */
function emptyValueFor<Row extends GridRow>(col: ColumnDef<Row>): unknown {
  switch (col.type) {
    case "multi-tag":
      return [];
    case "toggle":
      return false;
    case "number":
    case "currency":
    case "percent":
      return null;
    default:
      return "";
  }
}

/** Structural equality treating arrays by content (multi-tag). */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/*  Clipboard IO (guarded for SSR / permissions)                             */
/* -------------------------------------------------------------------------- */

async function writeClipboard(text: string): Promise<void> {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard?.writeText
    ) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through to legacy path */
  }
  legacyCopy(text);
}

function legacyCopy(text: string): void {
  if (typeof document === "undefined") return;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    /* ignore */
  }
  document.body.removeChild(ta);
}

async function readClipboard(): Promise<string> {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard?.readText
    ) {
      return await navigator.clipboard.readText();
    }
  } catch {
    /* permissions denied / unsupported */
  }
  return "";
}

// Keep the cell registry reachable from the controller module for callers that
// resolve renderers/editors off the same import surface.
export { cellRegistry };
