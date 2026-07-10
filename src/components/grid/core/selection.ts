/**
 * Pure selection model for the DealSheet grid.
 *
 * This module contains **no DOM and no React** — it is a plain reducer over a
 * `SelectionState` plus geometry helpers. That keeps the selection logic fully
 * unit-testable (see `selection.test.ts`) and lets the React hook
 * (`useGridSelection`) be a thin `useReducer` wrapper.
 *
 * The grid addresses cells by `{ rowId, colKey }` (see `../types`). Because
 * rows can be sorted/filtered/reordered, the reducer is driven by an **index
 * space**: the caller supplies the ordered arrays of visible `rowIds` and
 * `colKeys`, and the reducer resolves coordinates ⇄ indices against them. This
 * means arrow navigation and rectangular ranges always follow the *visual*
 * order the user sees, not insertion order.
 */

import type { CellCoord, CellRange } from "../types";

/* -------------------------------------------------------------------------- */
/*  Geometry                                                                  */
/* -------------------------------------------------------------------------- */

/** A cell position in the visible index space (0-based row / column indices). */
export interface CellIndex {
  row: number;
  col: number;
}

/** The visible grid geometry: ordered row ids and column keys. */
export interface GridAxes {
  rowIds: readonly string[];
  colKeys: readonly string[];
}

/** Directions arrow-navigation / range-extension can move. */
export type MoveDir = "up" | "down" | "left" | "right";

/** How far a single navigation step travels. */
export type MoveStep =
  | "cell" // one cell (arrow keys)
  | "edge"; // to the far edge of the axis (Ctrl+Arrow / Home / End rows)

/**
 * A resolved rectangular selection in index space, with normalized bounds so
 * `minRow <= maxRow` and `minCol <= maxCol` regardless of drag direction.
 */
