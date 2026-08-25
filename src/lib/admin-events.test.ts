import { describe, expect, it } from "vitest";

import {
  ADMIN_EVENTS_MAX_RESUME_MS,
  ADMIN_FEED_TYPES,
  isAdminFeedType,
  resolveResumeCursor,
} from "./admin-events";

const NOW = new Date("2026-08-25T10:00:00.000Z");

describe("resolveResumeCursor — closing the reconnect gap", () => {
  it("starts from now for a brand-new connection", () => {
    expect(resolveResumeCursor(null, NOW).getTime()).toBe(NOW.getTime());
  });

  it("resumes exactly where the dropped stream stopped", () => {
    // THE BUG: this used to restart at `now`, so every notification created
    // while the stream was down was skipped for good — a new access request
    // never reached the panel until an admin reloaded by hand.
    const lastSeen = new Date(NOW.getTime() - 30_000);
    expect(resolveResumeCursor(lastSeen.toISOString(), NOW).getTime()).toBe(
      lastSeen.getTime(),
    );
  });

  it("does not replay more than the catch-up window", () => {
    // A tab asleep for hours must not wake up to a pile of ringing takeovers.
    const ancient = new Date(NOW.getTime() - 6 * 60 * 60 * 1000);
    expect(resolveResumeCursor(ancient.toISOString(), NOW).getTime()).toBe(
      NOW.getTime() - ADMIN_EVENTS_MAX_RESUME_MS,
    );
  });

  it("ignores a junk id instead of throwing or reading everything", () => {
    for (const junk of ["", "not-a-date", "NaN", "12345abc"]) {
      expect(resolveResumeCursor(junk, NOW).getTime()).toBe(NOW.getTime());
    }
  });

  it("refuses a future id, which would skip real events", () => {
    // Clock skew between instances, or a forged header.
    const future = new Date(NOW.getTime() + 60_000);
    expect(resolveResumeCursor(future.toISOString(), NOW).getTime()).toBe(
      NOW.getTime(),
    );
  });

  it("treats the boundary of the window as resumable", () => {
    const edge = new Date(NOW.getTime() - ADMIN_EVENTS_MAX_RESUME_MS);
    expect(resolveResumeCursor(edge.toISOString(), NOW).getTime()).toBe(
      edge.getTime(),
    );
  });
});

describe("admin feed types", () => {
  it("streams the staff events", () => {
    for (const type of ["order.placed", "access_request", "renewal_request"]) {
      expect(isAdminFeedType(type)).toBe(true);
    }
  });

  it("keeps customer-directed and bookkeeping rows off the feed", () => {
    // These share the Notification table; streaming them would give staff a
    // burst of meaningless toasts every morning when the nudge job runs.
    for (const type of [
      "order.status",
      "access.expiring.d7",
      "access.expired",
      "cart.reminder",
    ]) {
      expect(isAdminFeedType(type)).toBe(false);
    }
  });

  it("has no duplicate entries", () => {
    expect(new Set(ADMIN_FEED_TYPES).size).toBe(ADMIN_FEED_TYPES.length);
  });
});
