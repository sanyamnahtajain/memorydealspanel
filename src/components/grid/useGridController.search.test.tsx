import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { useGridController } from "./useGridController";
import type { ColumnDef, GridRow } from "./types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

interface Item extends GridRow {
  id: string;
  name: string;
  sku: string;
  brand: string;
}

const columns: ColumnDef<Item>[] = [
  { key: "name", header: "Product", type: "text" },
  { key: "sku", header: "SKU", type: "text" },
  { key: "brand", header: "Brand", type: "text" },
];

const rows: Item[] = [
  {
    id: "p1",
    name: "Ambrane Powerbank 20000mAh PP-20",
    sku: "AMB-PP20-BLK",
    brand: "Ambrane",
  },
  { id: "p2", name: "boAt Airdopes 141", sku: "BOAT-141", brand: "boAt" },
  { id: "p3", name: "Ubon Wall Charger 25W", sku: "UB-25", brand: "Ubon" },
];

function setup() {
  return renderHook(() =>
    useGridController<Item>({
      gridId: "test-grid",
      rows,
      columns,
      onSave: async () => {},
    }),
  );
}

/**
 * The search half of the grid controller — the part staff reported as broken
 * and slow. These lock in the behaviour, not the implementation: what reaches
 * the filter, how fast a cell can answer "am I a match", and that the counter
 * never reports a number it cannot back up.
 */
describe("useGridController — search", () => {
  it("does not filter until typing pauses", () => {
    vi.useFakeTimers();
    const { result } = setup();

    act(() => result.current.setSearch("a"));
    act(() => vi.advanceTimersByTime(40));
    act(() => result.current.setSearch("ambrane"));

    // Mid-burst: the catalogue has not been re-scanned for any prefix.
    expect(result.current.viewRows).toHaveLength(3);
    expect(result.current.searchPending).toBe(true);

    act(() => vi.advanceTimersByTime(200));
    expect(result.current.searchPending).toBe(false);
    expect(result.current.viewRows.map((r) => r.id)).toEqual(["p1"]);
  });

  it("clears instantly — an emptied box never leaves rows hidden", () => {
    vi.useFakeTimers();
    const { result } = setup();

    act(() => result.current.setSearch("ubon"));
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.viewRows).toHaveLength(1);

    // No timer advance: every row is back on the very next render.
    act(() => result.current.setSearch(""));
    expect(result.current.viewRows).toHaveLength(3);
    expect(result.current.searchPending).toBe(false);
  });

  it("answers 'is this cell a match' without scanning the match list", () => {
    vi.useFakeTimers();
    const { result } = setup();

    act(() => result.current.setSearch("ambrane"));
    act(() => vi.advanceTimersByTime(200));

    // The brand cell and the name cell both hold the word; the SKU does not.
    expect(result.current.isSearchMatch("p1", "brand")).toBe(true);
    expect(result.current.isSearchMatch("p1", "name")).toBe(true);
    expect(result.current.isSearchMatch("p1", "sku")).toBe(false);
    // A row that was filtered out is never a match.
    expect(result.current.isSearchMatch("p2", "brand")).toBe(false);
    // And it agrees exactly with the list the Enter-cycling walks.
    expect(result.current.searchMatches).toEqual([
      { rowId: "p1", colKey: "name" },
      { rowId: "p1", colKey: "brand" },
    ]);
  });

  it("words may come from different cells, in any order", () => {
    vi.useFakeTimers();
    const { result } = setup();

    act(() => result.current.setSearch("20000 ambrane"));
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.viewRows.map((r) => r.id)).toEqual(["p1"]);
  });

  it("never reports a match index past the end of the match list", () => {
    vi.useFakeTimers();
    const { result } = setup();

    act(() => result.current.setSearch("a"));
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.searchMatches.length).toBeGreaterThan(1);

    act(() => result.current.gotoNextMatch());
    act(() => result.current.gotoNextMatch());
    const parked = result.current.activeMatchIndex;
    expect(parked).toBeGreaterThan(0);

    // Narrowing the query shrinks the list under the parked index. The old
    // code kept counting from it and displayed things like "3 / 1".
    act(() => result.current.setSearch("ubon wall"));
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.activeMatchIndex).toBeLessThan(
      Math.max(result.current.searchMatches.length, 1),
    );
  });

  it("reports no matches for a query nothing answers", () => {
    vi.useFakeTimers();
    const { result } = setup();

    act(() => result.current.setSearch("portronics"));
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.viewRows).toHaveLength(0);
    expect(result.current.searchMatches).toHaveLength(0);
    expect(result.current.activeMatchIndex).toBe(0);
  });
});
