/**
 * COMPONENT-LEVEL price-gate security test.
 *
 * The price gate has two enforcement layers: the DAL never *serializes* a price
 * for an unauthorised viewer (proven in `price-gate.invariant.test.ts`), and
 * the render layer never *displays* one. This file proves the second layer end
 * to end, in the DOM:
 *
 *   1. Render the storefront price controls with `canSeePrices={false}` and a
 *      `PublicProduct` that structurally has NO price field. Assert the
 *      rendered DOM contains no ₹ amount / no price digits, and that the locked
 *      "See price" affordance is shown instead.
 *   2. Render with `canSeePrices={true}` and a real `PricedProduct`. Assert the
 *      price IS shown.
 *
 * This guards against a regression where a component starts reading a price it
 * shouldn't, or renders one that leaked into props.
 */
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PriceGateCard } from "@/components/storefront/PriceGateCard";
import { ProductPriceArea } from "@/app/(storefront)/p/[slug]/ProductPriceArea";
import type { PublicProduct, PricedProduct } from "@/server/dto/product";

// jsdom has no `matchMedia`; the gated paths mount `RequestAccessSheet`, which
// reads it via `use-is-mobile`. Stub it (defaults to desktop) so the component
// tree mounts. This does not affect the price-gate assertions below.
beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

afterEach(cleanup);

/**
 * A gated product exactly as the DAL hands it to an unauthorised viewer: an
 * explicit allow-list with NO `price`/`mrp`/`marginPct` keys. `"price" in
 * publicProduct` is therefore `false`, matching the real projection.
 */
const publicProduct: PublicProduct = {
  id: "prod_public",
  categoryId: "cat_1",
  name: "Kingston 16GB DDR4 DIMM",
  slug: "kingston-16gb-ddr4",
  sku: "KVR-16-DDR4",
  brand: "Kingston",
  brandRef: null,
  description: "High-density desktop memory.",
  specs: null,
  moq: 10,
  stockStatus: "IN_STOCK",
  status: "ACTIVE",
  tags: ["ddr4"],
  images: [],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  hasVariants: false,
  optionTypes: [],
  variants: [],
};

/** The same product WITH pricing, as served to a price-authorised viewer. */
const pricedProduct: PricedProduct = {
  ...publicProduct,
  id: "prod_priced",
  price: 129900, // ₹1,299.00
  mrp: 159900, // ₹1,599.00
  marginPct: 19,
  variants: [],
};

/** Any Indian-rupee amount or bare price digit that must NOT appear when gated. */
const PRICE_LEAK = /₹\s?\d|1,?299|1299|1,?599|1599/;

describe("PriceGateCard — price-gate render safety", () => {
  it("gated (canSeePrices=false, no price field) leaks no price and shows the locked affordance", () => {
    const { container } = render(
      <PriceGateCard product={publicProduct} canSeePrices={false} />,
    );

    // Sanity: the DTO genuinely carries no price field to leak.
    expect("price" in publicProduct).toBe(false);

    // No real rupee amount / price digits anywhere in the rendered DOM. The
    // blurred placeholder uses "•,•••", not digits, so this stays clean.
    expect(container.textContent ?? "").not.toMatch(PRICE_LEAK);

    // The locked "See price" affordance is present.
    expect(
      screen.getByRole("button", { name: /see price/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/see price/i)).toBeInTheDocument();
  });

  it("a logged-in customer without live access sees a status reason, still no price", () => {
    const { container } = render(
      <PriceGateCard
        product={publicProduct}
        canSeePrices={false}
        status="PENDING"
      />,
    );

    expect(container.textContent ?? "").not.toMatch(PRICE_LEAK);
    expect(screen.getByText(/awaiting approval/i)).toBeInTheDocument();
  });

  it("authorised (canSeePrices=true, PricedProduct) shows the price", () => {
    render(<PriceGateCard product={pricedProduct} canSeePrices={true} />);

    // The reveal renders the selling price inside the price-reveal slot.
    const reveal = document.querySelector('[data-slot="price-reveal"]');
    expect(reveal).not.toBeNull();
    expect(reveal?.textContent ?? "").toMatch(/₹1,299/);
    // No locked "See price" button in the authorised path.
    expect(
      screen.queryByRole("button", { name: /see price/i }),
    ).not.toBeInTheDocument();
  });
});

describe("ProductPriceArea — detail-page price-gate render safety", () => {
  it("gated shows the locked pill and no price", () => {
    const { container } = render(
      <ProductPriceArea product={publicProduct} showPrices={false} />,
    );

    expect(container.textContent ?? "").not.toMatch(PRICE_LEAK);
    // Locked affordance: the request-access CTA is offered to an anon viewer.
    expect(
      screen.getByRole("button", { name: /request access/i }),
    ).toBeInTheDocument();
  });

  it("authorised shows the wholesale price", () => {
    render(<ProductPriceArea product={pricedProduct} showPrices={true} />);

    // The formatted selling price is rendered.
    expect(screen.getByText(/₹1,299/)).toBeInTheDocument();
    expect(screen.getByText(/wholesale price/i)).toBeInTheDocument();
  });
});
