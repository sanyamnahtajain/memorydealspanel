import { describe, expect, it } from "vitest";

import {
  buildWhatsAppLink,
  enquiryMessageLines,
  normaliseWhatsAppNumber,
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
