/**
 * Pure Excel-style keyboard model for the DealSheet grid.
 *
 * `resolveKeyIntent` maps a normalized keystroke to a declarative `GridIntent`
 * — with **no DOM and no React**. The React hook (`useGridKeyboard`) translates
 * live `KeyboardEvent`s into `KeyStroke`s, calls this function, then dispatches
 * the returned intent to selection / edit / clipboard / history callbacks.
 *
 * Keeping the mapping pure means the entire keyboard contract is unit-testable
 * (see `keyboard.test.ts`) and the exact Excel semantics live in one place.
 */

import type { MoveDir, MoveStep } from "./selection";

/* -------------------------------------------------------------------------- */
/*  Input: a normalized keystroke                                             */
/* -------------------------------------------------------------------------- */

/**
 * A platform-normalized keystroke. `mod` is the primary command modifier —
 * Cmd on macOS, Ctrl elsewhere — so callers pass `event.metaKey || event.ctrlKey`
 * and the model stays platform-agnostic.
 */
export interface KeyStroke {
  /** `event.key` (e.g. "ArrowDown", "Enter", "a", "F2"). */
  key: string;
  /** Shift held. */
  shift?: boolean;
  /** Alt / Option held. */
  alt?: boolean;
  /** Primary command modifier (Cmd on mac, Ctrl elsewhere). */
  mod?: boolean;
}

/** Whether the grid is currently editing a cell (changes key semantics). */
export type EditingState = "browsing" | "editing";

/* -------------------------------------------------------------------------- */
/*  Output: a declarative intent                                              */
/* -------------------------------------------------------------------------- */

/**
 * The declarative result of a keystroke. The hook maps each variant onto the
 * appropriate injected callback; this union is the full keyboard contract.
 */
export type GridIntent =
  /** No grid-level handling — let the event through (e.g. plain typing while editing). */
  | { type: "none" }
  /** Move the active cell. */
  | { type: "move"; dir: MoveDir; step: MoveStep }
  /** Extend the rectangular selection. */
  | { type: "extend"; dir: MoveDir; step: MoveStep }
  /** Move to the next / previous cell (Tab / Shift+Tab wrap within a row). */
  | { type: "tab"; dir: "next" | "prev" }
  /** Commit the current edit (if any) and move down (Enter) or up (Shift+Enter). */
  | { type: "commitMove"; dir: "down" | "up" }
  /** Enter edit mode without seeding a value (F2 / double-click equivalent). */
  | { type: "editStart" }
  /** Enter edit mode seeded with a typed character (start-typing-to-edit). */
  | { type: "editStartWith"; char: string }
  /** Commit the in-progress edit and stay on the cell. */
  | { type: "editCommit" }
  /** Cancel the in-progress edit / collapse the selection. */
  | { type: "cancel" }
  /** Clear the contents of the selected cells (Delete / Backspace). */
  | { type: "clear" }
  /** Select the whole grid. */
  | { type: "selectAll" }
  /** Copy the selection to the clipboard. */
  | { type: "copy" }
  /** Cut the selection (copy then clear). */
  | { type: "cut" }
  /** Paste from the clipboard at the active cell. */
  | { type: "paste" }
  /** Fill-down: replicate the top row of the selection to the rows below (Ctrl+D). */
  | { type: "fillDown" }
  /** Fill-right: replicate the left column across the selection (Ctrl+R). */
  | { type: "fillRight" }
  /** Undo the last command. */
  | { type: "undo" }
  /** Redo the last undone command. */
  | { type: "redo" }
  /** Jump to the top-left / bottom-right of the grid (Ctrl+Home / Ctrl+End). */
  | { type: "jump"; corner: "start" | "end"; extend: boolean };

/* -------------------------------------------------------------------------- */
/*  Key classification                                                        */
/* -------------------------------------------------------------------------- */

const ARROW_DIRS: Record<string, MoveDir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/**
 * True when `key` represents a single printable character that should begin
 * editing (letters, digits, punctuation, space). Named keys ("Enter", "F2",
 * "ArrowUp", …) are multi-character and excluded.
 */
export function isPrintableKey(key: string): boolean {
  // Exactly one code point, and not a control character. Space counts.
  if ([...key].length !== 1) return false;
  const code = key.codePointAt(0) ?? 0;
  return code >= 0x20 && code !== 0x7f;
}

