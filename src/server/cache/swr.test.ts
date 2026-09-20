import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetSwrCache, swrCached } from "./swr";

const OPTIONS = {
  ttlMs: 1_000,
  coldBudgetMs: 200,
  fallback: "fallback",
  retryAfterMs: 5_000,
  label: "test",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetSwrCache();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * THE INCIDENT THESE GUARD: the home page hung ~27 seconds for customers
 * because a render awaited the refresh of an expired cache, every server
 * instance refreshed separately, and every request during a refresh started
 * its own copy of the same slow query.
 */
describe("swrCached", () => {
  it("serves a fresh value without recomputing", async () => {
    const compute = vi.fn(async () => "v1");
    expect(await swrCached("k", compute, OPTIONS)).toBe("v1");
    expect(await swrCached("k", compute, OPTIONS)).toBe("v1");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("returns a STALE value immediately and refreshes behind it", async () => {
    const slow = deferred<string>();
    const compute = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("old")
      .mockReturnValueOnce(slow.promise);

    await swrCached("k", compute, OPTIONS);
    vi.advanceTimersByTime(OPTIONS.ttlMs + 1);

    // The refresh is a 27-second query. The caller must not notice.
    const result = await swrCached("k", compute, OPTIONS);
    expect(result).toBe("old");
    expect(compute).toHaveBeenCalledTimes(2);

    slow.resolve("new");
    await vi.advanceTimersByTimeAsync(0);
    expect(await swrCached("k", compute, OPTIONS)).toBe("new");
  });

  it("shares ONE in-flight refresh between concurrent callers", async () => {
    const slow = deferred<string>();
    const compute = vi.fn(() => slow.promise);

    const a = swrCached("k", compute, OPTIONS);
    const b = swrCached("k", compute, OPTIONS);
    const c = swrCached("k", compute, OPTIONS);
    // A busy shop must not multiply the slow query by its visitor count.
    expect(compute).toHaveBeenCalledTimes(1);

    slow.resolve("v");
    await vi.advanceTimersByTimeAsync(0);
    expect(await Promise.all([a, b, c])).toEqual(["v", "v", "v"]);
  });

  it("gives up on a COLD start after the budget and renders the fallback", async () => {
    const slow = deferred<string>();
    const compute = vi.fn(() => slow.promise);

    const pending = swrCached("k", compute, OPTIONS);
    await vi.advanceTimersByTimeAsync(OPTIONS.coldBudgetMs + 1);
    expect(await pending).toBe("fallback");

    // …but the work was not thrown away: the next visitor gets the real value.
    slow.resolve("real");
    await vi.advanceTimersByTimeAsync(0);
    expect(await swrCached("k", compute, OPTIONS)).toBe("real");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("a cold failure yields the fallback, never an exception", async () => {
    const compute = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(swrCached("k", compute, OPTIONS)).resolves.toBe("fallback");
  });

  it("keeps a good stale value when a refresh fails", async () => {
    const compute = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("good")
      .mockRejectedValueOnce(new Error("db down"));

    await swrCached("k", compute, OPTIONS);
    vi.advanceTimersByTime(OPTIONS.ttlMs + 1);
    expect(await swrCached("k", compute, OPTIONS)).toBe("good");
    await vi.advanceTimersByTimeAsync(0);
    expect(await swrCached("k", compute, OPTIONS)).toBe("good");
  });

  it("backs off after a failure instead of hammering a struggling database", async () => {
    const compute = vi.fn(async () => {
      throw new Error("db down");
    });
    await swrCached("k", compute, OPTIONS);
    await swrCached("k", compute, OPTIONS);
    await swrCached("k", compute, OPTIONS);
    expect(compute).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(OPTIONS.retryAfterMs + 1);
    await swrCached("k", compute, OPTIONS);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("resetSwrCache(key) forces the next read to recompute", async () => {
    const compute = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("before")
      .mockResolvedValueOnce("after");
    expect(await swrCached("k", compute, OPTIONS)).toBe("before");
    resetSwrCache("k"); // what an admin save does
    expect(await swrCached("k", compute, OPTIONS)).toBe("after");
  });
});
