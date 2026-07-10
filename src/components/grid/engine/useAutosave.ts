/**
 * DealSheet grid — React hook binding the pure `AutosaveQueue` to an injected
 * `OnSave`, with optimistic updates, rollback on hard failure, and per-row
 * `updatedAt` conflict detection.
 *
 * The hook owns NO row data — rows live in the caller's grid state. The caller
 * gives us:
 *   - `onSave(rowId, patch)`   the persistence callback
 *   - `applyPatch(rowId, patch)` how to write a patch into grid state (optimistic)
 *   - `getRow(rowId)`          read a current row snapshot (for rollback + conflict)
 *
 * We drive the queue, mirror its `RowSaveState` map into React state, capture a
 * pre-edit snapshot for rollback, and compare `updatedAt` before/after each
 * save to surface stale-write conflicts.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GridRow, OnSave, RowSaveState } from "@/components/grid/types";
import {
  AutosaveQueue,
  type AutosaveEnv,
  type BackoffConfig,
} from "@/components/grid/engine/autosave";

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

/** A row that carries an optimistic-concurrency token. */
export interface Versioned {
  /** Server-updated timestamp (epoch ms or ISO string). */
  updatedAt?: number | string;
}

export interface UseAutosaveOptions<Row extends GridRow> {
  /** Injected persistence callback. */
  onSave: OnSave<Row>;
  /**
   * Optimistically write `patch` into grid state. Called BEFORE the save so the
   * UI updates immediately. Must be a stable reference or memoized upstream.
   */
  applyPatch: (rowId: string, patch: Partial<Row>) => void;
  /**
   * Read the current snapshot of a row from grid state. Used to capture a
   * rollback baseline and to read `updatedAt` for conflict detection. Return
   * `undefined` if the row is unknown.
   */
  getRow: (rowId: string) => Row | undefined;
  /** Debounce window (ms) before a coalesced row flushes. */
  debounceMs?: number;
  /** Retry/backoff tuning overrides. */
  backoff?: Partial<BackoffConfig>;
  /** Injectable timer/clock (defaults to real timers). Primarily for tests. */
  env?: AutosaveEnv;
  /**
   * Compare the `updatedAt` captured before a save against the row's current
   * `updatedAt` after the save resolves. Return true when they DIVERGED in a
   * way that means someone else wrote the row (a conflict). Defaults to a
   * strict, order-independent comparison of the two tokens.
   */
  detectConflict?: (before: Row | undefined, after: Row | undefined) => boolean;
}

/** Per-row status enriched with a `conflict` flag. */
export interface RowStatus extends RowSaveState {
  /** True when a stale-write (updatedAt) conflict was detected on last save. */
  conflict: boolean;
}

export interface UseAutosaveResult<Row extends GridRow> {
  /** Queue an optimistic edit for a row (coalesced + debounced). */
  save: (rowId: string, patch: Partial<Row>) => void;
  /** Flush a row now, or every row when `rowId` is omitted. */
  flush: (rowId?: string) => Promise<void>;
  /** Per-row save state + conflict flag, mirrored into React state. */
  rowStates: Record<string, RowStatus>;
  /** Convenience reader for a single row (idle + no conflict when unknown). */
  getRowStatus: (rowId: string) => RowStatus;
  /** True when any row is mid-save. */
  isSaving: boolean;
  /** True when any row is in an error state. */
  hasErrors: boolean;
  /** Clear a row's conflict flag (e.g. after the user resolves it). */
  clearConflict: (rowId: string) => void;
}

const IDLE_STATUS: RowStatus = { status: "idle", conflict: false };

/* -------------------------------------------------------------------------- */
/*  Hook                                                                      */
/* -------------------------------------------------------------------------- */

