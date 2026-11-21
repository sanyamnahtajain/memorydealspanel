import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/",
}));
const fetchMock = vi.fn();

import { SearchOverlay, _resetSuggestCacheForTests } from "./SearchOverlay";
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

function suggestions(items: { id: string; name: string }[]) {
  return new Response(
    JSON.stringify({ items: items.map((i) => ({ ...i, slug: i.id, brand: null, thumbUrl: null })) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  push.mockReset();
  window.localStorage.clear();
  _resetSuggestCacheForTests();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => suggestions([]));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

  it("has a visible Search button once something is typed (phones have no Enter key to find)", () => {
    render(<SearchOverlay open onClose={() => {}} />);
    // Empty box: only the tappable magnifier.
    expect(screen.getAllByRole("button", { name: "Search" })).toHaveLength(1);
    const input = screen.getByRole("combobox", { name: "Search products" });
    fireEvent.change(input, { target: { value: "neckband" } });
    const buttons = screen.getAllByRole("button", { name: "Search" });
    // The tappable magnifier and the green Search button both submit.
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[buttons.length - 1]);
    expect(push).toHaveBeenCalledWith("/search?q=neckband");
  });

  it("submits through the form when the keyboard sends no clean Enter (Android predictive text)", () => {
    render(<SearchOverlay open onClose={() => {}} />);
    const input = screen.getByRole("combobox", { name: "Search products" });
    fireEvent.change(input, { target: { value: "boat" } });
    // Mid-word the keydown is a composition Enter: ignored…
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(push).not.toHaveBeenCalled();
    // …and the keyboard's Search key submits the form.
    fireEvent.submit(screen.getByRole("search"));
    expect(push).toHaveBeenCalledWith("/search?q=boat");
  });

  it("asks the suggest API, cancels the stale request and reuses answers it has", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (url: string) =>
      suggestions(String(url).includes("q=char") ? [{ id: "p1", name: "Ambrane Charger" }] : []),
    );
    render(<SearchOverlay open onClose={() => {}} />);
    const input = screen.getByRole("combobox", { name: "Search products" });

    fireEvent.change(input, { target: { value: "cha" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    fireEvent.change(input, { target: { value: "char" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    // "cha" was cancelled before it was sent; only "char" went out.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/search/suggest?q=char");
    expect(screen.getByRole("option", { name: /Ambrane Charger/ })).toBeInTheDocument();

    // Back to "cha" and forward to "char" again: the second "char" is instant.
    fireEvent.change(input, { target: { value: "cha" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    fireEvent.change(input, { target: { value: "char" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("option", { name: /Ambrane Charger/ })).toBeInTheDocument();
  });

  it("narrows what it already has while the server is asked (slow lines)", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("q=char")) return suggestions([{ id: "p1", name: "Ambrane Charger" }, { id: "p2", name: "Char Cable" }]);
      await new Promise<void>((r) => (release = r));
      return suggestions([{ id: "p1", name: "Ambrane Charger" }]);
    });
    render(<SearchOverlay open onClose={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1); // the sheet finishes opening
    });
    const input = screen.getByRole("combobox", { name: "Search products" });
    fireEvent.change(input, { target: { value: "char" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    // "charg": the server hasn't answered yet, but the list already narrowed.
    fireEvent.change(input, { target: { value: "charg" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Ambrane Charger/ })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      release();
    });
  });

  it("renders nothing when closed", () => {
    render(<SearchOverlay open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
