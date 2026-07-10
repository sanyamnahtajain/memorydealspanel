/**
 * DealSheet grid — pure per-row autosave queue.
 *
 * Edits are enqueued as partial row patches. Patches to the SAME row coalesce
 * (later keys win, all keys accumulate) so a burst of cell edits flushes as a
 * single `onSave(rowId, patch)`. Flushes are debounced. Each row saves
 * independently: a slow or failing row never blocks the others, and failures
 * retry with exponential backoff.
 *
 * The scheduling logic lives in `AutosaveQueue`, whose timer + clock are
 * INJECTABLE so tests can drive it deterministically with fake timers. The
 * top-level helpers (`coalescePatch`, `nextBackoffDelay`, …) are pure and
 * independently testable.
 */

import type { GridRow, RowSaveState } from "@/components/grid/types";

/* -------------------------------------------------------------------------- */
/*  Pure helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Merge a new patch on top of a pending one for the same row: keys present in
 * `next` override `base`, all other keys are retained. Returns a fresh object;
 * inputs are not mutated.
 */
export function coalescePatch<Row extends GridRow>(
  base: Partial<Row> | undefined,
  next: Partial<Row>,
): Partial<Row> {
  return { ...(base ?? {}), ...next };
}

/** Tuning for retry / backoff behavior. */
export interface BackoffConfig {
  /** Delay before the first retry, in ms. */
  baseDelayMs: number;
  /** Multiplier applied per attempt (2 => 1x, 2x, 4x, …). */
  factor: number;
  /** Upper bound on any single retry delay, in ms. */
  maxDelayMs: number;
  /** How many times to retry a failed save before giving up (hard failure). */
  maxRetries: number;
}

/** Sensible production defaults for autosave backoff. */
export const DEFAULT_BACKOFF: BackoffConfig = {
  baseDelayMs: 500,
  factor: 2,
  maxDelayMs: 15_000,
  maxRetries: 4,
};

/**
 * Exponential backoff delay for a given retry attempt (0-based: attempt 0 is
 * the first retry). Clamped to `maxDelayMs`. Deterministic — no jitter — so
 * tests can assert exact timings.
 */
export function nextBackoffDelay(attempt: number, config: BackoffConfig): number {
  const raw = config.baseDelayMs * Math.pow(config.factor, Math.max(0, attempt));
  return Math.min(raw, config.maxDelayMs);
}

/** Default debounce window before a coalesced row patch is flushed. */
export const DEFAULT_DEBOUNCE_MS = 600;

/* -------------------------------------------------------------------------- */
/*  Injectable environment                                                    */
/* -------------------------------------------------------------------------- */

/** A cancelable scheduled callback. */
export type CancelTimer = () => void;

/**
 * Minimal timer + clock the queue depends on. In production these bind to
 * `setTimeout` / `Date.now`; in tests they bind to fake timers for determinism.
 */
export interface AutosaveEnv {
  /** Schedule `fn` after `ms`; returns a canceler. */
  setTimer: (fn: () => void, ms: number) => CancelTimer;
  /** Current epoch ms. */
  now: () => number;
}

