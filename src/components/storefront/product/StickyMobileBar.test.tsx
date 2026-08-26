/**
 * StickyMobileBar — one-tap add-to-cart (ORDER_FLOW proposal 1).
 *
 * The contract this suite pins down:
 *   1. With `addToCart` set (a PRICED viewer on a plain in-stock product) the
 *      bar's primary slot is a REAL "Add to cart" button that posts the
 *      pack-aligned MOQ through the same action AddToCartButton uses, then
 *      fires the same toasts and the same cart-count broadcast; Enquire
 *      collapses to an icon.
 *   2. Without `addToCart` (variant / allocation / out-of-stock products —
 *      the page never sets the prop for those) the priced bar keeps its
 *      previous layout: price + wide Enquire, no add button.
 *   3. The gated branches (anon "See price") are untouched — `addToCart` is
 *      never set for a gated viewer, and even if it were, the bar refuses to
 *      render an add without a live price.
 *
 * The PRICE GATE is out of scope here beyond branch 3: the bar only ever
 * receives a server-formatted `priceLabel` string, never an amount.
 */
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const routerPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
  usePathname: () => "/p/test-product",
  useSearchParams: () => new URLSearchParams(),
}));

const addToCartAction = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/cart", () => ({
  addToCartAction,
  cartLineSummariesAction: vi.fn(async () => []),
}));

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

// The sheet drags in the whole request-access flow; the bar only needs the
// seam to exist.
vi.mock("@/components/storefront/RequestAccessSheet", () => ({
  RequestAccessSheet: () => null,
}));

import { CART_COUNT_EVENT } from "@/components/storefront/cart/CartBadge";
import { StickyMobileBar } from "./StickyMobileBar";
import { PRICE_PANEL_ID } from "./price-panel";

beforeAll(() => {
  // jsdom lacks matchMedia (useReducedMotion).
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
  // jsdom lacks IntersectionObserver. Report the price panel as OFF screen
  // immediately, so the bar enters (its live-entrance cue).
  window.IntersectionObserver = class {
    private cb: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb(
        [{ isIntersecting: false, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Renders the bar next to a stub price panel (its entrance observer target). */
function renderBar(props: Partial<React.ComponentProps<typeof StickyMobileBar>>) {
  return render(
    <>
      <div id={PRICE_PANEL_ID} />
      <StickyMobileBar
        enquireHref="https://wa.me/911234567890"
        canSeePrices={false}
        {...props}
      />
    </>,
  );
}

const PRICED = {
  canSeePrices: true,
  priceLabel: "₹499.50",
  status: "APPROVED" as const,
};

describe("StickyMobileBar one-tap add", () => {
  it("adds the pack-aligned MOQ through the shared flow and broadcasts the count", async () => {
    addToCartAction.mockResolvedValue({
      ok: true,
      quantity: 12,
      itemCount: 3,
      lineCount: 1,
      clamped: false,
    });
    const counts: number[] = [];
    const onCount = (e: Event) => counts.push((e as CustomEvent<number>).detail);
    window.addEventListener(CART_COUNT_EVENT, onCount);

    renderBar({
      ...PRICED,
      // MOQ 10 in packs of 6 → the one-tap quantity is 12 (exactly what
      // AddToCartButton seeds its stepper with).
      addToCart: { productId: "prod_1", moq: 10, packMultiple: 6 },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    await waitFor(() =>
      expect(addToCartAction).toHaveBeenCalledWith({
        productId: "prod_1",
        quantity: 12,
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Added to cart.",
        expect.objectContaining({ action: expect.anything() }),
      ),
    );
    expect(counts).toEqual([3]);
    // Enquire collapsed to an icon — reachable, but no longer the wide CTA.
    expect(
      screen.getByRole("link", { name: "Enquire on WhatsApp" }),
    ).not.toHaveTextContent("Enquire");
    window.removeEventListener(CART_COUNT_EVENT, onCount);
  });

  it("shows the same clamped toast AddToCartButton shows", async () => {
    addToCartAction.mockResolvedValue({
      ok: true,
      quantity: 12,
      itemCount: 1,
      lineCount: 1,
      clamped: true,
    });

    renderBar({
      ...PRICED,
      addToCart: { productId: "prod_1", moq: 10, packMultiple: 6 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Added — quantity adjusted to 12 (packs of 6).",
        expect.anything(),
      ),
    );
  });

  it("spins while the add is pending", async () => {
    let resolve!: (v: unknown) => void;
    addToCartAction.mockReturnValue(new Promise((r) => (resolve = r)));

    renderBar({
      ...PRICED,
      addToCart: { productId: "prod_1", moq: null, packMultiple: null },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    const busy = await screen.findByRole("button", { name: "Adding…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");

    resolve({ ok: true, quantity: 1, itemCount: 1, lineCount: 1, clamped: false });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add to cart" })).toBeEnabled(),
    );
  });

  it("routes a server refusal exactly like AddToCartButton", async () => {
    addToCartAction.mockResolvedValue({
      ok: false,
      reason: "needs-approval",
      message: "Your account is awaiting approval.",
    });

    renderBar({
      ...PRICED,
      addToCart: { productId: "prod_1", moq: null, packMultiple: null },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("Your account is awaiting approval."),
    );
    expect(routerPush).toHaveBeenCalledWith("/account?request=1");
  });

  it("keeps the wide Enquire CTA when no addToCart is given (variant / allocation / OOS)", () => {
    renderBar({ ...PRICED, addToCart: null });

    expect(screen.queryByRole("button", { name: "Add to cart" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Enquire on WhatsApp" }),
    ).toHaveTextContent("Enquire");
  });

  it("never renders an add without a live price, and the anon gate branch is unchanged", () => {
    renderBar({
      canSeePrices: false,
      // Hostile prop combination the page never produces — the bar refuses.
      addToCart: { productId: "prod_1", moq: null, packMultiple: null },
    });

    expect(screen.queryByRole("button", { name: "Add to cart" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "See price — request access" }),
    ).toBeInTheDocument();
  });
});
