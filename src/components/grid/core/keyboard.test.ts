import { describe, expect, it } from "vitest";
import {
  isPrintableKey,
  resolveKeyIntent,
  strokeFromEvent,
  type GridIntent,
  type KeyStroke,
} from "./keyboard";

/** Resolve a keystroke in browsing mode. */
const browse = (stroke: KeyStroke): GridIntent =>
  resolveKeyIntent(stroke, "browsing");
/** Resolve a keystroke in editing mode. */
const edit = (stroke: KeyStroke): GridIntent =>
  resolveKeyIntent(stroke, "editing");

/* ------------------------------ navigation ------------------------------- */

describe("browsing — navigation", () => {
  it("arrows move one cell", () => {
    expect(browse({ key: "ArrowDown" })).toEqual({ type: "move", dir: "down", step: "cell" });
    expect(browse({ key: "ArrowUp" })).toEqual({ type: "move", dir: "up", step: "cell" });
    expect(browse({ key: "ArrowLeft" })).toEqual({ type: "move", dir: "left", step: "cell" });
    expect(browse({ key: "ArrowRight" })).toEqual({ type: "move", dir: "right", step: "cell" });
  });

  it("shift+arrow extends by a cell", () => {
    expect(browse({ key: "ArrowRight", shift: true })).toEqual({
      type: "extend",
      dir: "right",
      step: "cell",
    });
  });

  it("mod+arrow jumps to the edge", () => {
    expect(browse({ key: "ArrowDown", mod: true })).toEqual({
      type: "move",
      dir: "down",
      step: "edge",
    });
  });

  it("mod+shift+arrow extends to the edge", () => {
    expect(browse({ key: "ArrowDown", mod: true, shift: true })).toEqual({
      type: "extend",
      dir: "down",
      step: "edge",
    });
  });

  it("Tab / Shift+Tab step horizontally", () => {
    expect(browse({ key: "Tab" })).toEqual({ type: "tab", dir: "next" });
    expect(browse({ key: "Tab", shift: true })).toEqual({ type: "tab", dir: "prev" });
  });

  it("Enter / Shift+Enter commit & move vertically", () => {
    expect(browse({ key: "Enter" })).toEqual({ type: "commitMove", dir: "down" });
    expect(browse({ key: "Enter", shift: true })).toEqual({ type: "commitMove", dir: "up" });
  });

  it("Ctrl+Home / Ctrl+End jump to corners", () => {
    expect(browse({ key: "Home", mod: true })).toEqual({ type: "jump", corner: "start", extend: false });
    expect(browse({ key: "End", mod: true, shift: true })).toEqual({ type: "jump", corner: "end", extend: true });
  });
});

/* -------------------------------- editing -------------------------------- */

describe("browsing — enter edit", () => {
  it("F2 enters edit mode without a seed", () => {
    expect(browse({ key: "F2" })).toEqual({ type: "editStart" });
  });

  it("typing a printable char starts editing seeded with it", () => {
    expect(browse({ key: "a" })).toEqual({ type: "editStartWith", char: "a" });
    expect(browse({ key: "5" })).toEqual({ type: "editStartWith", char: "5" });
    expect(browse({ key: " " })).toEqual({ type: "editStartWith", char: " " });
  });

  it("named keys do not start editing", () => {
    expect(browse({ key: "Shift" })).toEqual({ type: "none" });
    expect(browse({ key: "CapsLock" })).toEqual({ type: "none" });
  });

  it("mod+char is a command, never a seed", () => {
    expect(browse({ key: "a", mod: true })).toEqual({ type: "selectAll" });
  });
});

describe("editing mode", () => {
  it("Enter commits and moves down", () => {
    expect(edit({ key: "Enter" })).toEqual({ type: "commitMove", dir: "down" });
    expect(edit({ key: "Enter", shift: true })).toEqual({ type: "commitMove", dir: "up" });
  });

  it("Tab commits and moves horizontally", () => {
    expect(edit({ key: "Tab" })).toEqual({ type: "tab", dir: "next" });
    expect(edit({ key: "Tab", shift: true })).toEqual({ type: "tab", dir: "prev" });
  });

  it("Escape cancels the edit", () => {
    expect(edit({ key: "Escape" })).toEqual({ type: "cancel" });
  });

  it("arrows and typing stay inside the editor", () => {
    expect(edit({ key: "ArrowLeft" })).toEqual({ type: "none" });
    expect(edit({ key: "x" })).toEqual({ type: "none" });
    expect(edit({ key: "Home" })).toEqual({ type: "none" });
  });
});

/* --------------------------- commands & clipboard ------------------------ */