/** The default environment, wired to the platform's real timers/clock. */
export function realEnv(): AutosaveEnv {
  return {
    setTimer: (fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    now: () => Date.now(),
  };
}

/* -------------------------------------------------------------------------- */
/*  Queue configuration & row bookkeeping                                     */
/* -------------------------------------------------------------------------- */

/** Callback invoked whenever a row's `RowSaveState` changes. */
export type RowStateListener = (rowId: string, state: RowSaveState) => void;

/** Options for an `AutosaveQueue`. */
export interface AutosaveOptions<Row extends GridRow> {
  /** Async persistence callback. Rejects on failure. */
  onSave: (rowId: string, patch: Partial<Row>) => Promise<void>;
  /** Debounce window in ms before a coalesced row flushes. */
  debounceMs?: number;
  /** Retry/backoff tuning. */
  backoff?: Partial<BackoffConfig>;
  /** Injectable timer + clock (defaults to real timers). */
  env?: AutosaveEnv;
  /** Notified on every per-row state transition. */
  onStateChange?: RowStateListener;
}

/** Internal per-row scheduling record. */
interface RowEntry<Row extends GridRow> {
  /** Coalesced, not-yet-in-flight patch. */
  pending: Partial<Row> | undefined;
  /** Patch currently being persisted (kept for retry). */
  inFlight: Partial<Row> | undefined;
  /** Retry attempt counter for the in-flight patch. */
  attempt: number;
  /** Canceler for the row's active debounce / backoff timer, if any. */
  cancel: CancelTimer | undefined;
  /** Public save state. */
  state: RowSaveState;
}

const IDLE_STATE: RowSaveState = { status: "idle" };

/* -------------------------------------------------------------------------- */
/*  AutosaveQueue                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Per-row debounced save queue with retry/backoff. Deterministic under an
 * injected `env`. Rows are fully independent: each has its own debounce timer,
 * in-flight guard, and backoff schedule.
 */
export class AutosaveQueue<Row extends GridRow = GridRow> {
  private readonly onSave: AutosaveOptions<Row>["onSave"];
  private readonly debounceMs: number;
  private readonly backoff: BackoffConfig;
  private readonly env: AutosaveEnv;
  private readonly onStateChange?: RowStateListener;
  private readonly rows = new Map<string, RowEntry<Row>>();
  /** Tracks in-flight save promises so `whenIdle` can await them. */
  private readonly saving = new Set<Promise<void>>();
  private disposed = false;

  constructor(options: AutosaveOptions<Row>) {
    this.onSave = options.onSave;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.backoff = { ...DEFAULT_BACKOFF, ...(options.backoff ?? {}) };
    this.env = options.env ?? realEnv();
    this.onStateChange = options.onStateChange;
  }

  /** Snapshot of a row's current save state (idle when unknown). */
  getState(rowId: string): RowSaveState {
    return this.rows.get(rowId)?.state ?? IDLE_STATE;
  }

  /** All tracked row states as a plain record. */
  snapshot(): Record<string, RowSaveState> {
    const out: Record<string, RowSaveState> = {};
    for (const [id, entry] of this.rows) out[id] = entry.state;
    return out;
  }

  /** True when a row has queued or in-flight work. */
  isPending(rowId: string): boolean {
    const entry = this.rows.get(rowId);
    if (!entry) return false;
    return entry.pending !== undefined || entry.inFlight !== undefined;
  }

  /** True when no row has queued or in-flight work. */
  isEmpty(): boolean {
    for (const entry of this.rows.values()) {
      if (entry.pending !== undefined || entry.inFlight !== undefined) {
        return false;
      }
    }
    return true;
  }

  /**
   * Enqueue a patch for a row. Coalesces with any pending patch for that row
   * and (re)arms the debounce timer. Enqueuing while a save is in flight simply
   * accumulates into `pending`; it flushes after the current save settles.
   */
  enqueue(rowId: string, patch: Partial<Row>): void {
    if (this.disposed) return;
    const entry = this.ensure(rowId);
    entry.pending = coalescePatch(entry.pending, patch);
    // Only (re)arm the debounce when nothing is currently in flight; if a save
    // is running, the post-save hook will pick the pending patch up.
    if (entry.inFlight === undefined) {
      this.armDebounce(rowId);
    }
  }

  /**
   * Flush a specific row now (bypassing debounce), or every row when `rowId`
   * is omitted. Returns a promise resolving once the triggered save(s) settle.
   * If a save is already in flight for a row, its pending patch is left to the
   * in-flight completion hook and not double-fired.
   */
  async flush(rowId?: string): Promise<void> {
    if (rowId !== undefined) {
      return this.flushRow(rowId);
    }
    const ids = [...this.rows.keys()];
    await Promise.all(ids.map((id) => this.flushRow(id)));
  }

  /**
   * Resolve once all in-flight saves have settled AND no pending work remains.
   * Useful in tests after advancing fake timers.
   */
  async whenIdle(): Promise<void> {
    // Drain repeatedly: a save can enqueue follow-up work via coalescing.
    while (this.saving.size > 0) {
      await Promise.allSettled([...this.saving]);
    }
  }

  /**
   * Cancel all timers and drop pending patches. In-flight saves are left to
   * settle but their results are ignored. The queue rejects further enqueues.
   */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.rows.values()) {
      entry.cancel?.();
      entry.cancel = undefined;
      entry.pending = undefined;
    }
  }

  /* ----------------------------- internals ------------------------------- */

  private ensure(rowId: string): RowEntry<Row> {
    let entry = this.rows.get(rowId);
    if (!entry) {
      entry = {
        pending: undefined,
        inFlight: undefined,
        attempt: 0,
        cancel: undefined,
        state: IDLE_STATE,
      };
      this.rows.set(rowId, entry);
    }
    return entry;
  }

  private setState(rowId: string, state: RowSaveState): void {
    const entry = this.rows.get(rowId);
    if (!entry) return;
    entry.state = state;
    this.onStateChange?.(rowId, state);
  }

  private armDebounce(rowId: string): void {
    const entry = this.rows.get(rowId);
    if (!entry) return;
    entry.cancel?.();
    entry.cancel = this.env.setTimer(() => {
      entry.cancel = undefined;
      void this.flushRow(rowId);
    }, this.debounceMs);
  }

  private flushRow(rowId: string): Promise<void> {
    const entry = this.rows.get(rowId);
    if (!entry) return Promise.resolve();
    // Cancel any armed debounce; we're flushing now.
    entry.cancel?.();
    entry.cancel = undefined;
    // A save already running — the completion hook will drain `pending`.
    if (entry.inFlight !== undefined) return Promise.resolve();
    if (entry.pending === undefined) return Promise.resolve();

    entry.inFlight = entry.pending;
    entry.pending = undefined;
    entry.attempt = 0;
    return this.runSave(rowId);
  }

  private runSave(rowId: string): Promise<void> {
    const entry = this.rows.get(rowId);
    if (!entry || entry.inFlight === undefined) return Promise.resolve();
    const patch = entry.inFlight;
    this.setState(rowId, { status: "saving" });

    const promise = Promise.resolve()
      .then(() => this.onSave(rowId, patch))
      .then(
        () => this.onSaveSuccess(rowId),
        (err) => this.onSaveFailure(rowId, err),
      )
      .finally(() => {
        this.saving.delete(promise);
      });
    this.saving.add(promise);
    return promise;
  }

  private onSaveSuccess(rowId: string): void {
    const entry = this.rows.get(rowId);
    if (!entry) return;
    entry.inFlight = undefined;
    entry.attempt = 0;
    if (entry.pending !== undefined) {
      // New edits landed during the save — flush them (fresh debounce-free).
      entry.inFlight = entry.pending;
      entry.pending = undefined;
      void this.runSave(rowId);
      return;
    }
    this.setState(rowId, { status: "saved" });
  }

  private onSaveFailure(rowId: string, err: unknown): void {
    const entry = this.rows.get(rowId);
    if (!entry) return;
    const message = errorMessage(err);

    if (entry.attempt >= this.backoff.maxRetries) {
      // Hard failure: give up, keep the (failed) patch merged back into pending
      // so a later manual flush or fresh edit can retry it.
      entry.pending = coalescePatch(entry.inFlight, entry.pending ?? {});
      entry.inFlight = undefined;
      entry.attempt = 0;
      this.setState(rowId, { status: "error", error: message });
      return;
    }

    const delay = nextBackoffDelay(entry.attempt, this.backoff);
    entry.attempt += 1;
    this.setState(rowId, { status: "error", error: message });
    entry.cancel?.();
    entry.cancel = this.env.setTimer(() => {
      entry.cancel = undefined;
      const cur = this.rows.get(rowId);
      if (!cur || cur.inFlight === undefined) return;
      void this.runSave(rowId);
    }, delay);
  }
}

/* -------------------------------------------------------------------------- */
/*  Error helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Save failed";
}
