/**
 * Cursor threading through {@link StorefrontListing} (perf finding 1).
 *
 * The old load-more asked for `page × 24` rows and treated a SHORT PAGE as
 * end-of-list — which, combined with the discovery layer's 100-row clamp,
 * silently capped every listing at 100 products. The cursor contract this
 * suite pins down:
 *   1. the first click hands `loadMore` the server-rendered first page's
 *      `nextCursor`, and each later click hands the cursor the PREVIOUS call
 *      returned (the client threads it through state);
 *   2. a short page with a non-null cursor does NOT end the list — only
 *      `nextCursor === null` does;
 *   3. `initialNextCursor === null` means no load-more affordance at all;
 *   4. a facet or sort change RESETS the cursor to the fresh server-rendered
 *      page's cursor (and drops the appended pages).
 *
 * The server half of the contract (cursor in → one page + nextCursor out,
 * >100 products reachable, no re-count) is proven against the real DB in
 * `src/server/storefront/discovery.test.ts`. What remains browser-only is the
 * IntersectionObserver auto-load (stubbed inert here) and the RSC round-trip
 * that delivers fresh props on navigation — this suite simulates that arrival
 * via rerender, exactly the prop/searchParams pair Next commits together.
 */
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  search: "",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: nav.replace,
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
  usePathname: () => "/c/test-category",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { PreferencesProvider } from "@/components/preferences/PreferencesProvider";
import type { PublicProduct } from "@/server/dto/product";
import { StorefrontListing } from "./StorefrontListing";
import type { ListingItem, LoadMoreResult } from "./types";

beforeAll(() => {
  // jsdom lacks matchMedia (useIsMobile, reduced-motion checks).
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
  // jsdom lacks IntersectionObserver; an inert stub keeps the auto-load
  // sentinel from throwing — every load here is an explicit button click.
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  cleanup();
  nav.search = "";
  vi.clearAllMocks();
});

/** Minimal gated product — structurally NO price key, no variants. */
function makeProduct(n: number): PublicProduct {
  return {
    id: `prod_${n}`,
    categoryId: "cat_1",
    name: `Test Product ${n}`,
    slug: `test-product-${n}`,
    sku: `SKU-${n}`,
    brand: null,
    brandRef: null,
    description: "",
    specs: {},
    moq: 1,
    packMultiple: null,
    maxQty: null,
    allowRequirementNotes: false,
    allocation: null,
    stockStatus: "IN_STOCK",
    status: "ACTIVE",
    tags: [],
    images: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    hasVariants: false,
    optionTypes: [],
    variants: [],
    tax: { hsnCode: null, gstRateBps: null, taxInclusive: false },
  };
}

function makeItems(from: number, count: number): ListingItem[] {
  return Array.from({ length: count }, (_, i) => ({
    product: makeProduct(from + i),
    priceSlot: <span>See price</span>,
  }));
}

function renderListing(
  ui: {
    initialItems: ListingItem[];
    initialNextCursor: string | null;
    loadMore?: (cursor: string) => Promise<LoadMoreResult>;
    total?: number;
  },
) {
  const view = render(
    <PreferencesProvider>
      <StorefrontListing
        initialItems={ui.initialItems}
        loadMore={ui.loadMore}
        initialNextCursor={ui.initialNextCursor}
        canSeePrices={false}
        total={ui.total}
      />
    </PreferencesProvider>,
  );
  const rerender = (next: typeof ui) =>
    view.rerender(
      <PreferencesProvider>
        <StorefrontListing
          initialItems={next.initialItems}
          loadMore={next.loadMore}
          initialNextCursor={next.initialNextCursor}
          canSeePrices={false}
          total={next.total}
        />
      </PreferencesProvider>,
    );
  return { ...view, rerenderListing: rerender };
}

const loadMoreButton = () => screen.queryByRole("button", { name: "Load more" });

