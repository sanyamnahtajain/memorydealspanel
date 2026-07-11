/**
 * PRICE-GATE render safety for the VIEW MODES (compact + table).
 *
 * The headline listing feature ships three renderers. The sacred rule: an
 * anon / non-approved viewer must NEVER see a price in ANY view — including the
 * TABLE, whose price column must render the locked chip, not an amount.
 *
 * This proves it end-to-end in the DOM: build a listing item exactly as the
 * server does for an anon viewer — a `PublicProduct` (structurally NO price
 * field) plus a `priceSlot` that is the real {@link PriceGateCard} in its
 * locked state, and NO `priceSortKey` — then render both the compact and the
 * table views and assert:
 *   1. no rupee amount / price digits appear anywhere in the DOM;
 *   2. the locked "See price" affordance IS present in the price cell;
 *   3. (table) a "Price" header exists but carries only the lock, and the
 *      price sort is NOT offered (no sortable price header) for a gated viewer.
 *
 * A companion case renders the approved (PricedProduct) path to prove the
 * price DOES show, so the gate is the discriminator — not a broken renderer.
 */
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// Each row now carries a wishlist HeartButton, which calls `useRouter()` (to
// route anon taps to login). The renderers aren't mounted inside an app-router
// provider here, so stub next/navigation. Irrelevant to the price-gate asserts.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

import { PriceGateCard } from "@/components/storefront/PriceGateCard";
import type { PublicProduct, PricedProduct } from "@/server/dto/product";
import { ProductTableView } from "./ProductTableView";
import { ProductCompactView } from "./ProductCompactView";
import type { ListingItem } from "./types";

// jsdom lacks matchMedia; the locked path mounts RequestAccessSheet which reads
// it via use-is-mobile. Stub to desktop so the tree mounts. Irrelevant to the
// price-gate assertions.
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

/** A gated product exactly as the DAL hands an anon viewer: NO price key. */
const publicProduct: PublicProduct = {
  id: "prod_public",
  categoryId: "cat_1",
  name: "Kingston 16GB DDR4 DIMM",
  slug: "kingston-16gb-ddr4",
  sku: "KVR-16-DDR4",
  brand: "Kingston",
  brandRef: null,
  description: "High-density desktop memory.",
  specs: { capacity: "16GB", type: "DDR4" },
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

const pricedProduct: PricedProduct = {
  ...publicProduct,
  id: "prod_priced",
  price: 129900, // ₹1,299.00
  mrp: 159900,
  marginPct: 19,
  variants: [],
};

/** Any rupee amount or bare price digit that must NOT appear when gated. */
const PRICE_LEAK = /₹\s?\d|1,?299|1299|1,?599|1599/;

/** Build a listing item the way the server does — gated: locked slot, no key. */
function gatedItem(): ListingItem {
  return {
    product: publicProduct,
    priceSlot: <PriceGateCard product={publicProduct} canSeePrices={false} />,
    // priceSortKey intentionally omitted for a gated viewer.
  };
}

/** Build a listing item for an approved viewer — real price in the slot. */
function pricedItem(): ListingItem {
  return {
    product: pricedProduct,
    priceSlot: <PriceGateCard product={pricedProduct} canSeePrices={true} />,
    priceSortKey: pricedProduct.price,
  };
}

describe("ProductTableView — price-gate render safety", () => {
  it("gated anon row shows the locked chip and NO price value in the price cell", () => {
    const { container } = render(
      <ProductTableView
        items={[gatedItem()]}
        sort="newest"
        onSort={() => {}}
        canSortPrice={false}
      />,
    );

    // Sanity: the DTO genuinely carries no price field.
    expect("price" in publicProduct).toBe(false);
    // The whole table has no rupee amount / price digits.
    expect(container.textContent ?? "").not.toMatch(PRICE_LEAK);
    // The locked "See price" affordance is rendered in the price cell.
    expect(
      screen.getByRole("button", { name: /see price/i }),
    ).toBeInTheDocument();
  });

  it("does NOT offer a sortable price header for a gated viewer", () => {
    render(
      <ProductTableView
        items={[gatedItem()]}
        sort="newest"
        onSort={() => {}}
        canSortPrice={false}
      />,
    );

    // A "Price" column header exists...
    const priceHeader = screen.getByRole("columnheader", { name: /price/i });
    expect(priceHeader).toBeInTheDocument();
    // ...but it is NOT a sort button (price sort requires seeing prices).
    expect(
      within(priceHeader).queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  it("approved row DOES render the price in the price cell", () => {
    render(
      <ProductTableView
        items={[pricedItem()]}
        sort="newest"
        onSort={() => {}}
        canSortPrice={true}
      />,
    );

    const reveal = document.querySelector('[data-slot="price-reveal"]');
    expect(reveal?.textContent ?? "").toMatch(/₹1,299/);
    // Price sort IS offered now.
    const priceHeader = screen.getByRole("columnheader", { name: /price/i });
    expect(within(priceHeader).getByRole("button")).toBeInTheDocument();
  });
});

describe("ProductCompactView — price-gate render safety", () => {
  it("gated anon row shows the locked chip and NO price value", () => {
    const { container } = render(<ProductCompactView items={[gatedItem()]} />);

    expect(container.textContent ?? "").not.toMatch(PRICE_LEAK);
    expect(
      screen.getByRole("button", { name: /see price/i }),
    ).toBeInTheDocument();
  });

  it("approved row DOES render the price", () => {
    const { container } = render(<ProductCompactView items={[pricedItem()]} />);

    expect(container.textContent ?? "").toMatch(/₹1,299/);
    expect(
      screen.queryByRole("button", { name: /see price/i }),
    ).not.toBeInTheDocument();
  });
});