export function useAutosave<Row extends GridRow>(
  options: UseAutosaveOptions<Row>,
): UseAutosaveResult<Row> {
  const {
    onSave,
    applyPatch,
    getRow,
    debounceMs,
    backoff,
    env,
    detectConflict,
  } = options;

  // Keep the latest callbacks in refs so the queue (built once) always calls
  // through to fresh closures without being recreated on every render.
  const onSaveRef = useLatest(onSave);
  const applyPatchRef = useLatest(applyPatch);
  const getRowRef = useLatest(getRow);
  const detectConflictRef = useLatest(detectConflict ?? defaultDetectConflict);

  const [rowStates, setRowStates] = useState<Record<string, RowStatus>>({});
  const conflictsRef = useRef<Record<string, boolean>>({});

  /**
   * Rollback baselines: the row snapshot captured the FIRST time we enqueue an
   * edit for a row while it is clean. On hard failure we restore this and drop
   * the baseline; on success we drop it (the optimistic value is now truth).
   */
  const baselineRef = useRef<Map<string, Row | undefined>>(new Map());
  /** The `updatedAt` we expect the server to have started from, per row. */
  const expectedVersionRef = useRef<Map<string, number | string | undefined>>(
    new Map(),
  );

  // Reducer-ish merge that also folds in the conflict flag.
  const mergeState = useCallback(
    (rowId: string, next: RowSaveState) => {
      setRowStates((prev) => {
        const conflict = conflictsRef.current[rowId] ?? false;
        const merged: RowStatus = { ...next, conflict };
        const existing = prev[rowId];
        if (
          existing &&
          existing.status === merged.status &&
          existing.error === merged.error &&
          existing.conflict === merged.conflict
        ) {
          return prev;
        }
        return { ...prev, [rowId]: merged };
      });
    },
    [],
  );

  // Latest-value refs for the two callbacks the queue invokes. `mergeState` is
  // already defined above; `rollback` is defined below and its ref is synced in
  // an effect. Routing both through refs keeps the queue closures stable and
  // avoids any definition-order coupling.
  const mergeStateRef = useLatest(mergeState);
  const rollbackRef = useRef<(rowId: string) => void>(() => {});

  // The queue is built exactly once per mount and driven entirely through the
  // latest-value refs, so it never needs to be recreated. It lives in a ref and
  // is built lazily by `getQueue()`, which is only ever called from callbacks
  // and effects (never during render) — so no `ref.current` is read in the
  // render body. debounce/backoff/env are stable for a mount by contract.
  const queueRef = useRef<AutosaveQueue<Row> | null>(null);
  const getQueue = useCallback((): AutosaveQueue<Row> => {
    let q = queueRef.current;
    if (q === null) {
      q = new AutosaveQueue<Row>({
        debounceMs,
        backoff,
        env,
        onSave: async (rowId, patch) => {
          // Capture the version we're saving from for conflict detection.
          const before = getRowRef.current(rowId);
          try {
            await onSaveRef.current(rowId, patch);
          } catch (err) {
            // Hard failures bubble to the queue's retry logic; when it finally
            // gives up it reports an "error" state and we roll back there.
            throw err;
          }
          // Success: check for a stale-write conflict, then settle baselines.
          const after = getRowRef.current(rowId);
          const conflicted = detectConflictRef.current(before, after);
          if (conflicted) {
            conflictsRef.current[rowId] = true;
          }
          baselineRef.current.delete(rowId);
          expectedVersionRef.current.delete(rowId);
        },
        onStateChange: (rowId, state) => {
          if (state.status === "error") {
            // The queue only emits a terminal "error" after exhausting retries
            // for the in-flight patch; roll the optimistic edit back.
            rollbackRef.current(rowId);
          }
          mergeStateRef.current(rowId, state);
        },
      });
      queueRef.current = q;
    }
    return q;
  }, [
    debounceMs,
    backoff,
    env,
    getRowRef,
    onSaveRef,
    detectConflictRef,
    mergeStateRef,
    rollbackRef,
  ]);

  const rollback = useCallback(
    (rowId: string) => {
      const baseline = baselineRef.current.get(rowId);
      if (baselineRef.current.has(rowId)) {
        const current = getRowRef.current(rowId);
        if (baseline) {
          // Restore every key that the baseline knew about.
          applyPatchRef.current(rowId, baseline as Partial<Row>);
        } else if (current) {
          // Row was created by the optimistic edit; nothing sensible to restore
          // key-wise, so leave the current values and just surface the error.
        }
        baselineRef.current.delete(rowId);
        expectedVersionRef.current.delete(rowId);
      }
    },
    [getRowRef, applyPatchRef],
  );

  // Keep the queue's error-rollback pointer aimed at the latest `rollback`.
  useEffect(() => {
    rollbackRef.current = rollback;
  }, [rollback]);

  const save = useCallback(
    (rowId: string, patch: Partial<Row>) => {
      // Capture a rollback baseline the first time this row goes dirty.
      if (!baselineRef.current.has(rowId)) {
        const snapshot = getRowRef.current(rowId);
        baselineRef.current.set(rowId, snapshot ? { ...snapshot } : undefined);
        expectedVersionRef.current.set(rowId, versionOf(snapshot));
      }
      // Optimistically apply, then enqueue the persistence.
      applyPatchRef.current(rowId, patch);
      getQueue().enqueue(rowId, patch);
    },
    [getQueue, getRowRef, applyPatchRef],
  );

  const flush = useCallback(
    async (rowId?: string) => {
      const queue = getQueue();
      await queue.flush(rowId);
      await queue.whenIdle();
    },
    [getQueue],
  );

  const clearConflict = useCallback(
    (rowId: string) => {
      if (!conflictsRef.current[rowId]) return;
      delete conflictsRef.current[rowId];
      setRowStates((prev) => {
        const existing = prev[rowId];
        if (!existing || !existing.conflict) return prev;
        return { ...prev, [rowId]: { ...existing, conflict: false } };
      });
    },
    [],
  );

  const getRowStatus = useCallback(
    (rowId: string): RowStatus => rowStates[rowId] ?? IDLE_STATUS,
    [rowStates],
  );

  // Tear the queue down on unmount: cancel timers, drop pending patches.
  useEffect(() => {
    return () => queueRef.current?.dispose();
  }, []);

  const isSaving = useMemo(
    () => Object.values(rowStates).some((s) => s.status === "saving"),
    [rowStates],
  );
  const hasErrors = useMemo(
    () => Object.values(rowStates).some((s) => s.status === "error"),
    [rowStates],
  );

  return {
    save,
    flush,
    rowStates,
    getRowStatus,
    isSaving,
    hasErrors,
    clearConflict,
  };
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/** Read the optimistic-concurrency token off a row, if present. */
function versionOf(row: unknown): number | string | undefined {
  if (row && typeof row === "object" && "updatedAt" in row) {
    const v = (row as Versioned).updatedAt;
    if (typeof v === "number" || typeof v === "string") return v;
  }
  return undefined;
}

/**
 * Default conflict detector: a conflict exists when both snapshots carry an
 * `updatedAt` and they differ. If either is missing a token we assume no
 * conflict (the domain isn't using optimistic concurrency).
 */
function defaultDetectConflict<Row extends GridRow>(
  before: Row | undefined,
  after: Row | undefined,
): boolean {
  const a = versionOf(before);
  const b = versionOf(after);
  if (a === undefined || b === undefined) return false;
  return a !== b;
}

/** Keep a mutable ref pointed at the latest value, synced after render. */
function useLatest<T>(value: T): { current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
