import { describe, expect, it } from "vitest";

import type { CellChange, CellCoord, GridRow } from "@/components/grid/types";
import {
  apply,
  canRedo,
  canUndo,
  changesOf,
  clear,
  collapseChanges,
  createCommandStack,
  invert,
  makeBulkCommand,
  makeCellEditCommand,
  makeFillCommand,
  makePasteCommand,
  peekRedo,
  peekUndo,
  push,
  redo,
  undo,
  valuesEqual,
} from "./commandStack";

interface ProductRow extends GridRow {
  id: string;
  title: string;
  pricePaise: number;
  tags: string[];
  active: boolean;
}

function rows(): ProductRow[] {
  return [
    { id: "r1", title: "Widget", pricePaise: 49950, tags: ["a"], active: true },
    { id: "r2", title: "Gadget", pricePaise: 10000, tags: [], active: false },
    { id: "r3", title: "Gizmo", pricePaise: 20000, tags: ["x", "y"], active: true },
  ];
}

const coord = (rowId: string, colKey: string): CellCoord => ({ rowId, colKey });

function get(list: ProductRow[], rowId: string): ProductRow {
  const row = list.find((r) => r.id === rowId);
  if (!row) throw new Error(`no row ${rowId}`);
  return row;
}

describe("valuesEqual", () => {
  it("compares primitives and treats NaN as equal", () => {
    expect(valuesEqual(1, 1)).toBe(true);
    expect(valuesEqual("a", "a")).toBe(true);
    expect(valuesEqual(NaN, NaN)).toBe(true);
    expect(valuesEqual(1, 2)).toBe(false);
    expect(valuesEqual(null, undefined)).toBe(false);
  });

  it("compares string arrays structurally", () => {
    expect(valuesEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(valuesEqual(["a"], ["a", "b"])).toBe(false);
    expect(valuesEqual([], [])).toBe(true);
  });
});

describe("makeCellEditCommand", () => {
  it("returns null for no-op edits", () => {
    expect(makeCellEditCommand(coord("r1", "title"), "Widget", "Widget")).toBeNull();
    expect(makeCellEditCommand(coord("r1", "tags"), ["a"], ["a"])).toBeNull();
  });

  it("builds a cell-edit for real changes", () => {
    const cmd = makeCellEditCommand(coord("r1", "title"), "Widget", "Sprocket");
    expect(cmd).toEqual({
      kind: "cell-edit",
      change: { coord: coord("r1", "title"), prev: "Widget", next: "Sprocket" },
    });
  });
});

describe("apply + invert (cell-edit)", () => {
  it("applies forward and copies only the touched row", () => {
    const base = rows();
    const cmd = makeCellEditCommand(coord("r2", "pricePaise"), 10000, 12500)!;
    const next = apply(cmd, base);
    expect(get(next, "r2").pricePaise).toBe(12500);
    // untouched rows keep identity
    expect(next.find((r) => r.id === "r1")).toBe(base[0]);
    // input not mutated
    expect(get(base, "r2").pricePaise).toBe(10000);
  });

  it("undo via invert restores the previous value", () => {
    const base = rows();
    const cmd = makeCellEditCommand(coord("r2", "pricePaise"), 10000, 12500)!;
    const after = apply(cmd, base);
    const back = apply(invert(cmd), after);
    expect(get(back, "r2").pricePaise).toBe(10000);
  });
});

describe("paste-block collapses to one command", () => {
  const changes: CellChange[] = [
    { coord: coord("r1", "title"), prev: "Widget", next: "P1" },
    { coord: coord("r2", "title"), prev: "Gadget", next: "P2" },
    { coord: coord("r3", "title"), prev: "Gizmo", next: "P3" },
  ];

  it("is a single command carrying every cell", () => {
    const cmd = makePasteCommand(coord("r1", "title"), changes)!;
    expect(cmd.kind).toBe("paste-block");
    expect(changesOf(cmd)).toHaveLength(3);
  });

  it("applies + undoes atomically", () => {
    const base = rows();
    const cmd = makePasteCommand(coord("r1", "title"), changes)!;
    const pasted = apply(cmd, base);
    expect(pasted.map((r) => r.title)).toEqual(["P1", "P2", "P3"]);
    const undone = apply(invert(cmd), pasted);
    expect(undone.map((r) => r.title)).toEqual(["Widget", "Gadget", "Gizmo"]);
  });

  it("drops no-op cells and coalesces repeat writes to the same cell", () => {
    const collapsed = collapseChanges([
      { coord: coord("r1", "title"), prev: "Widget", next: "Widget" }, // no-op
      { coord: coord("r2", "title"), prev: "Gadget", next: "A" },
      { coord: coord("r2", "title"), prev: "A", next: "B" }, // repeat
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toEqual({
      coord: coord("r2", "title"),
      prev: "Gadget",
      next: "B",
    });
  });

  it("returns null when the whole paste is a no-op", () => {
    expect(
      makePasteCommand(coord("r1", "title"), [
        { coord: coord("r1", "title"), prev: "Widget", next: "Widget" },
      ]),
    ).toBeNull();
  });
});

describe("fill collapses to one command", () => {
  it("applies + undoes atomically across a range", () => {
    const base = rows();
    const source = { start: coord("r1", "pricePaise"), end: coord("r1", "pricePaise") };
    const target = { start: coord("r2", "pricePaise"), end: coord("r3", "pricePaise") };
    const changes: CellChange[] = [
      { coord: coord("r2", "pricePaise"), prev: 10000, next: 49950 },
      { coord: coord("r3", "pricePaise"), prev: 20000, next: 49950 },
    ];
    const cmd = makeFillCommand(source, target, changes)!;
    expect(cmd.kind).toBe("fill");
    const filled = apply(cmd, base);
    expect(get(filled, "r2").pricePaise).toBe(49950);
    expect(get(filled, "r3").pricePaise).toBe(49950);
    const back = apply(invert(cmd), filled);
    expect(get(back, "r2").pricePaise).toBe(10000);
    expect(get(back, "r3").pricePaise).toBe(20000);
  });
});

describe("bulk command", () => {
  it("carries its label through invert", () => {
    const cmd = makeBulkCommand("Bump prices +10%", [
      { coord: coord("r1", "pricePaise"), prev: 49950, next: 54945 },
    ])!;
    expect(cmd.kind).toBe("bulk");
    const inv = invert(cmd);
    expect(inv.kind).toBe("bulk");
    if (inv.kind === "bulk") expect(inv.label).toBe("Bump prices +10%");
  });
});

describe("command stack", () => {
  const edit1 = makeCellEditCommand(coord("r1", "title"), "Widget", "A")!;
  const edit2 = makeCellEditCommand(coord("r2", "title"), "Gadget", "B")!;

  it("push clears future and tracks undo/redo availability", () => {
    let s = createCommandStack();
    expect(canUndo(s)).toBe(false);
    expect(canRedo(s)).toBe(false);
    s = push(s, edit1);
    expect(canUndo(s)).toBe(true);
    expect(peekUndo(s)).toBe(edit1);
  });

  it("undo then redo round-trips rows and stack", () => {
    let s = createCommandStack();
    let list = rows();
    s = push(s, edit1);
    list = apply(edit1, list);
    expect(get(list, "r1").title).toBe("A");

    const u = undo(s);
    s = u.stack;
    list = apply(u.applied!, list);
    expect(get(list, "r1").title).toBe("Widget");
    expect(canRedo(s)).toBe(true);
    expect(peekRedo(s)).toBe(edit1);

    const r = redo(s);
    s = r.stack;
    list = apply(r.applied!, list);
    expect(get(list, "r1").title).toBe("A");
    expect(canRedo(s)).toBe(false);
  });

  it("a fresh push after undo forks history (clears future)", () => {
    let s = createCommandStack();
    s = push(s, edit1);
    s = undo(s).stack;
    expect(canRedo(s)).toBe(true);
    s = push(s, edit2);
    expect(canRedo(s)).toBe(false);
    expect(peekUndo(s)).toBe(edit2);
  });

  it("undo/redo on empty sides are no-ops", () => {
    const s = createCommandStack();
    expect(undo(s).applied).toBeUndefined();
    expect(redo(s).applied).toBeUndefined();
  });

  it("push(null) leaves the stack unchanged", () => {
    const s = push(createCommandStack(), edit1);
    expect(push(s, null)).toBe(s);
  });

  it("honors the history limit by evicting the oldest", () => {
    let s = createCommandStack(2);
    const c1 = makeCellEditCommand(coord("r1", "title"), "Widget", "1")!;
    const c2 = makeCellEditCommand(coord("r2", "title"), "Gadget", "2")!;
    const c3 = makeCellEditCommand(coord("r3", "title"), "Gizmo", "3")!;
    s = push(s, c1);
    s = push(s, c2);
    s = push(s, c3);
    expect(s.past).toHaveLength(2);
    expect(s.past[0]).toBe(c2);
    expect(s.past[1]).toBe(c3);
  });

  it("clear empties both stacks", () => {
    let s = createCommandStack();
    s = push(s, edit1);
    s = clear(s);
    expect(canUndo(s)).toBe(false);
    expect(canRedo(s)).toBe(false);
  });
});
