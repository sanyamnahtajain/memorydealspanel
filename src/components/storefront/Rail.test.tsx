import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Rail } from "./Rail";

afterEach(cleanup);

/** jsdom has no layout, so overflow is staged through the scroll geometry. */
function stageOverflow(ul: HTMLElement, { scrollWidth, clientWidth, scrollLeft }: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
  Object.defineProperty(ul, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(ul, "clientWidth", { configurable: true, value: clientWidth });
  Object.defineProperty(ul, "scrollLeft", { configurable: true, writable: true, value: scrollLeft });
}

describe("Rail", () => {
  it("renders the server-rendered items and no chrome when nothing overflows", () => {
    render(
      <Rail listClassName="flex" ariaLabel="Products">
        <li>one</li>
        <li>two</li>
      </Rail>,
    );
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /scroll/i })).toBeNull();
  });

  it("shows a forward arrow when the list continues off-screen, and pages by most of a viewport", () => {
    render(
      <Rail listClassName="flex" ariaLabel="Products">
        <li>one</li>
      </Rail>,
    );
    const ul = screen.getByRole("list", { name: "Products" });
    stageOverflow(ul, { scrollWidth: 2000, clientWidth: 800, scrollLeft: 0 });
    const scrollBy = vi.fn();
    (ul as unknown as { scrollBy: typeof scrollBy }).scrollBy = scrollBy;
    fireEvent.scroll(ul);

    const forward = screen.getByRole("button", { name: "Scroll forward" });
    expect(forward).toHaveAttribute("tabindex", "0");
    // At the start there is nothing behind us: the back arrow is parked —
    // out of the tab order and hidden from assistive tech.
    const back = document.querySelector('button[aria-label="Scroll back"]');
    expect(back).toHaveAttribute("tabindex", "-1");
    expect(back).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(forward);
    expect(scrollBy).toHaveBeenCalledWith({ left: 800 * 0.85, behavior: "smooth" });

    // Keyboard works on the focused rail too.
    fireEvent.keyDown(ul, { key: "ArrowLeft" });
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -(800 * 0.85), behavior: "smooth" });
  });
});
