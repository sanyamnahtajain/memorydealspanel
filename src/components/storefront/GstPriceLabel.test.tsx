/**
 * GstPriceLabel render tests — the tax-aware price caption.
 *
 * The load-bearing invariant: given ONLY the non-monetary `tax` metadata (a
 * gated viewer), the label renders a rate hint and NO rupee amount. The paise
 * subline appears only when a `breakdown` is explicitly supplied (an approved
 * viewer). GST off ⇒ the component renders nothing.
 */
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { GstPriceLabel } from "./GstPriceLabel";
import type { PublicTaxMeta, PricedTaxBreakdown } from "@/server/dto/product";

afterEach(cleanup);

const EXCLUSIVE_META: PublicTaxMeta = {
  hsnCode: "8523",
  gstRateBps: 1800,
  taxInclusive: false,
};

const INCLUSIVE_META: PublicTaxMeta = {
  hsnCode: "8523",
  gstRateBps: 1800,
  taxInclusive: true,
};

const OFF_META: PublicTaxMeta = {
  hsnCode: null,
  gstRateBps: null,
  taxInclusive: false,
};

const BREAKDOWN: PricedTaxBreakdown = {
  taxablePaise: 49950,
  taxPaise: 8991,
  grossPaise: 58941,
  gstRateBps: 1800,
  treatment: "TAX_EXCLUSIVE",
};

/** Any rupee amount / bare tax-paise digits that must NOT appear when gated. */
const AMOUNT = /₹\s?\d|8991|89\.91/;

describe("GstPriceLabel", () => {
  it("gated (no breakdown): shows a rate-only hint with NO amount", () => {
    const { container } = render(<GstPriceLabel tax={EXCLUSIVE_META} />);
    expect(container.textContent).toContain("+ 18% GST");
    expect(container.textContent ?? "").not.toMatch(AMOUNT);
  });

  it("inclusive treatment reads 'incl. X% GST'", () => {
    const { container } = render(<GstPriceLabel tax={INCLUSIVE_META} />);
    expect(container.textContent).toContain("incl. 18% GST");
  });

  it("priced (breakdown supplied): appends the paise GST subline", () => {
    const { container } = render(
      <GstPriceLabel tax={EXCLUSIVE_META} breakdown={BREAKDOWN} />,
    );
    // ₹89.91 is the formatted taxPaise (8991).
    expect(container.textContent).toContain("₹89.91");
  });

  it("view preference flips the wording without changing the figure", () => {
    // Shown exclusive, but the retailer asked to see the inclusive caption.
    const { container } = render(
      <GstPriceLabel tax={EXCLUSIVE_META} view="incl" />,
    );
    expect(container.textContent).toContain("incl. 18% GST");
  });

  it("GST off (gstRateBps null): renders nothing", () => {
    const { container } = render(<GstPriceLabel tax={OFF_META} />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("[data-slot='gst-label']")).toBeNull();
  });

  it("formats a fractional rate (1250 bps → 12.5%)", () => {
    const { container } = render(
      <GstPriceLabel tax={{ ...EXCLUSIVE_META, gstRateBps: 1250 }} />,
    );
    expect(container.textContent).toContain("+ 12.5% GST");
  });
});
