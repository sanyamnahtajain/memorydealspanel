import { describe, expect, it } from "vitest";

import {
  bannerHrefSchema,
  bannerStatusReason,
  isBannerLive,
  isBannerPlacement,
  bannerInputSchema,
} from "./banners";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const at = (iso: string) => new Date(iso);

describe("isBannerLive", () => {
  const base = { active: true, startsAt: null, endsAt: null };

  it("an active banner with no dates is always live", () => {
    expect(isBannerLive(base, NOW)).toBe(true);
  });

  it("an inactive banner is never live, dates or not", () => {
    expect(isBannerLive({ ...base, active: false }, NOW)).toBe(false);
    expect(
      isBannerLive(
        { active: false, startsAt: at("2026-01-01T00:00:00Z"), endsAt: null },
        NOW,
      ),
    ).toBe(false);
  });

  it("respects a start date, inclusively", () => {
    expect(isBannerLive({ ...base, startsAt: at("2026-09-14T12:00:00Z") }, NOW)).toBe(true);
    expect(isBannerLive({ ...base, startsAt: at("2026-09-14T12:00:01Z") }, NOW)).toBe(false);
  });

  it("respects an end date, EXCLUSIVELY", () => {
    // A campaign ending "14 Sep 12:00" is over AT 12:00 — not a day later.
    expect(isBannerLive({ ...base, endsAt: at("2026-09-14T12:00:00Z") }, NOW)).toBe(false);
    expect(isBannerLive({ ...base, endsAt: at("2026-09-14T12:00:01Z") }, NOW)).toBe(true);
  });

  it("needs BOTH ends of a window to be satisfied", () => {
    const window = {
      active: true,
      startsAt: at("2026-09-01T00:00:00Z"),
      endsAt: at("2026-10-01T00:00:00Z"),
    };
    expect(isBannerLive(window, NOW)).toBe(true);
    expect(isBannerLive(window, at("2026-08-31T23:59:59Z"))).toBe(false);
    expect(isBannerLive(window, at("2026-10-01T00:00:00Z"))).toBe(false);
  });
});

describe("bannerStatusReason — why an admin's banner isn't showing", () => {
  it("names each reason, and says nothing when it is live", () => {
    expect(bannerStatusReason({ active: false, startsAt: null, endsAt: null }, NOW)).toBe("Turned off");
    expect(
      bannerStatusReason({ active: true, startsAt: at("2026-12-01T00:00:00Z"), endsAt: null }, NOW),
    ).toBe("Scheduled");
    expect(
      bannerStatusReason({ active: true, startsAt: null, endsAt: at("2026-01-01T00:00:00Z") }, NOW),
    ).toBe("Finished");
    expect(bannerStatusReason({ active: true, startsAt: null, endsAt: null }, NOW)).toBeNull();
  });
});

describe("where a banner may point", () => {
  it("accepts internal paths and https campaigns", () => {
    for (const href of ["/c/chargers", "/search?q=cable", "/p/some-slug", "https://example.com/sale"]) {
      expect(bannerHrefSchema.safeParse(href).success).toBe(true);
    }
  });

  it("refuses anything that could run code or leave the origin sideways", () => {
    // A banner is an admin-typed link rendered to every visitor — it must
    // never become a script vector.
    for (const href of ["javascript:alert(1)", "data:text/html,x", "//evil.com", "not a url"]) {
      expect(bannerHrefSchema.safeParse(href).success).toBe(false);
    }
  });
});

describe("placements", () => {
  it("knows its own slots and rejects a typo", () => {
    expect(isBannerPlacement("HOME_HERO")).toBe(true);
    expect(isBannerPlacement("HOME_MID")).toBe(true);
    expect(isBannerPlacement("HOME_HERO ")).toBe(false);
    expect(isBannerPlacement("CHECKOUT")).toBe(false);
  });

  it("rejects an unknown placement at the input boundary", () => {
    const parsed = bannerInputSchema.safeParse({
      placement: "NOWHERE",
      imageUrl: "/banners/a.jpg",
      alt: "Sale",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a minimal valid banner and defaults the rest", () => {
    const parsed = bannerInputSchema.safeParse({
      placement: "HOME_HERO",
      imageUrl: "/banners/a.jpg",
      alt: "Diwali sale",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.active).toBe(true);
      expect(parsed.data.sortOrder).toBe(0);
    }
  });

  it("requires alt text — a banner is content, not decoration", () => {
    expect(
      bannerInputSchema.safeParse({
        placement: "HOME_HERO",
        imageUrl: "/banners/a.jpg",
        alt: "   ",
      }).success,
    ).toBe(false);
  });
});
