"use client";

/**
 * React binding over the pure keyboard model (`./keyboard.ts`).
 *
 * Attach the returned `onKeyDown` handler to the grid's focusable viewport.
 * Each keystroke is normalized, resolved to a `GridIntent`, then routed to the
 * injected callbacks below. Every mouse gesture in the grid has a keyboard
 * equivalent here: navigation, range extension, editing, clear, select-all,
 * clipboard (copy/cut/paste), fill (down/right), undo/redo, and corner jumps.
 *
 * The hook holds no selection state of its own — it composes the
 * `useGridSelection` result with edit / clipboard / history callbacks supplied
 * by the grid shell, so it stays decoupled and testable via `resolveKeyIntent`.
 */

import * as React from "react";
import {
  resolveKeyIntent,
  strokeFromEvent,
  type EditingState,
  type GridIntent,
} from "./keyboard";
import type { MoveDir, MoveStep } from "./selection";

/**
 * The selection surface the keyboard hook drives. This is a structural subset
 * of `UseGridSelectionResult`, so the full selection hook satisfies it directly
 * while tests can pass a lightweight fake.
 */
export interface KeyboardSelectionApi {
  moveActive: (dir: MoveDir, step?: MoveStep) => void;
  extend: (dir: MoveDir, step?: MoveStep) => void;
  selectAll: () => void;
  collapse: () => void;
  jumpTo: (corner: "start" | "end", extend: boolean) => void;
}

/** Injected editor / clipboard / history callbacks. All are optional. */
export interface GridKeyboardCallbacks {
  /** True while a cell editor is open; drives editing-mode key semantics. */
  isEditing: boolean;
  /** Enter edit mode. `char` seeds the editor when the user started typing. */
  onEditStart?: (char?: string) => void;
  /** Commit the in-progress edit (Enter/Tab). Return value ignored. */
  onEditCommit?: () => void;
  /** Cancel the in-progress edit (Esc). */
  onEditCancel?: () => void;
  /** Clear the contents of the current selection (Delete/Backspace). */
  onClear?: () => void;
  /** Tab / Shift+Tab to the next / previous cell (wrapping within a row). */
  onTab?: (dir: "next" | "prev") => void;
  /** Enter / Shift+Enter: commit (if editing) then move down / up. */
  onCommitMove?: (dir: "down" | "up") => void;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onFillDown?: () => void;
  onFillRight?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

export interface UseGridKeyboardOptions
  extends GridKeyboardCallbacks {
  selection: KeyboardSelectionApi;
  /** When false, the handler is a no-op (grid unfocused / disabled). */
  enabled?: boolean;
}

export interface UseGridKeyboardResult {
  /** Attach to the focusable grid viewport. */
  onKeyDown: React.KeyboardEventHandler<HTMLElement>;
  /** The pure resolver, exposed for imperative dispatch / testing. */
  resolve: (
    stroke: Parameters<typeof resolveKeyIntent>[0],
    editing: EditingState,
  ) => GridIntent;
  /** Dispatch an already-resolved intent to the injected callbacks. */
  dispatchIntent: (intent: GridIntent) => boolean;
}

export function useGridKeyboard(
  options: UseGridKeyboardOptions,
): UseGridKeyboardResult {
  // Keep every dependency behind a ref so `onKeyDown` is referentially stable
  // and never needs re-binding to the DOM node on each render. Synced in an
  // effect (never during render) to satisfy the react-hooks refs rule.
  const ref = React.useRef(options);
  React.useEffect(() => {
    ref.current = options;
  });

  const dispatchIntent = React.useCallback((intent: GridIntent): boolean => {
    const o = ref.current;
    const sel = o.selection;

    switch (intent.type) {
      case "none":
        return false;
      case "move":
        sel.moveActive(intent.dir, intent.step);
        return true;
      case "extend":
        sel.extend(intent.dir, intent.step);
        return true;
      case "tab":
        o.onTab?.(intent.dir);
        return true;
      case "commitMove":
        o.onCommitMove?.(intent.dir);
        return true;
      case "editStart":
        o.onEditStart?.();
        return true;
      case "editStartWith":
        o.onEditStart?.(intent.char);
        return true;
      case "editCommit":
        o.onEditCommit?.();
        return true;
      case "cancel":
        if (o.isEditing) o.onEditCancel?.();
        else sel.collapse();
        return true;
      case "clear":
        o.onClear?.();
        return true;
      case "selectAll":
        sel.selectAll();
        return true;
      case "copy":
        o.onCopy?.();
        return true;
      case "cut":
        o.onCut?.();
        return true;
      case "paste":
        o.onPaste?.();
        return true;
      case "fillDown":
        o.onFillDown?.();
        return true;
      case "fillRight":
        o.onFillRight?.();
        return true;
      case "undo":
        o.onUndo?.();
        return true;
      case "redo":
        o.onRedo?.();
        return true;
      case "jump":
        sel.jumpTo(intent.corner, intent.extend);
        return true;
      default: {
        const _never: never = intent;
        return false;
      }
    }
  }, []);

  const onKeyDown = React.useCallback<React.KeyboardEventHandler<HTMLElement>>(
    (event) => {
      const o = ref.current;
      if (o.enabled === false) return;

      const editing: EditingState = o.isEditing ? "editing" : "browsing";
      const intent = resolveKeyIntent(strokeFromEvent(event.nativeEvent), editing);
      if (intent.type === "none") return;

      // The grid handled it — stop the browser's default (scroll, focus move,
      // find, select-all) and keep the event from bubbling to page handlers.
      event.preventDefault();
      event.stopPropagation();
      dispatchIntent(intent);
    },
    [dispatchIntent],
  );

  const resolve = React.useCallback(
    (stroke: Parameters<typeof resolveKeyIntent>[0], editing: EditingState) =>
      resolveKeyIntent(stroke, editing),
    [],
  );

  return { onKeyDown, resolve, dispatchIntent };
}
