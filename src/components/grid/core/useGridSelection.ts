"use client";

/**
 * React binding over the pure selection reducer (`./selection.ts`).
 *
 * The hook owns the `SelectionState` via `useReducer`, resolves coordinates
 * against the current visible axes, and exposes an ergonomic imperative API
 * (`moveActive`, `extendTo`, `selectRow`, …) plus cheap membership predicates
 * (`isSelected`, `isActive`). All heavy lifting lives in the pure module, so
 * this file stays a thin, DOM-free adapter.
 */

import * as React from "react";
import type { CellCoord, CellRange } from "../types";
import {
  activeRange,
  clampIndex,
  coordToIndex,
  EMPTY_SELECTION,
  indexToCoord,
  isActiveCoord,
  isSelectedCoord,
  selectedCoords,
  selectionBounds,
  selectionReducer,
  type CellIndex,
  type GridAxes,
  type MoveDir,
  type MoveStep,
  type SelectionAction,
  type SelectionBounds,
  type SelectionState,
} from "./selection";

/** The visible ordering of rows and columns the selection navigates over. */
export interface GridSelectionAxes {
  rowIds: readonly string[];
  colKeys: readonly string[];
}

export interface UseGridSelectionOptions {
  /** Ordered, visible row ids (post sort/filter). */
  rowIds: readonly string[];
  /** Ordered, visible column keys (post reorder/hide). */
  colKeys: readonly string[];
  /** Optional initial active coordinate. */
  initialActive?: CellCoord | null;
}

export interface UseGridSelectionResult {
  /** The raw selection state (index space). */
  state: SelectionState;
  /** The active cell as a coordinate, or null. */
  activeCoord: CellCoord | null;
  /** Normalized rectangular bounds in index space, or null. */
  bounds: SelectionBounds | null;
  /** The active↔anchor rectangle as a coordinate range, or null. */
  range: CellRange | null;

  /** True when `coord` falls within the selection. */
  isSelected: (coord: CellCoord) => boolean;
  /** True when `coord` is the single active cell. */
  isActive: (coord: CellCoord) => boolean;
  /** Enumerate every selected coordinate (row-major). */
  selectedCoords: () => CellCoord[];

  /** Set the active cell (plain click). */
  setActive: (coord: CellCoord) => void;
  /** Move the active cell one step / to the edge (arrow keys). */
  moveActive: (dir: MoveDir, step?: MoveStep) => void;
  /** Extend the range by a step (Shift+Arrow). */
  extend: (dir: MoveDir, step?: MoveStep) => void;
  /** Extend the range to a target cell (Shift+Click / drag). */
  extendTo: (coord: CellCoord) => void;
  /** Begin a drag-select at a cell (mousedown). */
  beginDrag: (coord: CellCoord) => void;

  /** Toggle / set a whole-row selection (gutter / checkbox). */
  selectRow: (rowId: string, opts?: { additive?: boolean; range?: boolean }) => void;
  /** Toggle / set a whole-column selection (header click). */
  selectColumn: (colKey: string, opts?: { additive?: boolean; range?: boolean }) => void;

  /** Select the entire grid (Ctrl+A). */
  selectAll: () => void;
  /** Collapse a range to its active cell (Esc). */
  collapse: () => void;
  /** Clear the whole selection. */
  clear: () => void;

  /** Low-level escape hatch: dispatch a raw reducer action. */
  dispatch: (action: SelectionAction) => void;

  /** Jump the active cell to a grid corner, optionally extending. */
  jumpTo: (corner: "start" | "end", extend: boolean) => void;
}