/* -------------------------------------------------------------------------- */
/*  The resolver                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a keystroke into a `GridIntent`, given whether the grid is currently
 * editing a cell. This is the single source of truth for the keyboard model.
 *
 * Semantics (Excel-like):
 * - **Browsing**: arrows move; Shift+arrow extends; Ctrl+arrow jumps to edge.
 *   Tab / Shift+Tab step horizontally; Enter / Shift+Enter step vertically.
 *   F2 or any printable char starts editing; Delete/Backspace clears; Esc
 *   collapses. Ctrl+A selects all; Ctrl+C/X/V copy/cut/paste; Ctrl+D/R fill;
 *   Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) undo/redo; Ctrl+Home/End jump corners.
 * - **Editing**: Enter / Tab commit and move; Esc cancels; arrows/other keys
 *   are left to the editor input (`none`).
 */
export function resolveKeyIntent(
  stroke: KeyStroke,
  editing: EditingState,
): GridIntent {
  const { key } = stroke;
  const shift = !!stroke.shift;
  const mod = !!stroke.mod;
  const alt = !!stroke.alt;

  /* --------------------------- editing mode --------------------------- */
  if (editing === "editing") {
    if (key === "Enter" && !mod && !alt) {
      return { type: "commitMove", dir: shift ? "up" : "down" };
    }
    if (key === "Tab" && !mod && !alt) {
      // Commit is implied by the caller before moving; Tab both commits & moves.
      return { type: "tab", dir: shift ? "prev" : "next" };
    }
    if (key === "Escape") {
      return { type: "cancel" };
    }
    // Everything else (typing, arrows within the input, etc.) stays in the editor.
    return { type: "none" };
  }

  /* --------------------------- browsing mode -------------------------- */

  // Command-modifier combinations first (they take precedence over plain keys).
  if (mod) {
    const lower = key.length === 1 ? key.toLowerCase() : key;
    switch (lower) {
      case "a":
        return { type: "selectAll" };
      case "c":
        return { type: "copy" };
      case "x":
        return { type: "cut" };
      case "v":
        return { type: "paste" };
      case "d":
        return { type: "fillDown" };
      case "r":
        return { type: "fillRight" };
      case "z":
        return shift ? { type: "redo" } : { type: "undo" };
      case "y":
        return { type: "redo" };
      case "Home":
        return { type: "jump", corner: "start", extend: shift };
      case "End":
        return { type: "jump", corner: "end", extend: shift };
    }
    // Ctrl+Arrow → jump to the far edge of that axis (extend when Shift held).
    if (key in ARROW_DIRS) {
      const dir = ARROW_DIRS[key];
      return shift
        ? { type: "extend", dir, step: "edge" }
        : { type: "move", dir, step: "edge" };
    }
    // Unknown mod combo — leave to the browser (e.g. Ctrl+F find).
    return { type: "none" };
  }

  // Plain arrows (+ optional Shift to extend).
  if (key in ARROW_DIRS) {
    const dir = ARROW_DIRS[key];
    return shift
      ? { type: "extend", dir, step: "cell" }
      : { type: "move", dir, step: "cell" };
  }

  switch (key) {
    case "Tab":
      return { type: "tab", dir: shift ? "prev" : "next" };
    case "Enter":
      return { type: "commitMove", dir: shift ? "up" : "down" };
    case "F2":
      return { type: "editStart" };
    case "Escape":
      return { type: "cancel" };
    case "Delete":
    case "Backspace":
      return { type: "clear" };
    case "Home":
      return { type: "jump", corner: "start", extend: shift };
    case "End":
      return { type: "jump", corner: "end", extend: shift };
  }

  // Start-typing-to-edit: a lone printable character (no command modifier).
  if (!alt && isPrintableKey(key)) {
    return { type: "editStartWith", char: key };
  }

  return { type: "none" };
}

/**
 * Convenience: build a `KeyStroke` from a DOM `KeyboardEvent`, folding
 * Cmd/Ctrl into the platform-neutral `mod` flag. Kept here (pure, DOM-typed
 * only via the argument) so both the hook and tests can share it.
 */
export function strokeFromEvent(event: {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): KeyStroke {
  return {
    key: event.key,
    shift: event.shiftKey,
    alt: event.altKey,
    mod: event.metaKey || event.ctrlKey,
  };
}
