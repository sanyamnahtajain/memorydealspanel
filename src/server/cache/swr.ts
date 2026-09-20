import { after } from "next/server";

/**
 * A per-instance stale-while-revalidate cache with single-flight refresh.
 *
 * WHY THIS EXISTS: the home page stalled for ~27 seconds for real customers.
 * A rail on it recomputed an expensive ranking whenever a 15-minute
 * per-instance cache expired, and the page render AWAITED that recompute. On a
 * shared-tier database the recompute took half a minute, every server
 * instance paid it separately, and every request that arrived during it
 * started its own copy of the same query — so the people hit hardest were the
 * ones visiting while the shop was busiest.
 *
 * The three rules that make that impossible:
 *
 *  1. STALE BEATS SLOW. Once a value exists it is returned immediately, however
 *     old, and the refresh happens behind it. A ranking that is 20 minutes old
 *     is indistinguishable from a fresh one; a page that takes 27 seconds is a
 *     customer gone.
 *  2. ONE REFRESH AT A TIME. Concurrent callers share the in-flight promise
 *     instead of each issuing the same query.
 *  3. A COLD START HAS A BUDGET. With nothing cached yet, a caller waits at
 *     most `coldBudgetMs` and then gets `fallback` — the page renders without
 *     the optional extra rather than hanging on it. The compute keeps going
 *     and the next visitor gets the real value.
 *
 * Failures never throw to the caller and never clear a good stale value; they
 * just back off so a struggling database is not asked again on every request.
 */

export interface SwrOptions<T> {
  /** How long a value counts as fresh. */
  ttlMs: number;
  /** Longest a caller with NOTHING cached will wait before getting `fallback`. */
  coldBudgetMs: number;
  /** Returned on a cold timeout or a cold failure. */
  fallback: T;
  /** After a failed compute, wait this long before trying again. */
  retryAfterMs?: number;
  /** For log lines. */
  label: string;
}

interface SwrState<T> {
  value?: { at: number; data: T };
  inflight?: Promise<T>;
  failedAt?: number;
}

const DEFAULT_RETRY_AFTER_MS = 30_000;

const globalForSwr = globalThis as unknown as {
  __mdSwr: Map<string, SwrState<unknown>> | undefined;
};

function stateFor<T>(key: string): SwrState<T> {
  const store = (globalForSwr.__mdSwr ??= new Map());
  let state = store.get(key) as SwrState<T> | undefined;
  if (!state) {
    state = {};
    store.set(key, state as SwrState<unknown>);
  }
  return state;
}

/**
 * Ask the platform to keep this invocation alive until the refresh settles.
 * Without it a serverless instance can be frozen the moment the response is
 * sent, leaving the refresh half-done until some later request thaws it.
 * `after` throws outside a request scope (tests, scripts) — then it is simply
 * not needed.
 */
function keepAlive(promise: Promise<unknown>): void {
  try {
    after(() => promise.then(noop, noop));
  } catch {
    /* no request scope */
  }
}

function noop(): void {}

export function swrCached<T>(
  key: string,
  compute: () => Promise<T>,
  options: SwrOptions<T>,
): Promise<T> {
  const state = stateFor<T>(key);
  const now = Date.now();

  if (state.value && now - state.value.at < options.ttlMs) {
    return Promise.resolve(state.value.data);
  }

  const backingOff =
    state.failedAt !== undefined &&
    now - state.failedAt < (options.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS);

  if (!state.inflight && !backingOff) {
    const started = Date.now();
    const run = compute()
      .then((data) => {
        state.value = { at: Date.now(), data };
        state.failedAt = undefined;
        const took = Date.now() - started;
        if (took > 2_000) {
          console.warn(`[swr] ${options.label} refresh took ${took}ms`);
        }
        return data;
      })
      .finally(() => {
        state.inflight = undefined;
      });
    // Failure bookkeeping lives on a side branch so `run` itself still
    // rejects for the cold caller below, without an unhandled rejection.
    run.catch((error) => {
      state.failedAt = Date.now();
      console.error(`[swr] ${options.label} refresh failed:`, error);
    });
    state.inflight = run;
    keepAlive(run);
  }

  // Rule 1: anything we already have is returned NOW.
  if (state.value) return Promise.resolve(state.value.data);

  // Cold and backing off after a failure — nothing to wait for.
  if (!state.inflight) return Promise.resolve(options.fallback);

  // Rule 3: cold start, bounded wait.
  const inflight = state.inflight;
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(
        `[swr] ${options.label} cold start exceeded ${options.coldBudgetMs}ms — rendering without it`,
      );
      resolve(options.fallback);
    }, options.coldBudgetMs);
    inflight.then(
      (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      () => {
        clearTimeout(timer);
        resolve(options.fallback);
      },
    );
  });
}

/** Test seam: forget everything (or one key). */
export function resetSwrCache(key?: string): void {
  if (key === undefined) globalForSwr.__mdSwr = new Map();
  else globalForSwr.__mdSwr?.delete(key);
}
