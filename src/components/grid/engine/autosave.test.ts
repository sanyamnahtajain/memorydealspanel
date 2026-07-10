import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GridRow, RowSaveState } from "@/components/grid/types";
import {
  AutosaveQueue,
  coalescePatch,
  DEFAULT_BACKOFF,
  errorMessage,
  nextBackoffDelay,
  type AutosaveEnv,
} from "./autosave";

interface ProductRow extends GridRow {
  id: string;
  title: string;
  pricePaise: number;
}

/**
 * A deterministic env backed by vitest fake timers. `setTimeout`/`clearTimeout`
 * are the fake ones; `now` reads the fake clock.
 */
function fakeEnv(): AutosaveEnv {
  return {
    setTimer: (fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    now: () => Date.now(),
  };
}

/** Advance fake timers by `ms` and let microtasks (promises) drain. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("coalescePatch", () => {
  it("merges keys with later winning", () => {
    expect(coalescePatch({ a: 1, b: 2 }, { b: 9, c: 3 })).toEqual({
      a: 1,
      b: 9,
      c: 3,
    });
  });

  it("handles an undefined base", () => {
    expect(coalescePatch(undefined, { a: 1 })).toEqual({ a: 1 });
  });
});

describe("nextBackoffDelay", () => {
  it("grows exponentially and clamps to max", () => {
    const cfg = { baseDelayMs: 500, factor: 2, maxDelayMs: 4000, maxRetries: 10 };
    expect(nextBackoffDelay(0, cfg)).toBe(500);
    expect(nextBackoffDelay(1, cfg)).toBe(1000);
    expect(nextBackoffDelay(2, cfg)).toBe(2000);
    expect(nextBackoffDelay(3, cfg)).toBe(4000);
    expect(nextBackoffDelay(4, cfg)).toBe(4000); // clamped
  });
});

describe("errorMessage", () => {
  it("extracts messages from Error, string, and objects", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("oops")).toBe("oops");
    expect(errorMessage({ message: "obj" })).toBe("obj");
    expect(errorMessage(42)).toBe("Save failed");
  });
});

describe("AutosaveQueue — coalescing + debounce", () => {
  it("coalesces a burst of edits into ONE save after debounce", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const q = new AutosaveQueue<ProductRow>({
      onSave,
      debounceMs: 300,
      env: fakeEnv(),
    });

    q.enqueue("r1", { title: "A" });
    q.enqueue("r1", { title: "B" });
    q.enqueue("r1", { pricePaise: 100 });

    expect(onSave).not.toHaveBeenCalled();
    await advance(300);
    await q.whenIdle();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("r1", { title: "B", pricePaise: 100 });
    expect(q.getState("r1").status).toBe("saved");
  });

  it("re-arms the debounce on each new edit (trailing edge)", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const q = new AutosaveQueue<ProductRow>({ onSave, debounceMs: 300, env: fakeEnv() });

    q.enqueue("r1", { title: "A" });
    await advance(200);
    q.enqueue("r1", { title: "B" });
    await advance(200); // 400ms total, but only 200ms since last edit
    expect(onSave).not.toHaveBeenCalled();
    await advance(100);
    await q.whenIdle();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("r1", { title: "B" });
  });

  it("saves rows independently — a slow row never blocks another", async () => {
    const order: string[] = [];
    let releaseR1: () => void = () => {};
    const onSave = vi.fn((rowId: string) => {
      if (rowId === "r1") {
        return new Promise<void>((res) => {
          releaseR1 = () => {
            order.push("r1");
            res();
          };
        });
      }
      order.push("r2");
      return Promise.resolve();
    });
    const q = new AutosaveQueue<ProductRow>({ onSave, debounceMs: 100, env: fakeEnv() });

    q.enqueue("r1", { title: "slow" });
    q.enqueue("r2", { title: "fast" });
    await advance(100);
    // r2 completed while r1 is still hanging
    expect(order).toEqual(["r2"]);
    expect(q.getState("r2").status).toBe("saved");
    expect(q.getState("r1").status).toBe("saving");

    releaseR1();
    await q.whenIdle();
    expect(order).toEqual(["r2", "r1"]);
    expect(q.getState("r1").status).toBe("saved");
  });

  it("manual flush bypasses the debounce", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const q = new AutosaveQueue<ProductRow>({ onSave, debounceMs: 5000, env: fakeEnv() });
    q.enqueue("r1", { title: "A" });
    await q.flush("r1");
    await q.whenIdle();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("coalesces edits made DURING an in-flight save into a follow-up save", async () => {
    let release: () => void = () => {};
    const onSave = vi.fn((_rowId: string) => {
      if (onSave.mock.calls.length === 1) {
        return new Promise<void>((res) => {
          release = res;
        });
      }
      return Promise.resolve();
    });
    const q = new AutosaveQueue<ProductRow>({ onSave, debounceMs: 100, env: fakeEnv() });

    q.enqueue("r1", { title: "A" });
    await advance(100); // first save starts, hangs
    expect(onSave).toHaveBeenCalledTimes(1);

    q.enqueue("r1", { title: "B" }); // lands during in-flight
    q.enqueue("r1", { pricePaise: 5 });

    release();
    await q.whenIdle();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith("r1", { title: "B", pricePaise: 5 });
  });
});

describe("AutosaveQueue — retry with backoff", () => {
  it("retries a failing save with exponential backoff, then succeeds", async () => {
    let calls = 0;
    const onSave = vi.fn(() => {
      calls += 1;
      if (calls < 3) return Promise.reject(new Error("network"));
      return Promise.resolve();
    });
    const q = new AutosaveQueue<ProductRow>({
      onSave,
      debounceMs: 100,
      backoff: { baseDelayMs: 500, factor: 2, maxDelayMs: 10000, maxRetries: 4 },
      env: fakeEnv(),
    });

    q.enqueue("r1", { title: "A" });
    await advance(100); // first attempt -> fails
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(q.getState("r1").status).toBe("error");

    await advance(500); // retry 1 -> fails
    expect(onSave).toHaveBeenCalledTimes(2);

    await advance(1000); // retry 2 -> succeeds
    await q.whenIdle();
    expect(onSave).toHaveBeenCalledTimes(3);
    expect(q.getState("r1").status).toBe("saved");
  });

  it("gives up after maxRetries and surfaces a hard error", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("down"));
    const states: RowSaveState[] = [];
    const q = new AutosaveQueue<ProductRow>({
      onSave,
      debounceMs: 100,
      backoff: { baseDelayMs: 100, factor: 2, maxDelayMs: 10000, maxRetries: 2 },
      env: fakeEnv(),
      onStateChange: (_id, s) => states.push({ ...s }),
    });

    q.enqueue("r1", { title: "A" });
    await advance(100); // attempt 1 fails (attempt counter 0 -> schedule retry)
    await advance(100); // retry 1 (delay 100) fails
    await advance(200); // retry 2 (delay 200) fails -> hard failure
    await q.whenIdle();

    // 1 initial + 2 retries = 3 onSave calls
    expect(onSave).toHaveBeenCalledTimes(3);
    expect(q.getState("r1").status).toBe("error");
    expect(q.getState("r1").error).toBe("down");
  });

  it("a manual flush after a hard failure retries the stashed patch", async () => {
    let ok = false;
    const onSave = vi.fn(() => (ok ? Promise.resolve() : Promise.reject(new Error("x"))));
    const q = new AutosaveQueue<ProductRow>({
      onSave,
      debounceMs: 50,
      backoff: { baseDelayMs: 50, factor: 2, maxDelayMs: 1000, maxRetries: 0 },
      env: fakeEnv(),
    });

    q.enqueue("r1", { title: "A" });
    await advance(50); // fails, maxRetries 0 => immediate hard failure
    await q.whenIdle();
    expect(q.getState("r1").status).toBe("error");

    ok = true;
    await q.flush("r1"); // retry the stashed patch
    await q.whenIdle();
    expect(q.getState("r1").status).toBe("saved");
    expect(onSave).toHaveBeenLastCalledWith("r1", { title: "A" });
  });
});

describe("AutosaveQueue — snapshot + lifecycle", () => {
  it("snapshot reports per-row states", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const q = new AutosaveQueue<ProductRow>({ onSave, debounceMs: 100, env: fakeEnv() });
    q.enqueue("r1", { title: "A" });
    q.enqueue("r2", { title: "B" });
    await advance(100);
    await q.whenIdle();
    const snap = q.snapshot();
    expect(snap.r1.status).toBe("saved");
    expect(snap.r2.status).toBe("saved");
  });

  it("dispose cancels pending timers and drops work", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const q = new AutosaveQueue<ProductRow>({ onSave, debounceMs: 100, env: fakeEnv() });
    q.enqueue("r1", { title: "A" });
    q.dispose();
    await advance(1000);
    expect(onSave).not.toHaveBeenCalled();
    // further enqueues are ignored
    q.enqueue("r1", { title: "B" });
    await advance(1000);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("uses DEFAULT_BACKOFF when none provided", () => {
    expect(DEFAULT_BACKOFF.maxRetries).toBeGreaterThan(0);
  });
});
