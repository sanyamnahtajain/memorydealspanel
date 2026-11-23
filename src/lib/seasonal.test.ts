import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEASONAL,
  flakeCount,
  inWinterWindow,
  NO_SEASON,
  parseSeasonal,
  resolveSeason,
} from "./seasonal";

// Times chosen around IST midnight to prove the calendar is India's, not UTC.
const ist = (iso: string) => new Date(`${iso}+05:30`);

describe("inWinterWindow (15 Nov → 15 Jan, India time)", () => {
  it("is on inside the window, across the new year", () => {
    expect(inWinterWindow(ist("2026-11-15T00:00:00"))).toBe(true);
    expect(inWinterWindow(ist("2026-12-25T12:00:00"))).toBe(true);
    expect(inWinterWindow(ist("2027-01-01T09:00:00"))).toBe(true);
    expect(inWinterWindow(ist("2027-01-15T23:59:00"))).toBe(true);
  });

  it("is off outside it", () => {
    expect(inWinterWindow(ist("2026-11-14T23:59:00"))).toBe(false);
    expect(inWinterWindow(ist("2027-01-16T00:00:00"))).toBe(false);
    expect(inWinterWindow(ist("2026-08-15T10:00:00"))).toBe(false);
  });

  it("uses India's date even when UTC is still the day before", () => {
    // 00:30 IST on 15 Nov is 19:00 UTC on 14 Nov.
    expect(inWinterWindow(ist("2026-11-15T00:30:00"))).toBe(true);
  });
});

describe("resolveSeason", () => {
  const summer = ist("2026-06-01T12:00:00");
  const winter = ist("2026-12-20T12:00:00");

  it("auto follows the calendar", () => {
    expect(resolveSeason(DEFAULT_SEASONAL, winter)).toEqual({
      winter: true,
      snow: "light",
      christmas: true,
      admin: true,
      sounds: true,
    });
    expect(resolveSeason(DEFAULT_SEASONAL, summer)).toEqual(NO_SEASON);
  });

  it("the owner can force it on or off", () => {
    expect(resolveSeason({ ...DEFAULT_SEASONAL, mode: "on" }, summer).winter).toBe(true);
    expect(resolveSeason({ ...DEFAULT_SEASONAL, mode: "off" }, winter)).toEqual(NO_SEASON);
  });
});

describe("parseSeasonal", () => {
  it("falls back to auto for anything malformed — decoration never crashes a page", () => {
    expect(parseSeasonal(null)).toEqual(DEFAULT_SEASONAL);
    expect(parseSeasonal("on")).toEqual(DEFAULT_SEASONAL);
    expect(parseSeasonal({ mode: "blizzard", snow: 3, christmas: "yes" })).toEqual(DEFAULT_SEASONAL);
    expect(parseSeasonal({ mode: "off", snow: "normal", christmas: false, admin: false, sounds: false })).toEqual({
      mode: "off",
      snow: "normal",
      christmas: false,
      admin: false,
      sounds: false,
    });
  });
});

describe("flakeCount", () => {
  it("keeps phones light and scales up on big screens", () => {
    expect(flakeCount(375, "light", "storefront")).toBe(10);
    expect(flakeCount(820, "light", "storefront")).toBe(16);
    expect(flakeCount(1440, "light", "storefront")).toBe(24);
    expect(flakeCount(1440, "normal", "storefront")).toBe(36);
    expect(flakeCount(1440, "light", "admin")).toBe(14);
    expect(flakeCount(1440, "off", "storefront")).toBe(0);
  });
});
