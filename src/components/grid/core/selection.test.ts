import { describe, expect, it } from "vitest";
import {
  activeRange,
  clampIndex,
  coordToIndex,
  EMPTY_SELECTION,
  indexToCoord,
  isSelectedCoord,
  isActiveCoord,
  selectedCoords,
  selectionBounds,
  selectionEquals,
  selectionReducer,
  type GridAxes,
  type SelectionAction,
  type SelectionState,
} from "./selection";

/* ------------------------------- fixtures -------------------------------- */

// 4 rows × 3 columns.
const axes: GridAxes = {
  rowIds: ["r0", "r1", "r2", "r3"],
  colKeys: ["a", "b", "c"],
};

function reduce(
  state: SelectionState,
  ...actions: SelectionAction[]
): SelectionState {
  return actions.reduce((s, a) => selectionReducer(s, axes, a), state);
}

const start = (row: number, col: number): SelectionState =>
  selectionReducer(EMPTY_SELECTION, axes, { type: "setActive", index: { row, col } });

/* --------------------------- coordinate mapping -------------------------- */

describe("coordinate ⇄ index", () => {
  it("resolves coords to indices in visible order", () => {
    expect(coordToIndex({ rowId: "r2", colKey: "b" }, axes)).toEqual({ row: 2, col: 1 });
    expect(indexToCoord({ row: 2, col: 1 }, axes)).toEqual({ rowId: "r2", colKey: "b" });
  });

  it("returns null for invisible coords", () => {
    expect(coordToIndex({ rowId: "ghost", colKey: "b" }, axes)).toBeNull();
    expect(indexToCoord({ row: 99, col: 0 }, axes)).toBeNull();
  });

  it("clamps out-of-range indices", () => {
    expect(clampIndex({ row: -5, col: 9 }, axes)).toEqual({ row: 0, col: 2 });
  });
});

/* ------------------------------ navigation ------------------------------- */

describe("moveActive", () => {
  it("moves one cell and collapses any range", () => {
    const s = reduce(start(1, 1), { type: "move", dir: "down" });
    expect(s.active).toEqual({ row: 2, col: 1 });
    expect(s.anchor).toBeNull();
  });

  it("clamps at edges", () => {
    const s = reduce(start(0, 0), { type: "move", dir: "up" }, { type: "move", dir: "left" });
    expect(s.active).toEqual({ row: 0, col: 0 });
  });

  it("edge step jumps to the far edge", () => {
    const s = reduce(start(0, 0), { type: "move", dir: "down", step: "edge" });
    expect(s.active).toEqual({ row: 3, col: 0 });
  });
});

/* --------------------------- range extension ----------------------------- */

describe("extend / extendTo", () => {
  it("shift+arrow keeps the anchor and moves the active corner", () => {
    const s = reduce(start(1, 1), { type: "extend", dir: "down" }, { type: "extend", dir: "right" });
    expect(s.anchor).toEqual({ row: 1, col: 1 });
    expect(s.active).toEqual({ row: 2, col: 2 });
    const b = selectionBounds(s, axes)!;
    expect(b).toEqual({ minRow: 1, maxRow: 2, minCol: 1, maxCol: 2 });
  });

  it("extendTo selects a rectangle regardless of drag direction", () => {
    // Drag from (2,2) up-left to (0,0).
    const s = reduce(
      EMPTY_SELECTION,
      { type: "beginDrag", index: { row: 2, col: 2 } },
      { type: "extendTo", index: { row: 0, col: 0 } },
    );
    const b = selectionBounds(s, axes)!;
    expect(b).toEqual({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 2 });
    expect(isSelectedCoord({ rowId: "r1", colKey: "b" }, s, axes)).toBe(true);
    expect(isSelectedCoord({ rowId: "r3", colKey: "c" }, s, axes)).toBe(false);
  });

  it("activeRange reports start=anchor, end=active as coords", () => {
    const s = reduce(start(0, 0), { type: "extendTo", index: { row: 1, col: 2 } });
    expect(activeRange(s, axes)).toEqual({
      start: { rowId: "r0", colKey: "a" },
      end: { rowId: "r1", colKey: "c" },
    });
  });
});

/* --------------------------- full row / column --------------------------- */

