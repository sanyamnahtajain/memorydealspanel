import { describe, expect, it } from "vitest";

import {
  gstDisclosureLabel,
  movLineText,
  noteDisclosureLabel,
} from "./summary-copy";

describe("gstDisclosureLabel — the collapsed GST row", () => {
  it("reads 'Incl. ₹X GST' with the rupee-formatted amount", () => {
    expect(gstDisclosureLabel(5700_00)).toBe("Incl. ₹5,700 GST");
  });

  it("keeps the paise when the tax is not a whole rupee", () => {
    expect(gstDisclosureLabel(123_45)).toBe("Incl. ₹123.45 GST");
  });

  it("zero tax still renders a well-formed label", () => {
    expect(gstDisclosureLabel(0)).toBe("Incl. ₹0 GST");
  });
});

describe("noteDisclosureLabel — the collapsed note row", () => {
  it("invites a note when there is none", () => {
    expect(noteDisclosureLabel("")).toBe("Add a note for the seller");
  });

  it("whitespace-only counts as no note", () => {
    expect(noteDisclosureLabel("   \n ")).toBe("Add a note for the seller");
  });

  it("confirms an attached note so folding the row loses nothing", () => {
    expect(noteDisclosureLabel("Deliver after 6pm")).toBe(
      "Note for the seller — added",
    );
  });
});

describe("movLineText — the one minimum-order-value sentence", () => {
  it("names the shortfall AND the minimum in one line", () => {
    expect(movLineText(1500_00, 10_000_00)).toBe(
      "Add ₹1,500 more to place your order (minimum ₹10,000).",
    );
  });
});
