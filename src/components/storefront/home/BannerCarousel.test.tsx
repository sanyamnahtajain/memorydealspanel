import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { BannerCarousel } from "./BannerCarousel";
import type { StorefrontBanner } from "@/lib/banners";

// jsdom ships neither matchMedia nor IntersectionObserver nor ResizeObserver, and embla asks for
// all of them on mount (breakpoint options, slides-in-view, resize) — as does
// useReducedMotion. Inert stubs are the right default here: motion is on, no
// responsive option is active, and nothing is reported as scrolled into view.
class InertObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeAll(() => {
  Object.defineProperty(window, "IntersectionObserver", {
    writable: true,
    value: InertObserver,
  });
  Object.defineProperty(globalThis, "IntersectionObserver", {
    writable: true,
    value: InertObserver,
  });
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: InertObserver,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: InertObserver,
  });
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

const banner: StorefrontBanner = {
  id: "b1",
  imageUrl: "https://cdn.example.test/banners/diwali.jpg",
  mobileImageUrl: null,
  alt: "Diwali sale — 20% off all chargers",
  href: "/c/chargers",
};

/** Pretend an <img> has finished loading and produced nothing — a failure. */
function markAsAlreadyFailed() {
  Object.defineProperty(HTMLImageElement.prototype, "complete", {
    configurable: true,
    get: () => true,
  });
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
    configurable: true,
    get: () => 0,
  });
  return () => {
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)
      .complete;
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)
      .naturalWidth;
  };
}

/**
 * The banner slot is the first thing on the home page and its artwork lives on
 * object storage, so it can fail on its own — offline, a flaky phone
 * connection, a deleted object. What must never happen is the browser's raw
 * broken-image glyph sitting in the hero of a shop.
 */
describe("BannerCarousel", () => {
  it("renders nothing at all when there are no banners", () => {
    const { container } = render(<BannerCarousel banners={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reserves its height before the artwork arrives", () => {
    const { container } = render(<BannerCarousel banners={[banner]} />);
    // No layout shift: the frame carries an aspect ratio, not an auto height.
    expect(container.querySelector(".aspect-\\[2\\/1\\]")).not.toBeNull();
  });

  it("shows no dots or carousel semantics for a single banner", () => {
    render(<BannerCarousel banners={[banner]} />);
    expect(screen.queryByLabelText(/show offer/i)).toBeNull();
    expect(screen.getByLabelText("Offers")).not.toHaveAttribute(
      "aria-roledescription",
    );
  });

  it("falls back to the banner's own words when the artwork fails to load", () => {
    render(<BannerCarousel banners={[banner]} />);
    const image = screen.getByAltText(banner.alt);

    act(() => {
      fireEvent.error(image);
    });

    expect(screen.queryByAltText(banner.alt)).toBeNull();
    expect(screen.getByText(banner.alt)).toBeInTheDocument();
  });

  it("catches artwork that had already failed before hydration", () => {
    // THE OFFLINE CASE. The markup is server-rendered, so the browser can
    // finish and fail the request before React attaches its onError handler —
    // no error event ever reaches the component. Without the ref check the
    // slot keeps the broken-image glyph forever.
    const restore = markAsAlreadyFailed();
    try {
      render(<BannerCarousel banners={[banner]} />);
      expect(screen.getByText(banner.alt)).toBeInTheDocument();
      expect(screen.queryByAltText(banner.alt)).toBeNull();
    } finally {
      restore();
    }
  });

  it("keeps the banner clickable even when its artwork is gone", () => {
    const restore = markAsAlreadyFailed();
    try {
      render(<BannerCarousel banners={[banner]} />);
      expect(screen.getByText(banner.alt).closest("a")).toHaveAttribute(
        "href",
        "/c/chargers",
      );
    } finally {
      restore();
    }
  });

  it("hardens an off-site campaign link", () => {
    render(
      <BannerCarousel
        banners={[{ ...banner, href: "https://brand.example.test/diwali" }]}
      />,
    );
    const link = screen.getByAltText(banner.alt).closest("a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