export interface SelectionBounds {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

/* -------------------------------------------------------------------------- */
/*  State                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Selection state. `active` is the focused cell (the anchor for keyboard nav
 * and the cell that receives edits). `anchor` is the fixed corner of a
 * rectangular range; `active` is the moving corner. When `anchor` is null the
 * selection is a single cell (`active`).
 *
 * `fullRows` / `fullCols` mark entire rows/columns selected via the gutter or
 * a header click; they compose with the rectangular range for "select all".
 */
export interface SelectionState {
  active: CellIndex | null;
  anchor: CellIndex | null;
  /** Whole-row selections, by row index. */
  fullRows: ReadonlySet<number>;
  /** Whole-column selections, by column index. */
  fullCols: ReadonlySet<number>;
  /** True when everything is selected (Ctrl+A). */
  all: boolean;
}

/** The empty selection. */
export const EMPTY_SELECTION: SelectionState = {
  active: null,
  anchor: null,
  fullRows: new Set(),
  fullCols: new Set(),
  all: false,
};

/* -------------------------------------------------------------------------- */
/*  Coordinate ⇄ index helpers                                                */
/* -------------------------------------------------------------------------- */

/** Resolve a `CellCoord` to a `CellIndex`, or `null` if it isn't visible. */
export function coordToIndex(
  coord: CellCoord,
  axes: GridAxes,
): CellIndex | null {
  const row = axes.rowIds.indexOf(coord.rowId);
  const col = axes.colKeys.indexOf(coord.colKey);
  if (row < 0 || col < 0) return null;
  return { row, col };
}

/** Resolve a `CellIndex` back to a `CellCoord`, or `null` if out of range. */
export function indexToCoord(
  index: CellIndex,
  axes: GridAxes,
): CellCoord | null {
  const rowId = axes.rowIds[index.row];
  const colKey = axes.colKeys[index.col];
  if (rowId === undefined || colKey === undefined) return null;
  return { rowId, colKey };
}

/** Clamp an index into the valid grid range. */
export function clampIndex(index: CellIndex, axes: GridAxes): CellIndex {
  const maxRow = Math.max(0, axes.rowIds.length - 1);
  const maxCol = Math.max(0, axes.colKeys.length - 1);
  return {
    row: Math.min(Math.max(index.row, 0), maxRow),
    col: Math.min(Math.max(index.col, 0), maxCol),
  };
}

function sameIndex(a: CellIndex | null, b: CellIndex | null): boolean {
  if (a === null || b === null) return a === b;
  return a.row === b.row && a.col === b.col;
}

/* -------------------------------------------------------------------------- */
/*  Bounds & membership                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Compute the normalized rectangular bounds of the current selection, in index
 * space, or `null` when there is no active cell. Full-row/full-col selections
 * and "select all" widen the bounds to span the whole axis.
 */
export function selectionBounds(
  state: SelectionState,
  axes: GridAxes,
): SelectionBounds | null {
  const lastRow = Math.max(0, axes.rowIds.length - 1);
  const lastCol = Math.max(0, axes.colKeys.length - 1);

  if (state.all) {
    if (axes.rowIds.length === 0 || axes.colKeys.length === 0) return null;
    return { minRow: 0, maxRow: lastRow, minCol: 0, maxCol: lastCol };
  }

  let bounds: SelectionBounds | null = null;

  const widen = (b: SelectionBounds) => {
    bounds = bounds
      ? {
          minRow: Math.min(bounds.minRow, b.minRow),
          maxRow: Math.max(bounds.maxRow, b.maxRow),
          minCol: Math.min(bounds.minCol, b.minCol),
          maxCol: Math.max(bounds.maxCol, b.maxCol),
        }
      : b;
  };

  // Rectangular range between anchor and active.
  if (state.active) {
    const anchor = state.anchor ?? state.active;
    widen({
      minRow: Math.min(anchor.row, state.active.row),
      maxRow: Math.max(anchor.row, state.active.row),
      minCol: Math.min(anchor.col, state.active.col),
      maxCol: Math.max(anchor.col, state.active.col),
    });
  }

  for (const r of state.fullRows) {
    widen({ minRow: r, maxRow: r, minCol: 0, maxCol: lastCol });
  }
  for (const c of state.fullCols) {
    widen({ minRow: 0, maxRow: lastRow, minCol: c, maxCol: c });
  }

  return bounds;
}

/** True when the given cell index falls inside the current selection. */
export function isSelectedIndex(
  index: CellIndex,
  state: SelectionState,
  axes: GridAxes,
): boolean {
  if (state.all) return true;
  if (state.fullRows.has(index.row)) return true;
  if (state.fullCols.has(index.col)) return true;

  if (state.active) {
    const anchor = state.anchor ?? state.active;
    const minRow = Math.min(anchor.row, state.active.row);
    const maxRow = Math.max(anchor.row, state.active.row);
    const minCol = Math.min(anchor.col, state.active.col);
    const maxCol = Math.max(anchor.col, state.active.col);
    if (
      index.row >= minRow &&
      index.row <= maxRow &&
      index.col >= minCol &&
      index.col <= maxCol
    ) {
      return true;
    }
  }
  return false;
}

/** True when the given coordinate is selected (convenience over `isSelectedIndex`). */
export function isSelectedCoord(
  coord: CellCoord,
  state: SelectionState,
  axes: GridAxes,
): boolean {
  const index = coordToIndex(coord, axes);
  if (!index) return false;
  return isSelectedIndex(index, state, axes);
}

/** True when the coordinate is the single active cell. */
export function isActiveCoord(
  coord: CellCoord,
  state: SelectionState,
  axes: GridAxes,
): boolean {
  if (!state.active) return false;
  const index = coordToIndex(coord, axes);
  if (!index) return false;
  return index.row === state.active.row && index.col === state.active.col;
}

/**
 * Enumerate every `CellCoord` inside the current selection, row-major. Useful
 * for clear/copy/fill operations that must touch each selected cell.
 */
export function selectedCoords(
  state: SelectionState,
  axes: GridAxes,
): CellCoord[] {
  const bounds = selectionBounds(state, axes);
  if (!bounds) return [];
  const out: CellCoord[] = [];
  for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
    for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
      const rowId = axes.rowIds[r];
      const colKey = axes.colKeys[c];
      if (rowId === undefined || colKey === undefined) continue;
      // Only include cells actually covered when the selection is disjoint
      // (full rows/cols + a rectangle can leave gaps outside the union).
      if (isSelectedIndex({ row: r, col: c }, state, axes)) {
        out.push({ rowId, colKey });
      }
    }
  }
  return out;
}

