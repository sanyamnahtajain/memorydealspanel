import { describe, expect, it } from "vitest";

import {
  MAINTENANCE_OFF,
  backOnlineLabel,
  parseMaintenance,
  retryAfterSeconds,
} from "./maintenance";

/**
 * The contract that matters here is FAIL OPEN: every unreadable or malformed
 * shape must resolve to "the shop is up". A shop accidentally up is a
 * nuisance; a shop accidentally down is lost orders.
 */
describe("parseMaintenance — fails open", () => {
  it("absent / null / malformed => OFF", () => {
    expect(parseMaintenance(undefined)).toEqual(MAINTENANCE_OFF);
    expect(parseMaintenance(null)).toEqual(MAINTENANCE_OFF);
    expect(parseMaintenance("on")).toEqual(MAINTENANCE_OFF);
    expect(parseMaintenance(42)).toEqual(MAINTENANCE_OFF);
    expect(parseMaintenance({})).toEqual(MAINTENANCE_OFF);
    expect(parseMaintenance({ enabled: "yes" })).toEqual(MAINTENANCE_OFF);
  });

  it("reads a valid ON config", () => {
    expect(
      parseMaintenance({
        enabled: true,
        message: "  Back soon.  ",
        until: "2026-09-05T10:30:00.000Z",
      }),
    ).toEqual({
      enabled: true,
      message: "Back soon.",
      until: "2026-09-05T10:30:00.000Z",
    });
  });

  it("a bad message or time degrades that FIELD, never the whole config", () => {
    // The dangerous failure would be dropping to OFF mid-maintenance (shop
    // exposed) — or worse, throwing. Only the offending field is lost.
    const parsed = parseMaintenance({
      enabled: true,
      message: 12345,
      until: "not-a-date",
    });
    expect(parsed.enabled).toBe(true);
    expect(parsed.message).toBeNull();
    expect(parsed.until).toBeNull();
  });

  it("blank message becomes null so the screen uses its default wording", () => {
    expect(parseMaintenance({ enabled: true, message: "   " }).message).toBeNull();
  });
});

describe("backOnlineLabel", () => {
  it("formats a real instant and refuses a broken one", () => {
    expect(backOnlineLabel("2026-09-05T10:30:00.000Z")).toMatch(/Sep/);
    expect(backOnlineLabel(null)).toBeNull();
    expect(backOnlineLabel("nonsense")).toBeNull();
  });
});

describe("retryAfterSeconds", () => {
  const now = new Date("2026-09-05T10:00:00.000Z");

  it("counts forward to the return time", () => {
    expect(retryAfterSeconds("2026-09-05T10:30:00.000Z", now)).toBe(1800);
  });

  it("is null for a past or missing time — never a negative header", () => {
    expect(retryAfterSeconds("2026-09-05T09:00:00.000Z", now)).toBeNull();
    expect(retryAfterSeconds(null, now)).toBeNull();
    expect(retryAfterSeconds("broken", now)).toBeNull();
  });

  it("caps at a day so a stale config can't hide the shop for a month", () => {
    expect(retryAfterSeconds("2026-12-25T00:00:00.000Z", now)).toBe(86_400);
  });
});
