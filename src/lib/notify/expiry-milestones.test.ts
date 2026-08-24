import { describe, expect, it } from "vitest";

import {
  EXPIRY_REMINDER_DAYS,
  LAPSED_GRACE_DAYS,
  istDateKey,
  istDaysUntil,
  milestoneFor,
} from "./expiry-milestones";

/**
 * The nudge job is the one place that can spam a buyer's phone, so the
 * bucketing rule gets pinned down hard here: the route below it is only
 * plumbing (fetch grants → ask this → send → record).
 *
 * Times are written as UTC instants with the IST wall-clock time in a comment,
 * because IST (UTC+05:30) is the calendar the rule counts in.
 */

/** UTC instant for an IST wall-clock time — the shop's own clock. */
function ist(
  year: number,
  month: number,
  day: number,
  hour = 12,
  minute = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - (5 * 60 + 30) * 60 * 1000);
}

describe("milestoneFor", () => {
  it("returns d7 exactly seven days before expiry", () => {
    const now = ist(2026, 3, 1, 10);
    expect(milestoneFor(ist(2026, 3, 8, 10), now)).toBe("d7");
  });

  it("returns d3 exactly three days before expiry", () => {
    const now = ist(2026, 3, 1, 10);
    expect(milestoneFor(ist(2026, 3, 4, 10), now)).toBe("d3");
  });

  it("returns d1 exactly one day before expiry", () => {
    const now = ist(2026, 3, 1, 10);
    expect(milestoneFor(ist(2026, 3, 2, 10), now)).toBe("d1");
  });

  it("stays silent on the in-between days", () => {
    const now = ist(2026, 3, 1, 10);
    for (const day of [2, 4, 5, 6, 8, 9, 30]) {
      expect(milestoneFor(ist(2026, 3, 1 + day, 10), now)).toBeNull();
    }
  });

  it("returns expired once the grant has lapsed the same day", () => {
    // Expired at 02:00 IST; the morning run finds it already lapsed.
    const now = ist(2026, 3, 1, 10);
    expect(milestoneFor(ist(2026, 3, 1, 2), now)).toBe("expired");
  });

  it("still reports a lapse from late last night on the next morning's run", () => {
    // The exact reason LAPSED_GRACE_DAYS exists: a 23:00 IST expiry has no
    // run left on its own day, so the next morning must still announce it.
    expect(LAPSED_GRACE_DAYS).toBeGreaterThanOrEqual(1);
    const now = ist(2026, 3, 2, 10);
    expect(milestoneFor(ist(2026, 3, 1, 23), now)).toBe("expired");
  });

  it("says nothing on the expiry day while access is still live", () => {
    // 09:00 run, access runs until 22:00 tonight — d1 went out yesterday and
    // the "it ended" note goes out tomorrow morning. Nothing to add now.
    const now = ist(2026, 3, 1, 9);
    expect(milestoneFor(ist(2026, 3, 1, 22), now)).toBeNull();
  });

  it("never nudges a grant with no expiry (unlimited access)", () => {
    const now = ist(2026, 3, 1, 10);
    expect(milestoneFor(null, now)).toBeNull();
    expect(milestoneFor(undefined, now)).toBeNull();
  });

  it("never re-announces a grant that expired long ago", () => {
    const now = ist(2026, 3, 1, 10);
    expect(milestoneFor(ist(2026, 2, 27, 10), now)).toBeNull();
    expect(milestoneFor(ist(2025, 11, 1, 10), now)).toBeNull();
  });

  it("resolves late-night and early-morning runs on one IST day identically", () => {
    const expiresAt = ist(2026, 3, 8, 13, 45);
    // Both of these are 1 March in IST, at opposite ends of the day.
    const earlyMorning = ist(2026, 3, 1, 0, 5);
    const lateNight = ist(2026, 3, 1, 23, 55);

    expect(milestoneFor(expiresAt, earlyMorning)).toBe("d7");
    expect(milestoneFor(expiresAt, lateNight)).toBe("d7");
    expect(milestoneFor(expiresAt, lateNight)).toBe(
      milestoneFor(expiresAt, earlyMorning),
    );
  });

  it("does not let the UTC day rollover (05:30 IST) shift the bucket", () => {
    // 05:00 IST and 06:00 IST on 1 March straddle midnight UTC. A UTC-based
    // implementation would put them in different buckets; IST does not.
    const expiresAt = ist(2026, 3, 4, 12);
    expect(milestoneFor(expiresAt, ist(2026, 3, 1, 5))).toBe("d3");
    expect(milestoneFor(expiresAt, ist(2026, 3, 1, 6))).toBe("d3");
  });

  it("buckets by calendar day, not by elapsed hours", () => {
    // 6 days + 20 hours away is still "7 days" on the IST calendar, so a run
    // that drifts later in the day does not skip the 7-day warning.
    const now = ist(2026, 3, 1, 6);
    expect(milestoneFor(ist(2026, 3, 8, 2), now)).toBe("d7");
  });
});

describe("istDaysUntil", () => {
  it("counts whole IST days, signed", () => {
    const now = ist(2026, 3, 1, 10);
    expect(istDaysUntil(ist(2026, 3, 1, 23), now)).toBe(0);
    expect(istDaysUntil(ist(2026, 3, 4, 1), now)).toBe(3);
    expect(istDaysUntil(ist(2026, 2, 28, 23), now)).toBe(-1);
  });
});

describe("istDateKey", () => {
  it("names the IST calendar date, not the UTC one", () => {
    // 01:00 IST on 2 March is still 1 March in UTC.
    expect(istDateKey(ist(2026, 3, 2, 1))).toBe("2026-03-02");
    expect(istDateKey(ist(2026, 3, 1, 23))).toBe("2026-03-01");
  });
});

describe("EXPIRY_REMINDER_DAYS", () => {
  it("counts down so the widest window is first (the cron's lookahead)", () => {
    expect([...EXPIRY_REMINDER_DAYS]).toEqual([7, 3, 1]);
  });
});
