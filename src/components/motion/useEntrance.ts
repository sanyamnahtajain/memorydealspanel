"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";

/**
 * Entrance animations must never be able to HIDE server-rendered content.
 *
 * INCIDENT NOTE: every entrance in this app used `initial="hidden"` (or
 * `initial={{ opacity: 0 }}`), and motion serialises that into the
 * server-rendered HTML as an inline `style="opacity:0"`. So the home page's
 * sections and every product grid arrived in the browser INVISIBLE, and only
 * appeared once the JavaScript had downloaded, parsed, hydrated and started
 * the animation. On a slow phone, a weak connection, a stalled stream or any
 * script error, customers saw a header, a banner, and a blank page — content
 * that was fully delivered and then hidden by its own entrance effect.
 *
 * The rule now: an entrance only starts from a hidden state when the
 * component is mounting AFTER hydration — i.e. during an in-app navigation,
 * when JavaScript is demonstrably running and the animation is guaranteed to
 * play. On a document load (server render + hydration) the content is
 * rendered in its final, visible state, and no script is needed to see it.
 *
 * `useSyncExternalStore` is what makes that distinction hydration-safe: React
 * uses the SERVER snapshot (false) for both the server render and the
 * hydrating client render — so the markup matches — and the client snapshot
 * (true) for any component mounted later. `initial` is only read at mount, so
 * the post-hydration re-render changes nothing on screen.
 */

function subscribeNever(): () => void {
  return () => {};
}

/** True only when this component is mounting after the document hydrated. */
export function useMountedAfterHydration(): boolean {
  return React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/**
 * The value to hand motion's `initial` prop: the hidden state when an entrance
 * can safely play, otherwise `false` (= "start in the final state").
 */
export function useEntranceInitial<T>(hidden: T): T | false {
  const reduced = useReducedMotion();
  const afterHydration = useMountedAfterHydration();
  return afterHydration && !reduced ? hidden : false;
}