describe("browsing — commands", () => {
  it("Ctrl+A selects all", () => {
    expect(browse({ key: "a", mod: true })).toEqual({ type: "selectAll" });
  });

  it("Delete / Backspace clear the selection", () => {
    expect(browse({ key: "Delete" })).toEqual({ type: "clear" });
    expect(browse({ key: "Backspace" })).toEqual({ type: "clear" });
  });

  it("Escape collapses the selection", () => {
    expect(browse({ key: "Escape" })).toEqual({ type: "cancel" });
  });

  it("clipboard: copy / cut / paste", () => {
    expect(browse({ key: "c", mod: true })).toEqual({ type: "copy" });
    expect(browse({ key: "x", mod: true })).toEqual({ type: "cut" });
    expect(browse({ key: "v", mod: true })).toEqual({ type: "paste" });
  });

  it("fill: down (Ctrl+D) and right (Ctrl+R)", () => {
    expect(browse({ key: "d", mod: true })).toEqual({ type: "fillDown" });
    expect(browse({ key: "r", mod: true })).toEqual({ type: "fillRight" });
  });

  it("undo / redo variants", () => {
    expect(browse({ key: "z", mod: true })).toEqual({ type: "undo" });
    expect(browse({ key: "z", mod: true, shift: true })).toEqual({ type: "redo" });
    expect(browse({ key: "y", mod: true })).toEqual({ type: "redo" });
  });

  it("uppercase (shift-held) command letters still resolve", () => {
    expect(browse({ key: "C", mod: true, shift: true })).toEqual({ type: "copy" });
  });

  it("unknown mod combos pass through", () => {
    expect(browse({ key: "f", mod: true })).toEqual({ type: "none" });
  });
});

/* -------------------------- helpers & normalization ---------------------- */

describe("helpers", () => {
  it("isPrintableKey classifies single printable code points", () => {
    expect(isPrintableKey("a")).toBe(true);
    expect(isPrintableKey("Z")).toBe(true);
    expect(isPrintableKey("9")).toBe(true);
    expect(isPrintableKey("é")).toBe(true);
    expect(isPrintableKey(" ")).toBe(true);
    expect(isPrintableKey("Enter")).toBe(false);
    expect(isPrintableKey("ArrowUp")).toBe(false);
    expect(isPrintableKey("")).toBe(false);
  });

  it("strokeFromEvent folds Cmd/Ctrl into `mod`", () => {
    expect(
      strokeFromEvent({ key: "c", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }),
    ).toEqual({ key: "c", mod: true, shift: false, alt: false });
    expect(
      strokeFromEvent({ key: "z", metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }),
    ).toEqual({ key: "z", mod: true, shift: true, alt: false });
  });
});

/* --------- proof: every mouse action has a keyboard equivalent ----------- */

describe("keyboard/mouse parity", () => {
  it("covers every interactive intent kind reachable via keyboard", () => {
    const reachable = new Set<GridIntent["type"]>();
    const strokes: Array<[KeyStroke, "browsing" | "editing"]> = [
      [{ key: "ArrowDown" }, "browsing"],
      [{ key: "ArrowDown", shift: true }, "browsing"],
      [{ key: "Tab" }, "browsing"],
      [{ key: "Enter" }, "browsing"],
      [{ key: "F2" }, "browsing"],
      [{ key: "a" }, "browsing"],
      [{ key: "Enter" }, "editing"],
      [{ key: "Escape" }, "editing"],
      [{ key: "Delete" }, "browsing"],
      [{ key: "a", mod: true }, "browsing"],
      [{ key: "c", mod: true }, "browsing"],
      [{ key: "x", mod: true }, "browsing"],
      [{ key: "v", mod: true }, "browsing"],
      [{ key: "d", mod: true }, "browsing"],
      [{ key: "r", mod: true }, "browsing"],
      [{ key: "z", mod: true }, "browsing"],
      [{ key: "z", mod: true, shift: true }, "browsing"],
      [{ key: "Home", mod: true }, "browsing"],
    ];
    for (const [stroke, mode] of strokes) {
      reachable.add(resolveKeyIntent(stroke, mode).type);
    }
    // Mouse gestures map to: navigation (move/extend), edit (editStart),
    // clear, select-all, copy, cut, paste, fill (down/right), undo, redo,
    // corner jump, cancel, tab, commitMove.
    for (const kind of [
      "move",
      "extend",
      "tab",
      "commitMove",
      "editStart",
      "editStartWith",
      "cancel",
      "clear",
      "selectAll",
      "copy",
      "cut",
      "paste",
      "fillDown",
      "fillRight",
      "undo",
      "redo",
      "jump",
    ] as const) {
      expect(reachable.has(kind)).toBe(true);
    }
  });
});