/** Convert the current active↔anchor rectangle into a `CellRange` of coords. */
export function activeRange(
  state: SelectionState,
  axes: GridAxes,
): CellRange | null {
  if (!state.active) return null;
  const anchor = state.anchor ?? state.active;
  const start = indexToCoord(anchor, axes);
  const end = indexToCoord(state.active, axes);
  if (!start || !end) return null;
  return { start, end };
}

/* -------------------------------------------------------------------------- */
/*  Movement math                                                             */
/* -------------------------------------------------------------------------- */

function step(
  from: CellIndex,
  dir: MoveDir,
  distance: MoveStep,
  axes: GridAxes,
): CellIndex {
  const lastRow = Math.max(0, axes.rowIds.length - 1);
  const lastCol = Math.max(0, axes.colKeys.length - 1);
  const delta = distance === "edge" ? Infinity : 1;

  switch (dir) {
    case "up":
      return clampIndex({ row: from.row - delta, col: from.col }, axes);
    case "down":
      return clampIndex({ row: from.row + delta, col: from.col }, axes);
    case "left":
      return clampIndex({ row: from.row, col: from.col - delta }, axes);
    case "right":
      return clampIndex({ row: from.row, col: from.col + delta }, axes);
    default:
      // Exhaustive; keeps the switch total.
      return clampIndex({ row: lastRow, col: lastCol }, axes);
  }
}

/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

/** Discriminated union of selection mutations. */
export type SelectionAction =
  /** Set the active cell and collapse any range (plain click / setActive). */
  | { type: "setActive"; index: CellIndex }
  /** Move the active cell (arrow keys). Collapses the range. */
  | { type: "move"; dir: MoveDir; step?: MoveStep }
  /** Extend the range by moving the active corner (Shift+Arrow). */
  | { type: "extend"; dir: MoveDir; step?: MoveStep }
  /** Extend the range to a specific cell (Shift+Click / drag). */
  | { type: "extendTo"; index: CellIndex }
  /** Begin a drag-select from a cell (mousedown). */
  | { type: "beginDrag"; index: CellIndex }
  /** Toggle / set a whole-row selection. `additive` keeps existing ones. */
  | { type: "selectRow"; row: number; additive?: boolean }
  /** Extend row selection from the anchor row to `row` (Shift+gutter click). */
  | { type: "selectRowRange"; row: number }
  /** Toggle / set a whole-column selection. `additive` keeps existing ones. */
  | { type: "selectCol"; col: number; additive?: boolean }
  /** Extend column selection from the anchor col to `col`. */
  | { type: "selectColRange"; col: number }
  /** Select the entire grid (Ctrl+A). */
  | { type: "selectAll" }
  /** Collapse to a single active cell (Esc-to-single / clear range). */
  | { type: "collapse" }
  /** Clear the whole selection. */
  | { type: "clear" };

/**
 * The pure selection reducer. Given the current state, the visible axes, and an
 * action, returns the next state. Never mutates its inputs.
 */
