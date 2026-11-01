/**
 * After a shopper changes WHAT a listing shows (a rail category, a filter, the
 * sort), bring the top of the listing up under the sticky header — but only if
 * they had scrolled past it. Never back to the very top of the page (the
 * brand banner, the hero), and never when the listing top is already in view.
 *
 * Instant, not smooth: the page sets `scroll-behavior: smooth`, and a long
 * animated climb is exactly the "the page ran away from me" feeling.
 * Client-only; a no-op on the server or when no listing is on the page.
 */
export const LISTING_TOP_ATTR = "data-listing-top";

export function scrollListingIntoView(): void {
  if (typeof window === "undefined") return;
  const el = document.querySelector(`[${LISTING_TOP_ATTR}]`);
  if (!el) return;
  const header = document.querySelector("header");
  const offset = (header?.getBoundingClientRect().bottom ?? 0) + 8;
  const target = Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset);
  if (window.scrollY > target + 4) {
    window.scrollTo({ top: target, behavior: "instant" as ScrollBehavior });
  }
}
