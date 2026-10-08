import { describe, expect, it } from "vitest";

import {
  SNOOZE_MS,
  clearSnooze,
  isQuietPath,
  isSnoozed,
  readSnoozedUntil,
  snooze,
  snoozeKey,
  type KeyValueStore,
} from "./install-snooze";

function fakeStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("install prompt snooze", () => {
  it("is free to show with nothing stored", () => {
    const store = fakeStore();
    expect(isSnoozed("storefront", 1_000, store)).toBe(false);
    expect(readSnoozedUntil("storefront", store)).toBe(0);
  });

  it("parks the prompt for seven days from the dismissal", () => {
    const store = fakeStore();
    const now = 1_700_000_000_000;
    snooze("storefront", now, store);
    expect(isSnoozed("storefront", now, store)).toBe(true);
    expect(isSnoozed("storefront", now + SNOOZE_MS - 1, store)).toBe(true);
    expect(isSnoozed("storefront", now + SNOOZE_MS, store)).toBe(false);
  });

  it("keeps the storefront and admin PWAs separate", () => {
    const store = fakeStore();
    snooze("admin", 5_000, store);
    expect(isSnoozed("admin", 5_000, store)).toBe(true);
    expect(isSnoozed("storefront", 5_000, store)).toBe(false);
    expect(snoozeKey("admin")).not.toBe(snoozeKey("storefront"));
  });

  it("clears after a successful install", () => {
    const store = fakeStore();
    snooze("storefront", 5_000, store);
    clearSnooze("storefront", store);
    expect(isSnoozed("storefront", 5_000, store)).toBe(false);
  });

  it("treats garbage in storage as not snoozed", () => {
    const store = fakeStore();
    store.setItem(snoozeKey("storefront"), "not-a-number");
    expect(isSnoozed("storefront", 5_000, store)).toBe(false);
  });

  it("never throws when storage is unavailable or broken", () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => snooze("storefront", 1, broken)).not.toThrow();
    expect(() => clearSnooze("storefront", broken)).not.toThrow();
    expect(isSnoozed("storefront", 1, broken)).toBe(false);
    expect(isSnoozed("storefront", 1, null)).toBe(false);
  });
});

describe("quiet paths — never cover a page's own sticky CTA", () => {
  it.each(["/p/usb-c-cable", "/account/cart", "/account/checkout", "/gate", "/maintenance", "/offline", "/reels"])(
    "%s is quiet",
    (path) => {
      expect(isQuietPath(path)).toBe(true);
    },
  );
  it.each(["/", "/categories", "/c/chargers", "/b/boat", "/search?q=cable", "/account", "/admin"])(
    "%s may show the prompt",
    (path) => {
      expect(isQuietPath(path)).toBe(false);
    },
  );
});
