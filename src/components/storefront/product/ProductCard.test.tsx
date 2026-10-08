/**
 * ProductCard — the shared card's two load-bearing behaviours:
 *   1. the hover second image costs nothing until a MOUSE actually hovers
 *      (not in the markup on mount, not armed by a touch pointer), and the
 *      first image carries the shared-element seam only when asked;
 *   2. the price slot is PLACED, never read — whatever node arrives is what
 *      renders, and a null slot renders no bottom row at all.
 *
 * PRICE GATE: the slot here is an opaque marker; no amount is involved.
 */
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { PublicProduct } from "@/server/dto/product";
import { ProductCard, cardImages, cardSpecSnippet } from "./ProductCard";

beforeAll(() => {
  // jsdom has no PointerEvent; React derives onPointerEnter from pointerover,
  // and the card reads `pointerType` off that event.
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventPolyfill extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? "";
      }
    }
    window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
  }
});

afterEach(cleanup);

const base: PublicProduct = {
  id: "prod_1",
  categoryId: "cat_1",
  name: "Boat Rockerz 450 Bluetooth Headphones",
  slug: "boat-rockerz-450",
  sku: "BR-450",
  brand: "BOAT",
  brandRef: null,
  description: null,
  specs: { battery: "15h", type: "Over-ear" },
  moq: 5,
  packMultiple: null,
  maxQty: null,
  allowRequirementNotes: false,
  allocation: null,
  stockStatus: "IN_STOCK",
  status: "ACTIVE",
  tags: ["bluetooth"],
  images: [
    { url: "/img/second.jpg", thumbUrl: null, sortOrder: 2, isPrimary: false },
    { url: "/img/primary.jpg", thumbUrl: null, sortOrder: 1, isPrimary: true },
  ],
  videos: [],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  hasVariants: false,
  optionTypes: [],
  variants: [],
  tax: { hsnCode: null, gstRateBps: null, taxInclusive: false },
};

describe("cardImages / cardSpecSnippet", () => {
  it("leads with the primary image and offers the next in order as the hover shot", () => {
    const { primary, secondary } = cardImages(base);
    expect(primary?.url).toBe("/img/primary.jpg");
    expect(secondary?.url).toBe("/img/second.jpg");
  });

  it("has no hover shot for a single-image product", () => {
    const one = { ...base, images: [base.images[1]!] };
    expect(cardImages(one).secondary).toBeNull();
  });

  it("builds the spec snippet from specs, falling back to tags", () => {
    expect(cardSpecSnippet(base)).toBe("15h · Over-ear");
    expect(cardSpecSnippet({ ...base, specs: null })).toBe("bluetooth");
    expect(cardSpecSnippet({ ...base, specs: null, tags: [] })).toBeNull();
  });
});

describe("ProductCard", () => {
  it("renders brand, title, snippet and the price slot node it was handed", () => {
    render(
      <ProductCard
        product={base}
        priceSlot={<span data-testid="slot">SLOT</span>}
      />,
    );
    expect(screen.getByText("BOAT")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: base.name }),
    ).toBeInTheDocument();
    expect(screen.getByText("15h · Over-ear")).toBeInTheDocument();
    expect(screen.getByTestId("slot")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/p/boat-rockerz-450");
  });

  it("mounts only the primary image until a MOUSE hovers, then adds the second", () => {
    render(<ProductCard product={base} priceSlot={null} />);
    const link = screen.getByRole("link");

    // Mount: one <img>, the primary.
    expect(link.querySelectorAll("img")).toHaveLength(1);
    expect(link.querySelector("img")?.getAttribute("alt")).toBe(base.name);

    // A touch pointer never arms the second image.
    fireEvent.pointerOver(link, { pointerType: "touch" });
    expect(link.querySelectorAll("img")).toHaveLength(1);

    // A mouse does.
    fireEvent.pointerOver(link, { pointerType: "mouse" });
    const imgs = link.querySelectorAll("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[1]?.getAttribute("alt")).toBe("");
    expect(imgs[1]?.getAttribute("aria-hidden")).toBe("true");
  });

  it("never arms a hover image for a single-image product", () => {
    render(
      <ProductCard product={{ ...base, images: [base.images[1]!] }} priceSlot={null} />,
    );
    const link = screen.getByRole("link");
    fireEvent.pointerOver(link, { pointerType: "mouse" });
    expect(link.querySelectorAll("img")).toHaveLength(1);
  });

  it("carries the shared-element seam only when asked", () => {
    const { rerender } = render(<ProductCard product={base} priceSlot={null} />);
    expect(
      (screen.getByRole("link").querySelector("img") as HTMLElement).style
        .viewTransitionName,
    ).toBe("product-hero-prod_1");

    rerender(<ProductCard product={base} priceSlot={null} transitionSeam={false} />);
    expect(
      (screen.getByRole("link").querySelector("img") as HTMLElement).style
        .viewTransitionName,
    ).toBe("");
  });

  it("shows a designed placeholder when the product has no photo", () => {
    render(<ProductCard product={{ ...base, images: [] }} priceSlot={null} />);
    expect(screen.getByText("No photo yet")).toBeInTheDocument();
    expect(screen.getByRole("link").querySelectorAll("img")).toHaveLength(0);
  });
});
