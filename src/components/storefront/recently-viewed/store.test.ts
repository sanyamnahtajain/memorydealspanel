import { describe, expect, it } from "vitest";

import { RECENTLY_VIEWED_MAX, RECENTLY_VIEWED_TTL_MS, parseStored, withRecorded, type RecentlyViewedItem } from "./store";

const item = (id: string, at = 1_000): RecentlyViewedItem => ({ id, slug: id, name: id.toUpperCase(), brand: null, imageUrl: null, at });

describe("recently viewed store", () => {
  it("puts the newest view first, de-duplicates, and caps the list", () => {
    let list: RecentlyViewedItem[] = [];
    for (let i = 0; i < RECENTLY_VIEWED_MAX + 3; i++) list = withRecorded(list, item(`p${i}`, i));
    expect(list).toHaveLength(RECENTLY_VIEWED_MAX);
    expect(list[0]!.id).toBe(`p${RECENTLY_VIEWED_MAX + 2}`);
    const again = withRecorded(list, item("p5", 999));
    expect(again[0]!.id).toBe("p5");
    expect(again.filter((x) => x.id === "p5")).toHaveLength(1);
  });

  it("drops junk and stale entries on read, never throws on bad JSON", () => {
    const now = 10_000_000_000;
    const raw = JSON.stringify([
      item("fresh", now - 1000),
      item("stale", now - RECENTLY_VIEWED_TTL_MS - 1),
      { id: "junk" },
      "nope",
    ]);
    expect(parseStored(raw, now).map((x) => x.id)).toEqual(["fresh"]);
    expect(parseStored("{not json", now)).toEqual([]);
    expect(parseStored(null, now)).toEqual([]);
  });
});
