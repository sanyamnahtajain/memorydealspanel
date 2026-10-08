import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("@/app/(storefront)/search/actions", () => ({
  searchSuggestions: () => Promise.resolve([]),
}));

import { SearchOverlay } from "./SearchOverlay";
import { RECENTS_KEY } from "./search/recents";

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

beforeEach(() => {
  push.mockReset();
  window.localStorage.clear();
});
afterEach(cleanup);

describe("SearchOverlay", () => {
  it("renders recent searches as chips and submits one on tap", () => {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(["type c cable", "boat"]));
    const onClose = vi.fn();
    render(<SearchOverlay open onClose={onClose} categories={[{ name: "POWER BANKS", slug: "power-banks" }]} />);

    const recents = screen.getByRole("listbox", { name: "Recent searches" });
    const chips = screen.getAllByRole("option");
    expect(chips).toHaveLength(2);
    expect(recents.className).toContain("flex-wrap");

    // Category chips are display-cased and link to the category.
    const cat = screen.getByRole("link", { name: /Power Banks/ });
    expect(cat).toHaveAttribute("href", "/c/power-banks");

    fireEvent.click(chips[0]);
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/search?q=type%20c%20cable");
  });

  it("closes on Escape and keeps the dialog semantics", () => {
    const onClose = vi.fn();
    render(<SearchOverlay open onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Search products" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submits the typed query on Enter", () => {
    const onClose = vi.fn();
    render(<SearchOverlay open onClose={onClose} />);
    const input = screen.getByRole("combobox", { name: "Search products" });
    fireEvent.change(input, { target: { value: "  charger " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/search?q=charger");
    expect(JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? "[]")).toEqual(["charger"]);
  });

  it("renders nothing when closed", () => {
    render(<SearchOverlay open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
