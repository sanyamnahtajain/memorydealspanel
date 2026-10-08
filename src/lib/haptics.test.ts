// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { hapticSuccess, hapticTap } from "./haptics";

afterEach(() => {
  vi.restoreAllMocks();
  delete document.documentElement.dataset.reduceMotion;
});

function withMatchMedia(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({ matches: reduce, addEventListener() {}, removeEventListener() {} }),
  });
}

describe("haptics", () => {
  it("buzzes when the device can and the person has not asked for less motion", () => {
    withMatchMedia(false);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    hapticTap();
    hapticSuccess();
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it("stays silent under reduced motion — OS setting or the in-app one", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    withMatchMedia(true);
    hapticTap();
    withMatchMedia(false);
    document.documentElement.dataset.reduceMotion = "true";
    hapticTap();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("never throws where vibration is unsupported", () => {
    withMatchMedia(false);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: undefined });
    expect(() => hapticTap()).not.toThrow();
  });
});
