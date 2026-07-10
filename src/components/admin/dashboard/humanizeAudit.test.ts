import { describe, expect, it } from "vitest";
import { humanizeAudit } from "./ActivityFeed";

/**
 * Unit tests for the audit → activity humanizer. This is the only non-trivial
 * pure logic in the dashboard: it must never throw on unknown actions/entities
 * and must produce sensible verbs, tones and compact ids.
 */
describe("humanizeAudit", () => {
  const base = {
    id: "a1",
    actorType: "admin",
    actorId: "admin1",
    entityId: "507f1f77bcf86cd799439011",
    createdAt: new Date("2026-07-10T10:00:00.000Z"),
  };

  it("maps a known entity.verb action to a humanized title and tone", () => {
    const item = humanizeAudit({
      ...base,
      action: "product.create",
      entity: "Product",
    });
    expect(item.title).toBe("Created product");
    expect(item.tone).toBe("positive");
    expect(item.timestamp).toBe("2026-07-10T10:00:00.000Z");
  });

  it("maps destructive verbs to a negative tone", () => {
    expect(
      humanizeAudit({ ...base, action: "product.delete", entity: "Product" })
        .tone,
    ).toBe("negative");
    expect(
      humanizeAudit({ ...base, action: "customer.reject", entity: "Customer" })
        .title,
    ).toBe("Rejected customer");
  });

  it("maps access grant/revoke to relationship phrasing", () => {
    expect(
      humanizeAudit({ ...base, action: "grant.grant", entity: "AccessGrant" })
        .title,
    ).toBe("Granted access to access grant");
    expect(
      humanizeAudit({ ...base, action: "grant.revoke", entity: "AccessGrant" })
        .tone,
    ).toBe("warning");
  });

  it("falls back gracefully for unknown verbs without throwing", () => {
    const item = humanizeAudit({
      ...base,
      action: "product.frobnicate",
      entity: "Product",
    });
    expect(item.title).toBe("Frobnicate product");
    expect(item.tone).toBe("neutral");
  });

  it("tolerates a bare verb with no entity prefix in the action", () => {
    const item = humanizeAudit({
      ...base,
      action: "approve",
      entity: "AccessRequest",
    });
    expect(item.title).toBe("Approved access request");
  });

  it("compacts long object ids and preserves short ones", () => {
    expect(
      humanizeAudit({ ...base, action: "product.create", entity: "Product" })
        .detail,
    ).toBe("507f…9011");
    expect(
      humanizeAudit({
        ...base,
        entityId: "short",
        action: "product.create",
        entity: "Product",
      }).detail,
    ).toBe("short");
  });
});
