import { describe, expect, it } from "vitest";
import { humanizeAction, summarizeDiff, relativeTime } from "./audit-format";

describe("humanizeAction", () => {
  it("maps entity.verb to 'Verb entity'", () => {
    expect(humanizeAction("product.update")).toBe("Updated product");
    expect(humanizeAction("product.create")).toBe("Created product");
    expect(humanizeAction("access.approve")).toBe("Approved access");
    expect(humanizeAction("access.revoke")).toBe("Revoked access");
    expect(humanizeAction("role.create")).toBe("Created role");
    expect(humanizeAction("customer.reject")).toBe("Rejected customer");
  });

  it("uses the trailing segment as the verb for deep actions", () => {
    expect(humanizeAction("product.image.setPrimary")).toBe(
      "Set primary image on product",
    );
    expect(humanizeAction("product.softDelete")).toBe("Deleted product");
    expect(humanizeAction("category.createSub")).toBe("Created category");
  });

  it("tolerates a bare verb with no entity prefix", () => {
    expect(humanizeAction("approve")).toBe("Approved");
    expect(humanizeAction("login")).toBe("Signed in to");
  });

  it("falls back to a title-cased verb for unknown actions", () => {
    expect(humanizeAction("product.frobnicate")).toBe("Frobnicate product");
  });

  it("does not throw on empty or nullish input", () => {
    expect(humanizeAction("")).toBe("Made a change");
    // @ts-expect-error — runtime robustness check
    expect(humanizeAction(undefined)).toBe("Made a change");
  });
});

describe("summarizeDiff", () => {
  it("lists changed field names", () => {
    expect(summarizeDiff({ changed: ["name", "price"] })).toBe("name, price");
    expect(summarizeDiff({ changed: ["name"] })).toBe("name");
  });

  it("renders a single scalar key as 'key → value'", () => {
    expect(summarizeDiff({ status: "APPROVED" })).toBe("status → APPROVED");
    expect(summarizeDiff({ order: 3 })).toBe("order → 3");
  });

  it("formats boolean scalars readably", () => {
    expect(summarizeDiff({ isPrimary: true })).toBe("isPrimary → yes");
    expect(summarizeDiff({ isPrimary: false })).toBe("isPrimary → no");
  });

  it("lists field names for multi-key diffs", () => {
    expect(summarizeDiff({ name: "A", slug: "a", parentId: null })).toBe(
      "name, slug, parentId",
    );
  });

  it("drops bookkeeping-only keys but keeps meaningful ones", () => {
    // count is noise; url remains
    expect(summarizeDiff({ url: "x.png", count: 4 })).toBe("url → x.png");
  });

  it("prefers the changed array even alongside other keys", () => {
    expect(summarizeDiff({ changed: ["permissions"], name: "Owner" })).toBe(
      "permissions",
    );
  });

  it("returns a single array-valued key as its name", () => {
    expect(summarizeDiff({ order: ["a", "b", "c"] })).toBe("order");
  });

  it("returns empty string for nothing worth showing", () => {
    expect(summarizeDiff(null)).toBe("");
    expect(summarizeDiff(undefined)).toBe("");
    expect(summarizeDiff({})).toBe("");
    expect(summarizeDiff({ count: 4 })).toBe("count → 4");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-07-11T12:00:00.000Z").getTime();

  it("returns 'just now' for very recent and future times", () => {
    expect(relativeTime(new Date(now - 5_000), now)).toBe("just now");
    expect(relativeTime(new Date(now + 10_000), now)).toBe("just now");
  });

  it("returns minutes ago with correct pluralization", () => {
    expect(relativeTime(new Date(now - 60_000), now)).toBe("1 minute ago");
    expect(relativeTime(new Date(now - 5 * 60_000), now)).toBe("5 minutes ago");
  });

  it("returns hours ago", () => {
    expect(relativeTime(new Date(now - 2 * 60 * 60_000), now)).toBe(
      "2 hours ago",
    );
    expect(relativeTime(new Date(now - 60 * 60_000), now)).toBe("1 hour ago");
  });

  it("returns 'yesterday' and days ago", () => {
    expect(relativeTime(new Date(now - 25 * 60 * 60_000), now)).toBe(
      "yesterday",
    );
    expect(relativeTime(new Date(now - 3 * 24 * 60 * 60_000), now)).toBe(
      "3 days ago",
    );
  });

  it("renders a short en-IN date beyond a week", () => {
    const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60_000);
    expect(relativeTime(twoWeeksAgo, now)).toBe("27 Jun 2026");
  });

  it("accepts ISO strings and returns empty for invalid dates", () => {
    expect(relativeTime("2026-07-11T11:00:00.000Z", now)).toBe("1 hour ago");
    expect(relativeTime("not-a-date", now)).toBe("");
  });
});