describe("full-row selection", () => {
  it("selects a whole row across all columns", () => {
    const s = reduce(EMPTY_SELECTION, { type: "selectRow", row: 2 });
    expect(s.fullRows.has(2)).toBe(true);
    expect(isSelectedCoord({ rowId: "r2", colKey: "a" }, s, axes)).toBe(true);
    expect(isSelectedCoord({ rowId: "r2", colKey: "c" }, s, axes)).toBe(true);
    expect(isSelectedCoord({ rowId: "r1", colKey: "a" }, s, axes)).toBe(false);
  });

  it("additive keeps prior rows; toggling removes", () => {
    let s = reduce(EMPTY_SELECTION, { type: "selectRow", row: 0 });
    s = reduce(s, { type: "selectRow", row: 2, additive: true });
    expect([...s.fullRows].sort()).toEqual([0, 2]);
    s = reduce(s, { type: "selectRow", row: 2, additive: true });
    expect([...s.fullRows]).toEqual([0]);
  });

  it("selectRowRange spans anchor→target inclusive", () => {
    let s = start(1, 0);
    s = reduce(s, { type: "selectRowRange", row: 3 });
    expect([...s.fullRows].sort()).toEqual([1, 2, 3]);
  });
});

describe("full-column selection", () => {
  it("selects a whole column across all rows", () => {
    const s = reduce(EMPTY_SELECTION, { type: "selectCol", col: 1 });
    expect(s.fullCols.has(1)).toBe(true);
    expect(isSelectedCoord({ rowId: "r0", colKey: "b" }, s, axes)).toBe(true);
    expect(isSelectedCoord({ rowId: "r3", colKey: "b" }, s, axes)).toBe(true);
    expect(isSelectedCoord({ rowId: "r0", colKey: "a" }, s, axes)).toBe(false);
  });
});

/* -------------------------------- select all ----------------------------- */

describe("selectAll", () => {
  it("marks everything selected and bounds spans the grid", () => {
    const s = reduce(start(1, 1), { type: "selectAll" });
    expect(s.all).toBe(true);
    expect(selectionBounds(s, axes)).toEqual({ minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 });
    expect(isSelectedCoord({ rowId: "r3", colKey: "c" }, s, axes)).toBe(true);
    expect(selectedCoords(s, axes)).toHaveLength(12);
  });

  it("is a no-op on an empty grid", () => {
    const empty: GridAxes = { rowIds: [], colKeys: [] };
    const s = selectionReducer(EMPTY_SELECTION, empty, { type: "selectAll" });
    expect(s.all).toBe(false);
  });
});

/* -------------------------------- collapse ------------------------------- */

describe("collapse & clear", () => {
  it("collapse reduces a range to its active cell", () => {
    let s = reduce(start(0, 0), { type: "extendTo", index: { row: 2, col: 2 } });
    s = reduce(s, { type: "collapse" });
    expect(s.anchor).toBeNull();
    expect(s.active).toEqual({ row: 2, col: 2 });
    expect(selectionBounds(s, axes)).toEqual({ minRow: 2, maxRow: 2, minCol: 2, maxCol: 2 });
  });

  it("collapse on a single cell keeps identity (no-op)", () => {
    const s = start(1, 1);
    expect(selectionReducer(s, axes, { type: "collapse" })).toBe(s);
  });

  it("clear empties everything", () => {
    const s = reduce(start(1, 1), { type: "selectAll" }, { type: "clear" });
    expect(s.active).toBeNull();
    expect(s.all).toBe(false);
  });
});

/* ------------------------------- predicates ------------------------------ */

describe("predicates", () => {
  it("isActiveCoord matches only the active cell", () => {
    const s = reduce(start(1, 1), { type: "extendTo", index: { row: 2, col: 2 } });
    expect(isActiveCoord({ rowId: "r2", colKey: "c" }, s, axes)).toBe(true);
    expect(isActiveCoord({ rowId: "r1", colKey: "b" }, s, axes)).toBe(false);
  });

  it("selectionEquals compares structurally", () => {
    expect(selectionEquals(start(1, 1), start(1, 1))).toBe(true);
    expect(selectionEquals(start(1, 1), start(2, 1))).toBe(false);
    // Same active cell + same full-row set (built in a different order) is equal.
    let a = start(0, 0);
    a = reduce(a, { type: "selectRow", row: 0 });
    a = reduce(a, { type: "selectRow", row: 2, additive: true });
    let b = start(0, 0);
    b = reduce(b, { type: "selectRow", row: 0 });
    b = reduce(b, { type: "selectRow", row: 2, additive: true });
    expect(selectionEquals(a, b)).toBe(true);
    // Differing full-row sets are unequal.
    const c = reduce(b, { type: "selectRow", row: 1, additive: true });
    expect(selectionEquals(a, c)).toBe(false);
  });
});
