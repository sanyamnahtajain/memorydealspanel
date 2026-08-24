import { describe, expect, it } from "vitest";

import { accessCopy, resolveAccessState } from "./access-status";

const NOW = new Date("2026-08-24T00:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("resolveAccessState", () => {
  it("anon", () => {
    expect(resolveAccessState({ signedIn: false }, NOW)).toBe("anon");
  });

  it("pending / rejected / blocked map directly", () => {
    expect(resolveAccessState({ signedIn: true, status: "PENDING" }, NOW)).toBe("pending");
    expect(resolveAccessState({ signedIn: true, status: "REJECTED" }, NOW)).toBe("rejected");
    expect(resolveAccessState({ signedIn: true, status: "BLOCKED" }, NOW)).toBe("blocked");
  });

  it("EXPIRED → expired; with an open request → pending (no duplicate asks)", () => {
    expect(resolveAccessState({ signedIn: true, status: "EXPIRED" }, NOW)).toBe("expired");
    expect(
      resolveAccessState({ signedIn: true, status: "EXPIRED", hasOpenRequest: true }, NOW),
    ).toBe("pending");
  });

  it("APPROVED but lapsed grant (cron not run yet) reads as expired", () => {
    expect(
      resolveAccessState({ signedIn: true, status: "APPROVED", priceAccess: false }, NOW),
    ).toBe("expired");
  });

  it("APPROVED + live: expiring within 7 days, else active; unlimited = active", () => {
    const base = { signedIn: true, status: "APPROVED" as const, priceAccess: true };
    expect(resolveAccessState({ ...base, expiresAt: days(3) }, NOW)).toBe("expiring");
    expect(resolveAccessState({ ...base, expiresAt: days(7) }, NOW)).toBe("expiring");
    expect(resolveAccessState({ ...base, expiresAt: days(8) }, NOW)).toBe("active");
    expect(resolveAccessState({ ...base, expiresAt: null }, NOW)).toBe("active");
  });
});

describe("accessCopy", () => {
  it("fills {days} for the expiring nudge and mentions the 30-day auto-extend", () => {
    const snap = {
      signedIn: true,
      status: "APPROVED" as const,
      priceAccess: true,
      expiresAt: days(3),
    };
    const copy = accessCopy("expiring", snap);
    expect(copy.title).toBe("Your prices will stop in 3 days");
    expect(copy.body).toContain("30 more days");
  });

  it("expired copy offers the one-tap renewal and never says 'log in'", () => {
    const copy = accessCopy("expired");
    expect(copy.cta).toBe("renew");
    expect(copy.title.toLowerCase()).toContain("signed in");
    expect(`${copy.title} ${copy.body}`.toLowerCase()).not.toContain("log in");
  });
});
