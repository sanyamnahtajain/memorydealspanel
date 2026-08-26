/**
 * Ref-counted body scroll lock.
 *
 * WHY THIS EXISTS (T-845, production incident on aryathreads): two components
 * each did the obvious thing —
 *
 *   const prev = document.body.style.overflow;
 *   document.body.style.overflow = "hidden";
 *   return () => { document.body.style.overflow = prev; };
 *
 * — and because they overlapped, the second one captured `prev` AFTER the
 * first had already written "hidden". Whichever cleanup ran last restored
 * that stale "hidden", so closing the lightbox left the ENTIRE SITE
 * unscrollable until a hard reload. The store owner reported it as "site
 * stucks", and it was reproducible on every product page.
 *
 * `document.body.style.overflow` is a single global cell. Anything that
 * locks scrolling must go through here: the original value is captured ONCE,
 * by the first locker, and restored ONCE, when the last one releases.
 */

let depth = 0;
let saved: string | null = null;

/** Lock body scrolling. Returns the release function — call it exactly once. */
export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => {};

  if (depth === 0) {
    saved = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  depth += 1;

  let released = false;
  return () => {
    // Guard double-release: React can invoke a cleanup twice (StrictMode), and
    // an unbalanced decrement would strand the count below zero and leave the
    // page locked for good — the very bug this module exists to prevent.
    if (released) return;
    released = true;
    depth = Math.max(0, depth - 1);
    if (depth === 0) {
      document.body.style.overflow = saved ?? "";
      saved = null;
    }
  };
}