describe("StorefrontListing cursor threading", () => {
  it("threads each returned nextCursor into the next loadMore call", async () => {
    const loadMore = vi
      .fn<(cursor: string) => Promise<LoadMoreResult>>()
      .mockResolvedValueOnce({ items: makeItems(3, 2), nextCursor: "c2" })
      // Final page: SHORT (1 item) AND null cursor — the null is the signal.
      .mockResolvedValueOnce({ items: makeItems(5, 1), nextCursor: null });

    renderListing({
      initialItems: makeItems(1, 2),
      initialNextCursor: "c1",
      loadMore,
      total: 5,
    });

    fireEvent.click(loadMoreButton()!);
    await waitFor(() => expect(screen.getByText("Test Product 3")).toBeInTheDocument());
    expect(loadMore).toHaveBeenNthCalledWith(1, "c1");

    fireEvent.click(loadMoreButton()!);
    await waitFor(() => expect(screen.getByText("Test Product 5")).toBeInTheDocument());
    expect(loadMore).toHaveBeenNthCalledWith(2, "c2");

    // nextCursor === null ⇒ exhausted ⇒ the affordance is gone.
    expect(loadMoreButton()).toBeNull();
    // All five products are on the page.
    for (let n = 1; n <= 5; n++) {
      expect(screen.getByText(`Test Product ${n}`)).toBeInTheDocument();
    }
  });

  it("does NOT end the list on a short page while the cursor is non-null", async () => {
    // The 100-product cap regression: the old client treated a short page as
    // "done". A short page with a live cursor must keep the button.
    const loadMore = vi
      .fn<(cursor: string) => Promise<LoadMoreResult>>()
      .mockResolvedValue({ items: makeItems(3, 1), nextCursor: "c2" });

    renderListing({
      initialItems: makeItems(1, 2),
      initialNextCursor: "c1",
      loadMore,
      total: 10,
    });

    fireEvent.click(loadMoreButton()!);
    await waitFor(() => expect(screen.getByText("Test Product 3")).toBeInTheDocument());
    expect(loadMoreButton()).not.toBeNull();
  });

  it("offers no load-more at all when the first page is the whole result", () => {
    renderListing({
      initialItems: makeItems(1, 2),
      initialNextCursor: null,
      loadMore: vi.fn(),
      total: 2,
    });
    expect(loadMoreButton()).toBeNull();
  });

  it("resets the cursor (and appended pages) when a facet param changes", async () => {
    const loadMore = vi
      .fn<(cursor: string) => Promise<LoadMoreResult>>()
      .mockResolvedValue({ items: makeItems(3, 1), nextCursor: "c2" });

    const view = renderListing({
      initialItems: makeItems(1, 2),
      initialNextCursor: "c1",
      loadMore,
      total: 10,
    });

    fireEvent.click(loadMoreButton()!);
    await waitFor(() => expect(screen.getByText("Test Product 3")).toBeInTheDocument());

    // A filter change: the URL gains a facet param and the server re-renders
    // the page with a fresh first page + cursor (+ a fresh total, carried by
    // the `total` prop). Both arrive in the same commit.
    nav.search = "stock=IN_STOCK";
    view.rerenderListing({
      initialItems: makeItems(11, 2),
      initialNextCursor: "fresh-cursor",
      loadMore,
      total: 4,
    });

    // Appended pages from the old filter are gone.
    expect(screen.queryByText("Test Product 3")).toBeNull();
    // And the next load-more starts from the NEW first page's cursor.
    fireEvent.click(loadMoreButton()!);
    await waitFor(() =>
      expect(loadMore).toHaveBeenLastCalledWith("fresh-cursor"),
    );
  });

  it("resets the cursor when the sort changes (a cursor is order-specific)", async () => {
    const loadMore = vi
      .fn<(cursor: string) => Promise<LoadMoreResult>>()
      .mockResolvedValue({ items: makeItems(3, 1), nextCursor: "c2" });

    const view = renderListing({
      initialItems: makeItems(1, 2),
      initialNextCursor: "c1",
      loadMore,
      total: 10,
    });

    fireEvent.click(loadMoreButton()!);
    await waitFor(() => expect(loadMore).toHaveBeenCalledWith("c1"));

    nav.search = "sort=name";
    view.rerenderListing({
      initialItems: makeItems(21, 2),
      initialNextCursor: "name-cursor",
      loadMore,
      total: 10,
    });

    fireEvent.click(loadMoreButton()!);
    await waitFor(() =>
      expect(loadMore).toHaveBeenLastCalledWith("name-cursor"),
    );
  });
});
