"use client";

import * as React from "react";

/** Default breakpoint — matches Tailwind's `md` (768px). */
export const MOBILE_BREAKPOINT = 768;

/**
 * Returns true when the viewport is narrower than `breakpoint` px.
 * SSR-safe via useSyncExternalStore: the server snapshot is `false`
 * (desktop-first render), then the client corrects on hydration and
 * live-updates on resize/orientation change.
 */
export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;

  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query]
  );

  const getSnapshot = React.useCallback(
    () => window.matchMedia(query).matches,
    [query]
  );

  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
