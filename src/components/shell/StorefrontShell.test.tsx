import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/categories",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// Server action module — never executed in a unit test.
vi.mock("@/components/storefront/search/actions", () => ({
  searchCategoryChips: () => Promise.resolve([]),
}));
vi.mock("@/app/(storefront)/search/actions", () => ({
  searchSuggestions: () => Promise.resolve([]),
}));
// Chrome that fetches gated APIs or reads engagement state — stubbed to nothing.
vi.mock("@/components/access/AccessStatusBanner", () => ({ AccessStatusBanner: () => null }));
vi.mock("@/components/access/TrustStrip", () => ({ TrustStrip: () => null }));
vi.mock("@/components/slaby/SlabyPromoCard", () => ({ SlabyPromoCard: () => null }));
vi.mock("@/components/notify/NotifyGate", () => ({ NotifyGate: () => null }));
vi.mock("@/components/brand/IndependenceBadge", () => ({ IndependenceBadge: () => null }));
vi.mock("@/components/theme/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/shell/StorefrontFooter", () => ({ StorefrontFooter: () => null }));
vi.mock("@/components/storefront/wishlist/WishlistBadge", () => ({
  WishlistBadge: ({ className }: { className?: string }) => (
    <a href="/account/wishlist" aria-label="Wishlist" className={className} />
  ),
}));
vi.mock("@/components/storefront/cart/CartBadge", () => ({
  CartBadge: ({ className }: { className?: string }) => (
    <a href="/account/cart" aria-label="Cart" className={className} />
  ),
}));

import { StorefrontShell, SHELL_METRICS } from "./StorefrontShell";
import { storefrontNav } from "./nav";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(cleanup);

describe("StorefrontShell", () => {
  it("renders exactly the five storefrontNav items in the bottom tab bar", () => {
    render(
      <StorefrontShell cartCount={2}>
        <p>content</p>
      </StorefrontShell>,
    );
    const navs = screen.getAllByRole("navigation", { name: "Primary" });
    // Desktop pills + mobile tab bar both carry the "Primary" label.
    const tabBar = navs.find((n) => n.className.includes("fixed"));
    expect(tabBar).toBeDefined();
    const tabs = within(tabBar!).getAllByRole("link");
    expect(tabs).toHaveLength(5);
    expect(storefrontNav).toHaveLength(5);
    expect(tabs.map((t) => t.getAttribute("href"))).toEqual(storefrontNav.map((i) => i.href));
    // Reels is NOT a tab.
    expect(tabs.some((t) => t.getAttribute("href") === "/reels")).toBe(false);
  });

  it("has a Reels entry point in the header action group", () => {
    render(
      <StorefrontShell>
        <p>content</p>
      </StorefrontShell>,
    );
    const reels = screen.getByRole("link", { name: "Reels" });
    expect(reels).toHaveAttribute("href", "/reels");
    expect(reels.closest("header")).not.toBeNull();
  });

  it("publishes --md-tab-h and --md-header-h on its root wrapper", () => {
    const { container } = render(
      <StorefrontShell>
        <p>content</p>
      </StorefrontShell>,
    );
    const root = container.querySelector<HTMLElement>('[data-shell="storefront"]');
    expect(root).not.toBeNull();
    expect(root!.style.getPropertyValue("--md-tab-h")).toBe(SHELL_METRICS.tabBarHeight);
    expect(root!.style.getPropertyValue("--md-header-h")).toBe(SHELL_METRICS.condensedHeaderHeight);
  });

  it("marks the current route active and opens search from the header", () => {
    render(
      <StorefrontShell>
        <p>content</p>
      </StorefrontShell>,
    );
    const current = screen.getAllByRole("link", { current: "page" });
    expect(current.length).toBeGreaterThan(0);
    expect(current.every((l) => l.getAttribute("href") === "/categories")).toBe(true);

    const search = screen.getByRole("button", { name: "Search" });
    expect(search).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(search);
    expect(search).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Search products" })).toBeInTheDocument();
  });

  it("opens search with ⌘K / Ctrl+K", () => {
    render(
      <StorefrontShell>
        <p>content</p>
      </StorefrontShell>,
    );
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Search products" })).toBeInTheDocument();
  });
});