export function selectionReducer(
  state: SelectionState,
  axes: GridAxes,
  action: SelectionAction,
): SelectionState {
  switch (action.type) {
    case "setActive": {
      const index = clampIndex(action.index, axes);
      return {
        active: index,
        anchor: null,
        fullRows: new Set(),
        fullCols: new Set(),
        all: false,
      };
    }

    case "beginDrag": {
      const index = clampIndex(action.index, axes);
      return {
        active: index,
        anchor: index,
        fullRows: new Set(),
        fullCols: new Set(),
        all: false,
      };
    }

    case "move": {
      const from = state.active ?? { row: 0, col: 0 };
      const next = step(from, action.dir, action.step ?? "cell", axes);
      return {
        active: next,
        anchor: null,
        fullRows: new Set(),
        fullCols: new Set(),
        all: false,
      };
    }

    case "extend": {
      const from = state.active ?? { row: 0, col: 0 };
      const anchor = state.anchor ?? from;
      const next = step(from, action.dir, action.step ?? "cell", axes);
      return { ...state, active: next, anchor, fullRows: new Set(), fullCols: new Set(), all: false };
    }

    case "extendTo": {
      const next = clampIndex(action.index, axes);
      const anchor = state.anchor ?? state.active ?? next;
      return { ...state, active: next, anchor, fullRows: new Set(), fullCols: new Set(), all: false };
    }

    case "selectRow": {
      const rows = action.additive ? new Set(state.fullRows) : new Set<number>();
      if (rows.has(action.row)) rows.delete(action.row);
      else rows.add(action.row);
      const colKeys = axes.colKeys;
      return {
        active: { row: action.row, col: 0 },
        anchor: colKeys.length ? { row: action.row, col: colKeys.length - 1 } : null,
        fullRows: rows,
        fullCols: new Set(),
        all: false,
      };
    }

    case "selectRowRange": {
      const anchorRow = state.active?.row ?? action.row;
      const lo = Math.min(anchorRow, action.row);
      const hi = Math.max(anchorRow, action.row);
      const rows = new Set<number>();
      for (let r = lo; r <= hi; r++) rows.add(r);
      return {
        active: { row: action.row, col: 0 },
        anchor: { row: anchorRow, col: 0 },
        fullRows: rows,
        fullCols: new Set(),
        all: false,
      };
    }

    case "selectCol": {
      const cols = action.additive ? new Set(state.fullCols) : new Set<number>();
      if (cols.has(action.col)) cols.delete(action.col);
      else cols.add(action.col);
      const rowIds = axes.rowIds;
      return {
        active: { row: 0, col: action.col },
        anchor: rowIds.length ? { row: rowIds.length - 1, col: action.col } : null,
        fullRows: new Set(),
        fullCols: cols,
        all: false,
      };
    }

    case "selectColRange": {
      const anchorCol = state.active?.col ?? action.col;
      const lo = Math.min(anchorCol, action.col);
      const hi = Math.max(anchorCol, action.col);
      const cols = new Set<number>();
      for (let c = lo; c <= hi; c++) cols.add(c);
      return {
        active: { row: 0, col: action.col },
        anchor: { row: 0, col: anchorCol },
        fullRows: new Set(),
        fullCols: cols,
        all: false,
      };
    }

    case "selectAll": {
      if (axes.rowIds.length === 0 || axes.colKeys.length === 0) return state;
      return {
        active: state.active ?? { row: 0, col: 0 },
        anchor: { row: axes.rowIds.length - 1, col: axes.colKeys.length - 1 },
        fullRows: new Set(),
        fullCols: new Set(),
        all: true,
      };
    }

    case "collapse": {
      if (!state.active) return state;
      // If nothing was actually expanded, treat as a no-op to keep identity.
      if (
        state.anchor === null &&
        state.fullRows.size === 0 &&
        state.fullCols.size === 0 &&
        !state.all
      ) {
        return state;
      }
      return {
        active: state.active,
        anchor: null,
        fullRows: new Set(),
        fullCols: new Set(),
        all: false,
      };
    }

    case "clear":
      return EMPTY_SELECTION;

    default: {
      // Exhaustiveness guard: if a new action is added, TS flags this line.
      const _never: never = action;
      return state;
    }
  }
}

/** True when two selection states are structurally equal (cheap identity aid). */
export function selectionEquals(a: SelectionState, b: SelectionState): boolean {
  if (a === b) return true;
  if (!sameIndex(a.active, b.active)) return false;
  if (!sameIndex(a.anchor, b.anchor)) return false;
  if (a.all !== b.all) return false;
  if (a.fullRows.size !== b.fullRows.size) return false;
  if (a.fullCols.size !== b.fullCols.size) return false;
  for (const r of a.fullRows) if (!b.fullRows.has(r)) return false;
  for (const c of a.fullCols) if (!b.fullCols.has(c)) return false;
  return true;
}
