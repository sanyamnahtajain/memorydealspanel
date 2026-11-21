"use client";

import * as React from "react";

import {
  activityCount,
  beginActivity,
  classifyRequest,
  isInternalNavigationClick,
  markGesture,
  recentGesture,
  subscribeActivity,
} from "@/lib/activity";
import { healBodyScroll } from "@/lib/scroll-lock";

/**
 * The thin progress bar along the top of every screen — storefront and admin.
 * Owner rule: anything a tap starts that takes time must visibly be working.
 * See src/lib/activity.ts for what counts.
 *
 * Mounted once in the root layout. It also finishes the job of the boot script
 * (src/lib/boot-script.ts): replays a tap that landed before the app started,
 * and un-freezes the page if a scroll lock was ever left behind.
 */

/** Below this a change feels instant — showing a bar would only flicker. */
const SHOW_AFTER_MS = 150;
/** Never spin forever: a page change that silently fails gives up after this. */
const NAVIGATION_TIMEOUT_MS = 15_000;

declare global {
  interface Window {
    __mdHydrated?: boolean;
    __mdTap?: { el: HTMLElement; at: number };
    __mdFetchPatched?: boolean;
    __mdHistoryPatched?: boolean;
  }
}

function here() {
  return { origin: location.origin, pathname: location.pathname, search: location.search };
}

/**
 * A link tap whose click was cancelled (it opened a sheet instead) never
 * changes the address. If neither the address nor a page request has moved
 * by then, there is no page change to wait for.
 */
const CLICK_CONFIRM_MS = 1000;

/** One pending page change at a time; a new one replaces the old. */
let endNavigation: (() => void) | null = null;
let navigationTimer: ReturnType<typeof setTimeout> | null = null;
let confirmTimer: ReturnType<typeof setTimeout> | null = null;
let navigationRequestSeen = false;

function startNavigation(fromClick = false): void {
  finishNavigation();
  endNavigation = beginActivity();
  navigationTimer = setTimeout(finishNavigation, NAVIGATION_TIMEOUT_MS);
  navigationRequestSeen = !fromClick;
  if (fromClick) {
    const startedAt = location.pathname + location.search;
    confirmTimer = setTimeout(() => {
      confirmTimer = null;
      if (!navigationRequestSeen && location.pathname + location.search === startedAt) {
        finishNavigation();
      }
    }, CLICK_CONFIRM_MS);
  }
}

function finishNavigation(): void {
  if (navigationTimer) clearTimeout(navigationTimer);
  if (confirmTimer) clearTimeout(confirmTimer);
  navigationTimer = null;
  confirmTimer = null;
  endNavigation?.();
  endNavigation = null;
}

function patchFetch(): void {
  if (window.__mdFetchPatched) return;
  window.__mdFetchPatched = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const kind = recentGesture() ? classifyRequest(input, init, here()) : null;
    if (kind === "navigation") {
      // Ends when the address changes (or the timeout), not when the first
      // bytes arrive — the page is not on screen yet at that point.
      navigationRequestSeen = true;
      if (!endNavigation) startNavigation();
      return original(input, init).catch((error: unknown) => {
        finishNavigation();
        throw error;
      });
    }
    if (kind === "action") {
      const done = beginActivity();
      return original(input, init).finally(done);
    }
    return original(input, init);
  };
}

function patchHistory(onChange: () => void): void {
  if (window.__mdHistoryPatched) return;
  window.__mdHistoryPatched = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History["pushState"]>) => {
      const before = location.pathname + location.search;
      original(...args);
      if (location.pathname + location.search !== before) onChange();
    };
  }
}

export function ActivityBar() {
  const busy = React.useSyncExternalStore(
    subscribeActivity,
    () => activityCount() > 0,
    () => false,
  );
  const [phase, setPhase] = React.useState<"idle" | "running" | "done">("idle");

  // Wire everything up once.
  React.useEffect(() => {
    window.__mdHydrated = true;
    document.documentElement.removeAttribute("data-md-wait");

    // A tap that landed before the app started — do it now.
    const tap = window.__mdTap;
    window.__mdTap = undefined;
    if (tap && tap.el.isConnected && Date.now() - tap.at < 8000) {
      setTimeout(() => tap.el.click(), 0);
    }

    // THE VISIBLE BAR is pure CSS on <html> (globals.css), switched here
    // synchronously — no React render in between. On a slow phone the main
    // thread is busy building the next page exactly when the bar matters, and
    // a React-timed bar then showed up after the page did. CSS shows it 150 ms
    // after the tap regardless.
    const root = document.documentElement;
    let busySince = 0;
    let doneTimer: ReturnType<typeof setTimeout> | null = null;
    const paint = () => {
      if (activityCount() > 0) {
        if (!root.hasAttribute("data-md-busy")) {
          busySince = performance.now();
          if (doneTimer) clearTimeout(doneTimer);
          root.removeAttribute("data-md-done");
          root.setAttribute("data-md-busy", "1");
        }
      } else if (root.hasAttribute("data-md-busy")) {
        root.removeAttribute("data-md-busy");
        // Only run the bar to the end if it was ever on screen.
        if (performance.now() - busySince >= SHOW_AFTER_MS) {
          root.setAttribute("data-md-done", "1");
          doneTimer = setTimeout(() => root.removeAttribute("data-md-done"), 420);
        }
      }
    };
    const unsubscribePaint = subscribeActivity(paint);
    paint();

    patchFetch();
    const onUrlChange = () => {
      finishNavigation();
      healBodyScroll();
    };
    patchHistory(onUrlChange);

    const onGesture = () => markGesture();
    const onClick = (event: MouseEvent) => {
      markGesture();
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      // Capture phase: Next's <Link> cancels the browser's own navigation and
      // routes itself, so "was it cancelled?" can't be asked afterwards —
      // startNavigation(true) instead backs out if nothing actually moves.
      if (anchor instanceof HTMLAnchorElement && isInternalNavigationClick(anchor, event, here())) {
        startNavigation(true);
      }
    };
    const onPopState = () => {
      markGesture();
      // Back/forward: the address has already changed — just tidy up.
      onUrlChange();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") healBodyScroll();
    };

    window.addEventListener("pointerdown", onGesture, { capture: true, passive: true });
    window.addEventListener("keydown", onGesture, { capture: true });
    window.addEventListener("submit", onGesture, { capture: true });
    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener("popstate", onPopState);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      unsubscribePaint();
      if (doneTimer) clearTimeout(doneTimer);
      window.removeEventListener("pointerdown", onGesture, { capture: true });
      window.removeEventListener("keydown", onGesture, { capture: true });
      window.removeEventListener("submit", onGesture, { capture: true });
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, []);

  // busy → show after a beat; idle → run to the end and fade.
  React.useEffect(() => {
    if (busy) {
      const t = setTimeout(() => setPhase("running"), SHOW_AFTER_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setPhase((p) => (p === "running" ? "done" : p)), 0);
    return () => clearTimeout(t);
  }, [busy]);

  React.useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => setPhase("idle"), 380);
    return () => clearTimeout(t);
  }, [phase]);

  // For assistive tech (and tests): the same state, announced. The visible
  // bar is the CSS one above.
  if (phase === "idle") return null;
  return (
    <div role="progressbar" aria-label="Loading" aria-busy={phase === "running"} className="sr-only" />
  );
}
