/**
 * DealSheet grid — React hook over the pure `commandStack`, wired to the grid's
 * row-state setter and (optionally) the autosave `save` callback.
 *
 * The hook owns the undo/redo history. It exposes `record` (push a command as
 * the user edits) and `undo` / `redo` (which mutate rows through the injected
 * setter and re-persist the touched cells). A multi-cell paste or fill is
 * recorded as ONE command via the paste/fill command builders, so it undoes
 * atomically.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  CellChange,
  CellCoord,
  CellRange,
  GridCommand,
  GridRow,
} from "@/components/grid/types";
import {
  apply,
  canRedo as stackCanRedo,
  canUndo as stackCanUndo,
  changesOf,
  createCommandStack,
  makeBulkCommand,
  makeCellEditCommand,
  makeFillCommand,
  makePasteCommand,
  peekRedo,
  peekUndo,
  push,
  redo as stackRedo,
  undo as stackUndo,
  type CommandStack,
} from "@/components/grid/engine/commandStack";

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

export interface UseUndoRedoOptions<Row extends GridRow> {
  /**
   * Apply a fully-rebuilt rows array to grid state. Called with the result of
   * `apply(command, rows)` during undo/redo. Receives an updater so it composes
   * with `useState`'s functional form.
   */
  setRows: (updater: (rows: Row[]) => Row[]) => void;
  /**
   * Optional persistence hook. Called for each row touched by an undo/redo with
   * the reverted/replayed patch, so the change is saved. Typically the `save`
   * from `useAutosave`. When omitted, undo/redo only mutates local state.
   */
  persist?: (rowId: string, patch: Partial<Row>) => void;
  /** History depth cap. */
  limit?: number;
}

export interface UseUndoRedoResult<Row extends GridRow> {
  /** Record a single-cell edit. No-ops (prev === next) are ignored. */
  recordEdit: (coord: CellCoord, prev: unknown, next: unknown) => void;
  /** Record a multi-cell paste as ONE command. No-op pastes are ignored. */
  recordPaste: (anchor: CellCoord, changes: CellChange[]) => void;
  /** Record a fill as ONE command. No-op fills are ignored. */
  recordFill: (
    source: CellRange,
    target: CellRange,
    changes: CellChange[],
  ) => void;
  /** Record an arbitrary labeled bulk change as ONE command. */
  recordBulk: (label: string, changes: CellChange[]) => void;
  /** Push an already-built command (advanced). No-op-safe. */
  record: (command: GridCommand | null) => void;
  /** Undo the most recent command; mutates rows + re-persists. */
  undo: () => void;
  /** Redo the most recently undone command; mutates rows + re-persists. */
  redo: () => void;
  /** Discard all history. */
  clear: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Label of the next undo target (for tooltips), if any. */
  undoLabel: string | undefined;
  /** Label of the next redo target (for tooltips), if any. */
  redoLabel: string | undefined;
}

/* -------------------------------------------------------------------------- */
/*  Hook                                                                      */
/* -------------------------------------------------------------------------- */

export function useUndoRedo<Row extends GridRow>(
  options: UseUndoRedoOptions<Row>,
): UseUndoRedoResult<Row> {
  const { setRows, persist, limit } = options;

  const setRowsRef = useLatest(setRows);
  const persistRef = useLatest(persist);

  const [stack, setStack] = useState<CommandStack>(() =>
    createCommandStack(limit),
  );

  const record = useCallback((command: GridCommand | null) => {
    if (command === null) return;
    setStack((prev) => push(prev, command));
  }, []);

  const recordEdit = useCallback(
    (coord: CellCoord, prev: unknown, next: unknown) => {
      record(makeCellEditCommand(coord, prev, next));
    },
    [record],
  );

  const recordPaste = useCallback(
    (anchor: CellCoord, changes: CellChange[]) => {
      record(makePasteCommand(anchor, changes));
    },
    [record],
  );

  const recordFill = useCallback(
    (source: CellRange, target: CellRange, changes: CellChange[]) => {
      record(makeFillCommand(source, target, changes));
    },
    [record],
  );

  const recordBulk = useCallback(
    (label: string, changes: CellChange[]) => {
      record(makeBulkCommand(label, changes));
    },
    [record],
  );

  /** Apply a command to rows + persist each touched cell's new values. */
  const realize = useCallback((command: GridCommand) => {
    setRowsRef.current((rows) => apply(command, rows));
    const persistFn = persistRef.current;
    if (persistFn) {
      // Group per-row patches so each row persists once.
      const patchByRow = new Map<string, Record<string, unknown>>();
      for (const change of changesOf(command)) {
        const { rowId, colKey } = change.coord;
        let patch = patchByRow.get(rowId);
        if (!patch) {
          patch = {};
          patchByRow.set(rowId, patch);
        }
        patch[colKey] = change.next;
      }
      for (const [rowId, patch] of patchByRow) {
        persistFn(rowId, patch as Partial<Row>);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undo = useCallback(() => {
    setStack((prev) => {
      const step = stackUndo(prev);
      if (step.applied) realize(step.applied);
      return step.stack;
    });
  }, [realize]);

  const redo = useCallback(() => {
    setStack((prev) => {
      const step = stackRedo(prev);
      if (step.applied) realize(step.applied);
      return step.stack;
    });
  }, [realize]);

  const clear = useCallback(() => {
    setStack((prev) => createCommandStack(prev.limit));
  }, []);

  const canUndo = stackCanUndo(stack);
  const canRedo = stackCanRedo(stack);
  const undoLabel = useMemo(() => commandLabel(peekUndo(stack)), [stack]);
  const redoLabel = useMemo(() => commandLabel(peekRedo(stack)), [stack]);

  return {
    recordEdit,
    recordPaste,
    recordFill,
    recordBulk,
    record,
    undo,
    redo,
    clear,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
  };
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/** A short human label for a command, for undo/redo tooltips. */
export function commandLabel(command: GridCommand | undefined): string | undefined {
  if (!command) return undefined;
  switch (command.kind) {
    case "cell-edit":
      return "Edit cell";
    case "paste-block": {
      const n = command.changes.length;
      return `Paste ${n} cell${n === 1 ? "" : "s"}`;
    }
    case "fill": {
      const n = command.changes.length;
      return `Fill ${n} cell${n === 1 ? "" : "s"}`;
    }
    case "bulk":
      return command.label;
  }
}

/** Keep a mutable ref pointed at the latest value, synced after render. */
function useLatest<T>(value: T): { current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
