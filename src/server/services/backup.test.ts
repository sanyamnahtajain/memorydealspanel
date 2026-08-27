import { describe, expect, it } from "vitest";

import { BACKUP_KEEP_DAYS, keysToPrune, snapshotKey } from "./backup";

describe("snapshotKey", () => {
  it("names the archive by UTC date, so one run per day overwrites itself", () => {
    const key = snapshotKey(new Date("2026-08-27T19:40:00.000Z"));
    expect(key).toBe("db-snapshots/memorydeals-2026-08-27.json.gz");
    // A retry the same night lands on the SAME key — a double run can never
    // consume two days of the retention window.
    expect(snapshotKey(new Date("2026-08-27T23:59:00.000Z"))).toBe(key);
  });
});

describe("keysToPrune", () => {
  const keys = [
    "db-snapshots/memorydeals-2026-08-20.json.gz",
    "db-snapshots/memorydeals-2026-08-21.json.gz",
    "db-snapshots/memorydeals-2026-08-22.json.gz",
  ];

  it("keeps the newest N and deletes the rest", () => {
    expect(keysToPrune(keys, 2)).toEqual([
      "db-snapshots/memorydeals-2026-08-20.json.gz",
    ]);
  });

  it("deletes nothing while under the window", () => {
    expect(keysToPrune(keys, BACKUP_KEEP_DAYS)).toEqual([]);
    expect(keysToPrune([], 7)).toEqual([]);
  });

  it("is order-insensitive — dates sort chronologically whatever S3 returns", () => {
    const shuffled = [keys[2], keys[0], keys[1]];
    expect(keysToPrune(shuffled, 1)).toEqual([keys[0], keys[1]]);
  });

  it("never deletes everything when keep is 0 or negative by accident", () => {
    // keep=0 legitimately means "prune all"; a NEGATIVE keep must not wrap
    // around into slicing from the end and silently keeping stale files.
    expect(keysToPrune(keys, 0)).toEqual(keys);
    expect(keysToPrune(keys, -5)).toEqual(keys);
  });
});