export function useGridSelection(
  options: UseGridSelectionOptions,
): UseGridSelectionResult {
  const { rowIds, colKeys, initialActive } = options;

  // Derive the current axes during render from the raw axis arrays. Memoized
  // by identity so the render-phase reducer/derived values only recompute when
  // the geometry actually changes.
  const axes = React.useMemo<GridAxes>(
    () => ({ rowIds, colKeys }),
    [rowIds, colKeys],
  );

  // Mirror the current axes into a ref for the stable callbacks below, so they
  // always see the latest geometry without being recreated on every render.
  // Written in an effect (never during render) to satisfy the refs rule.
  const axesRef = React.useRef<GridAxes>(axes);
  React.useEffect(() => {
    axesRef.current = axes;
  }, [axes]);

  // The axes each action should apply against are injected onto the action at
  // dispatch time (an event-handler context where reading the ref is allowed),
  // so the reducer stays pure and never closes over a ref during render.
  const [state, rawDispatch] = React.useReducer(
    reduceWithAxes,
    initialActive
      ? initActive(initialActive, { rowIds, colKeys })
      : EMPTY_SELECTION,
  );

  const dispatch = React.useCallback(
    (action: SelectionAction) =>
      rawDispatch({ ...action, __axes: axesRef.current } as ActionWithAxes),
    [],
  );

  /* --------------------------- derived values --------------------------- */
  const activeCoord = React.useMemo(
    () => (state.active ? indexToCoord(state.active, axes) : null),
    [state.active, axes],
  );
  const bounds = React.useMemo(
    () => selectionBounds(state, axes),
    [state, axes],
  );
  const range = React.useMemo(() => activeRange(state, axes), [state, axes]);

  /* ----------------------------- predicates ----------------------------- */
  const isSelected = React.useCallback(
    (coord: CellCoord) => isSelectedCoord(coord, state, axesRef.current),
    [state],
  );
  const isActive = React.useCallback(
    (coord: CellCoord) => isActiveCoord(coord, state, axesRef.current),
    [state],
  );
  const listSelected = React.useCallback(
    () => selectedCoords(state, axesRef.current),
    [state],
  );

  /* ------------------------------ commands ------------------------------ */
  const setActive = React.useCallback((coord: CellCoord) => {
    const index = coordToIndex(coord, axesRef.current);
    if (index) dispatch({ type: "setActive", index });
  }, [dispatch]);

  const beginDrag = React.useCallback((coord: CellCoord) => {
    const index = coordToIndex(coord, axesRef.current);
    if (index) dispatch({ type: "beginDrag", index });
  }, [dispatch]);

  const moveActive = React.useCallback(
    (dir: MoveDir, step: MoveStep = "cell") =>
      dispatch({ type: "move", dir, step }),
    [dispatch],
  );

  const extend = React.useCallback(
    (dir: MoveDir, step: MoveStep = "cell") =>
      dispatch({ type: "extend", dir, step }),
    [dispatch],
  );

  const extendTo = React.useCallback((coord: CellCoord) => {
    const index = coordToIndex(coord, axesRef.current);
    if (index) dispatch({ type: "extendTo", index });
  }, [dispatch]);

  const selectRow = React.useCallback(
    (rowId: string, opts?: { additive?: boolean; range?: boolean }) => {
      const row = axesRef.current.rowIds.indexOf(rowId);
      if (row < 0) return;
      if (opts?.range) dispatch({ type: "selectRowRange", row });
      else dispatch({ type: "selectRow", row, additive: opts?.additive });
    },
    [dispatch],
  );

  const selectColumn = React.useCallback(
    (colKey: string, opts?: { additive?: boolean; range?: boolean }) => {
      const col = axesRef.current.colKeys.indexOf(colKey);
      if (col < 0) return;
      if (opts?.range) dispatch({ type: "selectColRange", col });
      else dispatch({ type: "selectCol", col, additive: opts?.additive });
    },
    [dispatch],
  );

  const selectAll = React.useCallback(
    () => dispatch({ type: "selectAll" }),
    [dispatch],
  );
  const collapse = React.useCallback(
    () => dispatch({ type: "collapse" }),
    [dispatch],
  );
  const clear = React.useCallback(() => dispatch({ type: "clear" }), [dispatch]);

  const jumpTo = React.useCallback(
    (corner: "start" | "end", extendSel: boolean) => {
      const a = axesRef.current;
      const target: CellIndex =
        corner === "start"
          ? { row: 0, col: 0 }
          : { row: a.rowIds.length - 1, col: a.colKeys.length - 1 };
      const clamped = clampIndex(target, a);
      if (extendSel) dispatch({ type: "extendTo", index: clamped });
      else dispatch({ type: "setActive", index: clamped });
    },
    [dispatch],
  );

  return {
    state,
    activeCoord,
    bounds,
    range,
    isSelected,
    isActive,
    selectedCoords: listSelected,
    setActive,
    moveActive,
    extend,
    extendTo,
    beginDrag,
    selectRow,
    selectColumn,
    selectAll,
    collapse,
    clear,
    dispatch,
    jumpTo,
  };
}

/**
 * A `SelectionAction` carrying the axes it should be reduced against. The axes
 * are attached at dispatch time so the reducer stays a pure `(state, action)`
 * function and never has to read a ref during render.
 */
type ActionWithAxes = SelectionAction & { __axes: GridAxes };

/** Module-level pure reducer: unwraps the injected axes and delegates. */
function reduceWithAxes(
  state: SelectionState,
  action: ActionWithAxes,
): SelectionState {
  return selectionReducer(state, action.__axes, action);
}

/** Build the initial state focused on a coordinate (or empty if it isn't visible). */
function initActive(
  coord: CellCoord,
  axes: GridSelectionAxes,
): SelectionState {
  const index = coordToIndex(coord, axes);
  if (!index) return EMPTY_SELECTION;
  return { ...EMPTY_SELECTION, active: index };
}
