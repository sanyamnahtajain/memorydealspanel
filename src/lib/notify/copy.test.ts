import { describe, expect, it } from "vitest";

import {
  accessApprovedText,
  accessExpiredText,
  accessExpiringText,
  bilingual,
  cartReminderText,
  orderPlacedText,
  orderStatusHindi,
  orderStatusText,
} from "./copy";

/**
 * Bilingual notification text. These strings are the ONLY part of a
 * notification that reaches a customer whose phone is locked, so they are
 * worth pinning: both languages present, and short enough to survive the
 * lock-screen truncation that would otherwise cut the English half off.
 */

const DEVANAGARI = /[\u0900-\u097F]/;

/** Titles are the first thing truncated; keep every one inside this. */
const TITLE_MAX = 40;

function everyText() {
  return [
    accessApprovedText(),
    accessExpiringText(7, 30),
    accessExpiringText(1, 30),
    accessExpiredText(),
    orderPlacedText("MD-1042", 3),
    orderPlacedText("MD-1042", 1),
    orderStatusText("MD-1042", "Confirmed", "कन्फर्म हो गया"),
    cartReminderText(2),
    cartReminderText(1),
  ];
}

describe("bilingual()", () => {
  it("puts Hindi first, then English", () => {
    expect(bilingual("नमस्ते", "Hello")).toBe("नमस्ते · Hello");
  });

  it("does not leave a dangling separator when one half is missing", () => {
    expect(bilingual("", "Hello")).toBe("Hello");
    expect(bilingual("नमस्ते", "")).toBe("नमस्ते");
    expect(bilingual("  ", "Hello")).toBe("Hello");
  });
});

describe("notification copy — every prebuilt message", () => {
  it("carries both languages", () => {
    for (const text of everyText()) {
      expect(text.title).toMatch(DEVANAGARI);
      expect(text.body).toMatch(DEVANAGARI);
      // An English half must survive too — the separator proves both sides.
      expect(text.title).toContain("·");
      expect(text.body).toContain("·");
    }
  });

  it("keeps titles short enough to survive a lock screen", () => {
    for (const text of everyText()) {
      expect(text.title.length).toBeLessThanOrEqual(TITLE_MAX);
    }
  });

  it("never uses jargon a shopkeeper would not recognise", () => {
    for (const text of everyText()) {
      const combined = `${text.title} ${text.body}`;
      expect(combined).not.toMatch(/subscription|endpoint|permission|PWA/i);
    }
  });
});

describe("notification copy — the specific messages", () => {
  it("announces approved access in both languages", () => {
    const text = accessApprovedText();
    expect(text.title).toContain("एक्सेस अप्रूव");
    expect(text.title).toContain("Access approved");
    // The body carries the actual benefit, in both languages.
    expect(text.body).toContain("प्राइस");
    expect(text.body).toContain("see prices");
  });

  it("states the auto-extension deal when access is ending", () => {
    // The owner insists this is communicated every time: one order buys
    // another 30 days.
    const text = accessExpiringText(3, 30);
    expect(text.title).toContain("3");
    expect(text.body).toContain("30");
    expect(text.body).toContain("30 more days");
  });

  it("counts items correctly in each language", () => {
    expect(orderPlacedText("MD-1", 1).body).toContain("1 item.");
    expect(orderPlacedText("MD-1", 4).body).toContain("4 items.");
    expect(cartReminderText(1).body).toContain("1 item in your cart");
    expect(cartReminderText(3).body).toContain("3 items in your cart");
  });

  it("names the order in the body so the buyer knows which one", () => {
    expect(orderPlacedText("MD-1042", 2).body).toContain("MD-1042");
    expect(orderStatusText("MD-1042", "Packed", "पैक हो गया").body).toContain(
      "MD-1042",
    );
  });
});

describe("order status in Hindi", () => {
  it("translates the statuses a buyer actually sees", () => {
    expect(orderStatusHindi("CONFIRMED", "Confirmed")).toBe("कन्फर्म हो गया");
    expect(orderStatusHindi("DELIVERED", "Delivered")).toBe("डिलीवर हो गया");
    expect(orderStatusHindi("CANCELLED", "Cancelled")).toBe("कैंसिल हो गया");
  });

  it("falls back to the English label for a status added later", () => {
    // A new OrderStatus must degrade to English, never to a blank.
    expect(orderStatusHindi("RETURNED", "Returned")).toBe("Returned");
  });
});
