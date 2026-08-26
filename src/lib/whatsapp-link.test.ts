import { describe, expect, it } from "vitest";

import type { OrderStatus } from "@prisma/client";

import { ORDER_STATUS_LABEL } from "@/components/storefront/orders/order-status";
import type { OrderTracking } from "@/lib/tracking";
import {
  buildWhatsAppLink,
  enquiryMessageLines,
  normaliseWhatsAppNumber,
  orderStatusMessageLines,
} from "./whatsapp-link";

describe("whatsapp-link (number-free builder)", () => {
  it("normalises a number to bare digits for wa.me", () => {
    expect(normaliseWhatsAppNumber("+91 98765 43210")).toBe("919876543210");
  });

  it("builds a bare link when there is no message", () => {
    expect(buildWhatsAppLink("919876543210")).toBe("https://wa.me/919876543210");
    expect(buildWhatsAppLink("919876543210", ["", ""])).toBe("https://wa.me/919876543210");
  });

  it("URL-encodes a multi-line message", () => {
    const href = buildWhatsAppLink("1", ["Hi", "there"]);
    expect(href).toBe("https://wa.me/1?text=Hi%0Athere");
  });

  it("enquiry lines carry name + SKU, never a price", () => {
    const lines = enquiryMessageLines({ appName: "Shop", productName: "Glass", sku: "G-1" });
    expect(lines[0]).toBe("Hi Shop, I'd like to enquire about:");
    expect(lines).toContain("Glass");
    expect(lines).toContain("SKU: G-1");
    expect(lines.join("\n")).not.toMatch(/₹/);
  });

  it("omits the SKU line when there is no SKU", () => {
    const lines = enquiryMessageLines({ appName: "Shop", productName: "Glass" });
    expect(lines.some((l) => l.startsWith("SKU:"))).toBe(false);
  });
});

describe("orderStatusMessageLines (staff → customer)", () => {
  const base = {
    appName: "The Memory Deals",
    contactName: "Rakesh",
    orderNumber: "MD-1042",
  };
  const tracking: OrderTracking = {
    courierName: "Bluedart",
    trackingId: "AWB12345678",
    url: "https://track.example.com/parcel?awb=AWB12345678&lang=en",
  };
  const allStatuses = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[];

  it.each(allStatuses)("%s: greets by name, carries the order number, signs off", (status) => {
    const text = orderStatusMessageLines({ ...base, status }).join("\n");
    expect(text).toContain("Namaste Rakesh");
    expect(text).toContain("MD-1042");
    expect(text).toContain("— The Memory Deals");
    expect(text.length).toBeLessThan(300);
  });

  it("PROCESSING with tracking says the parcel is on the way, with courier + number + link", () => {
    const lines = orderStatusMessageLines({ ...base, status: "PROCESSING", tracking });
    const text = lines.join("\n");
    expect(text).toContain("on the way");
    expect(text).toContain("Sent with Bluedart.");
    expect(text).toContain("Tracking number: AWB12345678");
    expect(text).toContain("Track: https://track.example.com/parcel?awb=AWB12345678&lang=en");
  });

  it("omits the tracking sentences cleanly when there is no tracking", () => {
    const text = orderStatusMessageLines({ ...base, status: "PROCESSING" }).join("\n");
    expect(text).toContain("will ship soon");
    expect(text).not.toContain("Sent with");
    expect(text).not.toContain("Tracking number");
    expect(text).not.toContain("Track:");
  });

  it("skips absent tracking fields without leaving gaps", () => {
    const text = orderStatusMessageLines({
      ...base,
      status: "FULFILLED",
      tracking: { courierName: null, trackingId: "AWB9", url: null },
    }).join("\n");
    expect(text).toContain("Tracking number: AWB9");
    expect(text).not.toContain("Sent with");
    expect(text).not.toContain("Track:");
    expect(text).not.toMatch(/\n\n/);
  });

  it("a cancelled order never carries tracking — it asks the buyer to call", () => {
    const text = orderStatusMessageLines({ ...base, status: "CANCELLED", tracking }).join("\n");
    expect(text).toContain("cancelled");
    expect(text).toContain("call us");
    expect(text).not.toContain("Track:");
  });

  it("the wa.me URL round-trips the message exactly (no raw & breakage)", () => {
    const lines = orderStatusMessageLines({ ...base, status: "PROCESSING", tracking });
    const href = buildWhatsAppLink("+91 98765 43210", lines);
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe("https://wa.me/919876543210");
    // The raw href must not leak an unencoded '&' from the tracking URL into
    // the query string — 'text' must be the ONLY parameter…
    expect([...url.searchParams.keys()]).toEqual(["text"]);
    // …and it must decode back to the exact message, tracking link intact.
    expect(url.searchParams.get("text")).toBe(lines.join("\n"));
  });
});

describe("normaliseWhatsAppNumber — the country-code gap", () => {
  it("prefixes 91 onto a bare 10-digit Indian mobile", () => {
    // THE BUG: legacy/seed customers are stored without +91, and
    // wa.me/9876543210 opens nothing on WhatsApp. Every customer of this
    // shop is Indian, so the 91 default is correct, not a guess.
    expect(normaliseWhatsAppNumber("9876543210")).toBe("919876543210");
  });

  it("handles the trunk-prefix habit (leading 0)", () => {
    expect(normaliseWhatsAppNumber("09876543210")).toBe("919876543210");
  });

  it("leaves an already-international number alone", () => {
    expect(normaliseWhatsAppNumber("+91 98765 43210")).toBe("919876543210");
    expect(normaliseWhatsAppNumber("919876543210")).toBe("919876543210");
  });

  it("does not force 91 onto numbers that are not Indian mobiles", () => {
    // A landline-ish or foreign shape passes through stripped, unprefixed.
    expect(normaliseWhatsAppNumber("0112345678")).toBe("0112345678");
    expect(normaliseWhatsAppNumber("14155552671")).toBe("14155552671");
  });
});
