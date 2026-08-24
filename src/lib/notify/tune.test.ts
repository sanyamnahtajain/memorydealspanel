import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * WebAudio does not exist in the test environment, so these tests cover the
 * two things that matter and can be checked honestly:
 *
 *   1. the contract when there is NO audio — nothing throws, playTune reports
 *      failure, stopTune is a no-op, listeners install once;
 *   2. the scheduling, against a deliberately small fake AudioContext that
 *      only records what the module asked it to build.
 *
 * The module keeps its context in module scope, so every test loads a fresh
 * copy via `vi.resetModules()` + dynamic import.
 */

type TuneModule = typeof import("./tune");

const loadTune = async (): Promise<TuneModule> => {
  vi.resetModules();
  return import("./tune");
};

/* ------------------------------------------------------------------ */
/* Fake WebAudio — just enough to record what was scheduled            */
/* ------------------------------------------------------------------ */

class FakeParam {
  value = 0;
  readonly events: Array<[string, number, number]> = [];
  setValueAtTime(v: number, t: number) {
    this.value = v;
    this.events.push(["set", v, t]);
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(["linear", v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push(["exp", v, t]);
    return this;
  }
  cancelScheduledValues(t: number) {
    this.events.push(["cancel", 0, t]);
    return this;
  }
}

class FakeNode {
  connect(dest: unknown) {
    return dest;
  }
  disconnect() {}
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = "sine";
  readonly frequency = new FakeParam();
  readonly startCalls: number[] = [];
  readonly stopCalls: number[] = [];
  start(t: number) {
    this.startCalls.push(t);
  }
  stop(t: number) {
    this.stopCalls.push(t);
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: "suspended" | "running" | "closed" = "running";
  currentTime = 10;
  readonly destination = new FakeNode();
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  createOscillator() {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

interface FakeWindow {
  addEventListener: (...args: unknown[]) => void;
  removeEventListener: (...args: unknown[]) => void;
}

/** Installs a fake browser: a window plus a working AudioContext. */
function installFakeAudio() {
  FakeAudioContext.instances = [];
  const addEventListener = vi.fn();
  const win: FakeWindow = { addEventListener, removeEventListener: vi.fn() };
  vi.stubGlobal("window", win);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  return {
    addEventListener,
    get ctx() {
      return FakeAudioContext.instances[0];
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */

describe("TUNE_DURATION_MS", () => {
  it("meets the owner's minimum lengths", async () => {
    const { TUNE_DURATION_MS } = await loadTune();
    expect(TUNE_DURATION_MS.short).toBeGreaterThanOrEqual(4_000);
    expect(TUNE_DURATION_MS.long).toBeGreaterThanOrEqual(10_000);
  });

  it("makes the staff alert clearly longer than the buyer one", async () => {
    const { TUNE_DURATION_MS } = await loadTune();
    expect(TUNE_DURATION_MS.long).toBeGreaterThan(TUNE_DURATION_MS.short);
  });
});

describe("without WebAudio", () => {
  it("playTune reports failure instead of throwing", async () => {
    const { playTune, isAudioReady } = await loadTune();
    expect(playTune("short")).toBe(false);
    expect(playTune("long")).toBe(false);
    expect(isAudioReady()).toBe(false);
  });

  it("unlockAudio reports failure instead of throwing", async () => {
    const { unlockAudio } = await loadTune();
    expect(unlockAudio()).toBe(false);
  });

  it("stopTune is safe when nothing is playing", async () => {
    const { stopTune } = await loadTune();
    expect(() => {
      stopTune();
      stopTune();
    }).not.toThrow();
  });
});

describe("installAudioUnlockListeners", () => {
  it("is idempotent", async () => {
    const fake = installFakeAudio();
    const { installAudioUnlockListeners } = await loadTune();

    installAudioUnlockListeners();
    const afterFirst = fake.addEventListener.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    installAudioUnlockListeners();
    installAudioUnlockListeners();
    expect(fake.addEventListener.mock.calls.length).toBe(afterFirst);
  });

  it("unlocks audio when a listener fires", async () => {
    const fake = installFakeAudio();
    const { installAudioUnlockListeners, isAudioReady } = await loadTune();
    installAudioUnlockListeners();

    expect(isAudioReady()).toBe(false);
    const [, handler] = fake.addEventListener.mock.calls[0] as [
      string,
      () => void,
    ];
    handler();
    expect(isAudioReady()).toBe(true);
  });
});

describe("with a fake AudioContext", () => {
  it("schedules many oscillators for each tune", async () => {
    const fake = installFakeAudio();
    const { playTune } = await loadTune();

    expect(playTune("short")).toBe(true);
    const shortCount = fake.ctx.oscillators.length;
    // A motif plus an answer plus a chord, each note layered over several
    // oscillators — far more than a single beep.
    expect(shortCount).toBeGreaterThan(10);

    expect(playTune("long")).toBe(true);
    const longCount = fake.ctx.oscillators.length - shortCount;
    expect(longCount).toBeGreaterThan(shortCount);
  });

  it("starts every note from silence so it cannot click", async () => {
    const fake = installFakeAudio();
    const { playTune } = await loadTune();
    playTune("short");

    // The tune bus and the master gain are set with plain values; only the
    // per-note envelopes schedule ramps.
    const envelopes = fake.ctx.gains.filter((g) => g.gain.events.length > 0);
    expect(envelopes.length).toBeGreaterThan(10);
    for (const g of envelopes) {
      expect(g.gain.events[0][0]).toBe("set");
      expect(g.gain.events[0][1]).toBe(0);
      expect(g.gain.events.at(-1)).toEqual(["linear", 0, expect.any(Number)]);
    }
  });

  it("schedules notes on the context clock, ahead of currentTime", async () => {
    const fake = installFakeAudio();
    const { playTune } = await loadTune();
    playTune("long");

    const starts = fake.ctx.oscillators.map((o) => o.startCalls[0]);
    expect(Math.min(...starts)).toBeGreaterThan(fake.ctx.currentTime);
    // The score really does stretch over ten-plus seconds of the timeline.
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(8);
  });

  it("stopTune cuts every scheduled oscillator short", async () => {
    const fake = installFakeAudio();
    const { playTune, stopTune } = await loadTune();
    playTune("long");

    const oscs = fake.ctx.oscillators;
    for (const osc of oscs) expect(osc.stopCalls).toHaveLength(1);

    stopTune();

    for (const osc of oscs) {
      expect(osc.stopCalls).toHaveLength(2);
      // Re-stopped at (just about) now, well before its natural end.
      expect(osc.stopCalls[1]).toBeLessThanOrEqual(fake.ctx.currentTime + 0.05);
      expect(osc.stopCalls[1]).toBeLessThan(osc.stopCalls[0]);
    }
  });

  it("stops the loop so no further repeat is scheduled", async () => {
    vi.useFakeTimers();
    try {
      const fake = installFakeAudio();
      const { startLoopingTune, stopTune, TUNE_DURATION_MS } = await loadTune();

      startLoopingTune("long");
      const afterFirst = fake.ctx.oscillators.length;
      expect(afterFirst).toBeGreaterThan(0);

      vi.advanceTimersByTime(TUNE_DURATION_MS.long + 2_000);
      expect(fake.ctx.oscillators.length).toBeGreaterThan(afterFirst);

      const afterSecond = fake.ctx.oscillators.length;
      stopTune();
      vi.advanceTimersByTime(TUNE_DURATION_MS.long * 3);
      expect(fake.ctx.oscillators.length).toBe(afterSecond);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips a repeat while shouldPlay says no, then plays once it says yes", async () => {
    vi.useFakeTimers();
    try {
      const fake = installFakeAudio();
      const { startLoopingTune, stopTune } = await loadTune();

      let muted = true;
      const audible: boolean[] = [];
      startLoopingTune("long", {
        shouldPlay: () => !muted,
        onRepeat: (a) => audible.push(a),
      });

      // A skipped repeat does not even reach for an AudioContext.
      expect(audible).toEqual([false]);
      expect(fake.ctx?.oscillators ?? []).toHaveLength(0);

      muted = false;
      vi.advanceTimersByTime(2_000);
      expect(audible.at(-1)).toBe(true);
      expect(fake.ctx.oscillators.length).toBeGreaterThan(0);

      stopTune();
    } finally {
      vi.useRealTimers();
    }
  });
});
