import { describe, expect, it } from "vitest";

import {
  formatOrderCount,
  formatTillDate,
  trustStripLabel,
} from "./trust-strip-label";
import type { AccessStatusSnapshot } from "./useAccessStatus";

const NOW = new Date("2026-08-24T00:00:00Z");
const days = (n: number) =>
  new Date(NOW.getTime() + n * 86_400_000).toISOString();

/** APPROVED, live prices, far-off expiry — the canonical healthy customer. */
const active: AccessStatusSnapshot = {
  signedIn: true,
  status: "APPROVED",
  priceAccess: true,
  expiresAt: days(30),
  orderCount: 12,
};

describe("trustStripLabel — visibility rule", () => {
  it("null before the snapshot resolves (enhancement — no skeleton)", () => {
    expect(trustStripLabel(null, NOW)).toBeNull();
  });

  it("renders for active only", () => {
    expect(trustStripLabel(active, NOW)).toBe(
      "Prices open · till 23 Sept · 12 orders",
    );
  });

  it("never renders for the banner's states (mutually exclusive slot)", () => {
    expect(trustStripLabel({ signedIn: false }, NOW)).toBeNull();
    expect(
      trustStripLabel({ signedIn: true, status: "PENDING" }, NOW),
    ).toBeNull();
    expect(
      trustStripLabel({ signedIn: true, status: "REJECTED" }, NOW),
    ).toBeNull();
    expect(
      trustStripLabel({ signedIn: true, status: "EXPIRED" }, NOW),
    ).toBeNull();
    expect(
      trustStripLabel({ signedIn: true, status: "BLOCKED" }, NOW),
    ).toBeNull();
    // APPROVED but lapsed grant reads as expired — still the banner's.
    expect(
      trustStripLabel(
        { signedIn: true, status: "APPROVED", priceAccess: false },
        NOW,
      ),
    ).toBeNull();
  });

  it("expiring (within 7 days) is the banner's, not the strip's", () => {
    expect(trustStripLabel({ ...active, expiresAt: days(3) }, NOW)).toBeNull();
    expect(trustStripLabel({ ...active, expiresAt: days(7) }, NOW)).toBeNull();
    // The day after the warning window opens, the strip takes over again.
    expect(trustStripLabel({ ...active, expiresAt: days(8) }, NOW)).toContain(
      "Prices open",
    );
  });
});

describe("trustStripLabel — parts", () => {
  it("omits the expiry entirely for a never-expiring grant", () => {
    expect(trustStripLabel({ ...active, expiresAt: null }, NOW)).toBe(
      "Prices open · 12 orders",
    );
  });

  it("omits the order count at zero, and when absent (older payloads)", () => {
    expect(trustStripLabel({ ...active, orderCount: 0 }, NOW)).toBe(
      "Prices open · till 23 Sept",
    );
    expect(trustStripLabel({ ...active, orderCount: undefined }, NOW)).toBe(
      "Prices open · till 23 Sept",
    );
  });

  it("bare minimum: unlimited grant, no orders yet", () => {
    expect(
      trustStripLabel({ ...active, expiresAt: null, orderCount: 0 }, NOW),
    ).toBe("Prices open");
  });
});

describe("formatOrderCount", () => {
  it("pluralises", () => {
    expect(formatOrderCount(1)).toBe("1 order");
    expect(formatOrderCount(2)).toBe("2 orders");
    expect(formatOrderCount(120)).toBe("120 orders");
  });

  it("null for zero, absent, and nonsense", () => {
    expect(formatOrderCount(0)).toBeNull();
    expect(formatOrderCount(undefined)).toBeNull();
    expect(formatOrderCount(-3)).toBeNull();
    expect(formatOrderCount(Number.NaN)).toBeNull();
  });
});

describe("formatTillDate", () => {
  it("day + short month within the current year (IST calendar date)", () => {
    expect(formatTillDate(days(30), NOW)).toBe("23 Sept");
  });

  it("appends the year when the expiry crosses into the next year", () => {
    expect(formatTillDate("2027-01-15T00:00:00Z", NOW)).toBe("15 Jan 2027");
  });

  it("uses the Indian calendar day, not UTC (late-night UTC rolls forward)", () => {
    // 20:00 UTC on 22 Sep is already 23 Sept 01:30 in Asia/Kolkata.
    expect(formatTillDate("2026-09-22T20:00:00Z", NOW)).toBe("23 Sept");
  });
});
