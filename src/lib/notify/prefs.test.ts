import { describe, expect, it } from "vitest";

import {
  EMPTY_PREFS,
  parseNotifyPrefs,
  resolveTopicStates,
  serializeNotifyPrefs,
  toggleTopic,
  wantsTopic,
} from "./prefs";
import { NOTIFY_TOPICS, findTopic, topicsFor } from "./topics";

describe("notify topics — the catalogue itself", () => {
  it("has unique keys", () => {
    const keys = NOTIFY_TOPICS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the two audiences separate", () => {
    const customerKeys = topicsFor("customer").map((t) => t.key);
    const adminKeys = topicsFor("admin").map((t) => t.key);
    expect(customerKeys.length).toBeGreaterThan(0);
    expect(adminKeys.length).toBeGreaterThan(0);
    // A buyer must never see a staff switch, or vice versa.
    for (const key of adminKeys) expect(customerKeys).not.toContain(key);
  });

  it("gives every topic somewhere to land when tapped", () => {
    for (const topic of NOTIFY_TOPICS) {
      expect(topic.fallbackUrl.startsWith("/")).toBe(true);
      expect(topic.label.length).toBeGreaterThan(0);
      expect(topic.description.length).toBeGreaterThan(0);
    }
  });

  it("returns null for a key that does not exist", () => {
    expect(findTopic("not.a.topic")).toBeNull();
  });
});

describe("notify prefs — reading stored values", () => {
  it("treats absent preferences as the defaults", () => {
    expect(parseNotifyPrefs(null)).toEqual(EMPTY_PREFS);
    expect(parseNotifyPrefs(undefined)).toEqual(EMPTY_PREFS);
  });

  it("degrades to defaults instead of throwing on junk", () => {
    // A hand-edited or half-written document must not break a page render.
    expect(parseNotifyPrefs("nonsense").muted.size).toBe(0);
    expect(parseNotifyPrefs(42).muted.size).toBe(0);
    expect(parseNotifyPrefs({ muted: "offers" }).muted.size).toBe(0);
    expect(parseNotifyPrefs({ muted: [1, 2] }).muted.size).toBe(0);
  });

  it("drops topic keys that no longer exist", () => {
    const prefs = parseNotifyPrefs({ v: 1, muted: ["offers", "gone.topic"] });
    expect(prefs.muted.has("offers")).toBe(true);
    expect(prefs.muted.has("gone.topic")).toBe(false);
  });
});

describe("notify prefs — what a person actually receives", () => {
  it("sends a topic nobody has touched, when it defaults on", () => {
    expect(wantsTopic(EMPTY_PREFS, "offers")).toBe(true);
  });

  it("stops sending a muted topic", () => {
    const prefs = parseNotifyPrefs({ v: 1, muted: ["offers"] });
    expect(wantsTopic(prefs, "offers")).toBe(false);
  });

  it("never sends an unknown topic", () => {
    expect(wantsTopic(EMPTY_PREFS, "not.a.topic")).toBe(false);
  });

  it("stores the MUTED list, so a topic added later still arrives", () => {
    // The reason for storing mutes rather than opt-ins: someone who muted
    // "offers" months ago must still get a topic that did not exist then.
    const prefs = parseNotifyPrefs({ v: 1, muted: ["offers"] });
    for (const topic of topicsFor("customer")) {
      if (topic.key === "offers") continue;
      expect(wantsTopic(prefs, topic.key)).toBe(topic.defaultOn);
    }
  });
});

describe("notify prefs — locked topics", () => {
  const lockedKey = NOTIFY_TOPICS.find((t) => t.lockedOn)?.key;

  it("has at least one topic nobody can mute", () => {
    expect(lockedKey).toBeDefined();
  });

  it("keeps sending a locked topic even if stored as muted", () => {
    // Account-critical notices — your order, your access ending — must not be
    // silenceable by a stale or hand-edited preference blob.
    const prefs = parseNotifyPrefs({ v: 1, muted: [lockedKey!] });
    expect(prefs.muted.has(lockedKey!)).toBe(false);
    expect(wantsTopic(prefs, lockedKey!)).toBe(true);
  });

  it("ignores an attempt to switch a locked topic off", () => {
    const next = toggleTopic(EMPTY_PREFS, lockedKey!, false);
    expect(wantsTopic(next, lockedKey!)).toBe(true);
  });

  it("never writes a locked topic into storage", () => {
    const written = serializeNotifyPrefs({ muted: new Set([lockedKey!]) });
    expect(written.muted).not.toContain(lockedKey);
  });
});

describe("notify prefs — flipping switches", () => {
  it("round-trips through storage", () => {
    const off = toggleTopic(EMPTY_PREFS, "offers", false);
    const stored = serializeNotifyPrefs(off);
    expect(stored).toEqual({ v: 1, muted: ["offers"] });
    expect(wantsTopic(parseNotifyPrefs(stored), "offers")).toBe(false);
  });

  it("turns a muted topic back on", () => {
    const off = toggleTopic(EMPTY_PREFS, "offers", false);
    const on = toggleTopic(off, "offers", true);
    expect(wantsTopic(on, "offers")).toBe(true);
    expect(serializeNotifyPrefs(on).muted).toEqual([]);
  });

  it("does not mutate the preferences it was given", () => {
    const before = toggleTopic(EMPTY_PREFS, "offers", false);
    const size = before.muted.size;
    toggleTopic(before, "offers", true);
    expect(before.muted.size).toBe(size);
  });

  it("ignores unknown keys instead of storing them", () => {
    const next = toggleTopic(EMPTY_PREFS, "not.a.topic", false);
    expect(serializeNotifyPrefs(next).muted).toEqual([]);
  });
});

describe("notify prefs — the settings screen rows", () => {
  it("lists every topic for the audience with its resolved state", () => {
    const prefs = parseNotifyPrefs({ v: 1, muted: ["offers"] });
    const rows = resolveTopicStates("customer", prefs);

    expect(rows.length).toBe(topicsFor("customer").length);
    expect(rows.find((r) => r.topic.key === "offers")?.enabled).toBe(false);
    for (const row of rows) {
      if (row.topic.lockedOn) expect(row.enabled).toBe(true);
    }
  });

  it("shows an admin only admin rows", () => {
    const rows = resolveTopicStates("admin", EMPTY_PREFS);
    expect(rows.every((r) => r.topic.audience === "admin")).toBe(true);
  });
});
