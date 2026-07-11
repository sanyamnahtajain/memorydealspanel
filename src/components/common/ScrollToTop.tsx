"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Resets scroll to the top on every route change, so landing on a new page
 * always shows its content from the top.
 *
 * Handles BOTH scroll models in this app:
 *  - the window (the storefront scrolls the document), and
 *  - any nested element that owns its own scrolling (the admin content area is
 *    `overflow-y-auto`), which the browser/Next never resets on navigation —
 *    mark such elements with `data-scroll-container`.
 *
 * Uses `instant` so the new page appears at the top immediately rather than
 * animating (which would fight the smooth-scroll CSS).
 */
export function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    document
      .querySelectorAll<HTMLElement>("[data-scroll-container]")
      .forEach((el) => {
        el.scrollTop = 0;
        el.scrollLeft = 0;
      });
  }, [pathname]);

  return null;
}
