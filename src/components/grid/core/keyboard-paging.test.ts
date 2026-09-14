import { describe, expect, it } from "vitest";

import { resolveKeyIntent } from "./keyboard";
import {
  DEFAULT_PAGE_ROWS,
  EMPTY_SELECTION,
  selectionReducer,
  type GridAxes,
} from "./selection";

const browse = (stroke: Parameters<typeof resolveKeyIntent>[0]) =>
  resolveKeyIntent(stroke, "browsing");
const edit = (stroke: Parameters<typeof resolveKeyIntent>[0]) =>
  resolveKeyIntent(stroke, "editing");

/**
 * Keyboard reach across a long grid. The bulk sheet is the surface an operator
 * drives all day, so these are the keys that decide whether they can keep
 * their hands on the keyboard.
 */
describe("PageUp / PageDown", () => {
  it("moves a screenful, and extends with Shift", () => {
    expect(browse({ key: "PageDown" })).toEqual({
      type: "move",
      dir: "down",
      step: "page",
    });
    expect(browse({ key: "PageUp" })).toEqual({
      type: "move",
      dir: "up",
      step: "page",
    });
    expect(browse({ key: "PageDown", shift: true })).toEqual({
      type: "extend",
      dir: "down",
      step: "page",
    });
  });

  it("is ignored while editing — paging must not yank the grid out from under a half-typed value", () => {
    expect(edit({ key: "PageDown" })).toEqual({ type: "none" });
    expect(edit({ key: "PageUp" })).toEqual({ type: "none" });
  });
});

describe("Home / End", () => {
  it("PLAIN goes to the start / end of the ROW (Excel semantics)", () => {
    expect(browse({ key: "Home" })).toEqual({
      type: "move",
      dir: "left",
      step: "edge",
    });
    expect(browse({ key: "End" })).toEqual({
      type: "move",
      dir: "right",
      step: "edge",
    });
  });

  it("extends along the row with Shift", () => {
    expect(browse({ key: "End", shift: true })).toEqual({
      type: "extend",
      dir: "right",
      step: "edge",
    });
  });

  it("still jumps to the whole-grid corners with the command modifier", () => {
    // The point of the change: plain and Ctrl used to do the same thing, so
    // one of the two was wasted. Ctrl must keep the corner jump.
    expect(browse({ key: "Home", mod: true })).toEqual({
      type: "jump",
      corner: "start",
      extend: false,
    });
    expect(browse({ key: "End", mod: true, shift: true })).toEqual({
      type: "jump",
      corner: "end",
      extend: true,
    });
  });
});

describe("a page actually travels a page", () => {
  const axes = (pageRows?: number): GridAxes => ({
    rowIds: Array.from({ length: 100 }, (_, i) => `r${i}`),
    colKeys: ["a", "b", "c"],
    pageRows,
  });

  const at = (row: number) => ({
    ...EMPTY_SELECTION,
    active: { row, col: 0 },
    anchor: { row, col: 0 },
  });

  it("moves by the grid's own visible row count when given one", () => {
    const next = selectionReducer(at(0), axes(25), {
      type: "move",
      dir: "down",
      step: "page",
    });
    expect(next.active?.row).toBe(25);
  });

  it("falls back to a sane default rather than standing still", () => {
    const next = selectionReducer(at(0), axes(undefined), {
      type: "move",
      dir: "down",
      step: "page",
    });
    expect(next.active?.row).toBe(DEFAULT_PAGE_ROWS);
  });

  it("clamps at the ends instead of running off the grid", () => {
    const top = selectionReducer(at(3), axes(25), {
      type: "move",
      dir: "up",
      step: "page",
    });
    expect(top.active?.row).toBe(0);

    const bottom = selectionReducer(at(95), axes(25), {
      type: "move",
      dir: "down",
      step: "page",
    });
    expect(bottom.active?.row).toBe(99);
  });

  it("a zero or negative page size still moves (never a dead key)", () => {
    const next = selectionReducer(at(0), axes(0), {
      type: "move",
      dir: "down",
      step: "page",
    });
    expect(next.active?.row).toBe(1);
  });
});
