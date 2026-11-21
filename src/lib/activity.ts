/**
 * "Something is happening" — one app-wide signal behind the progress bar at the
 * top of every screen (storefront AND admin, see ActivityBar).
 *
 * The owner's rule: if a tap starts something that takes time — opening the
 * next page, saving, adding to cart, changing an order — the shopper or staff
 * member must SEE that it is working. Rather than wiring a spinner into each of
 * hundreds of buttons, the bar watches the app's own traffic:
 *
 *  - a tap on an internal link (starts instantly, before any network);
 *  - Next.js page loads (`RSC` requests) and server actions (`Next-Action`);
 *  - any other request that changes something (POST/PUT/PATCH/DELETE);
 *
 * …but ONLY when it began within moments of a real tap / key / submit. The
 * admin refreshes itself in the background (live events, timers); that must
 * not make the bar flicker.
 */

type Listener = () => void;

let active = 0;
const listeners = new Set<Listener>();
let lastGestureAt = 0;

/** How soon after a tap a request still counts as "the user started this". */
export const GESTURE_WINDOW_MS = 1500;

function emit(): void {
  for (const l of listeners) l();
}

/** Mark something as in progress. Returns `done` — safe to call more than once. */
export function beginActivity(): () => void {
  active += 1;
  emit();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    active = Math.max(0, active - 1);
    emit();
  };
}

export function activityCount(): number {
  return active;
}

export function subscribeActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markGesture(now: number = Date.now()): void {
  lastGestureAt = now;
}

export function recentGesture(now: number = Date.now()): boolean {
  return now - lastGestureAt <= GESTURE_WINDOW_MS;
}

export type TrackKind = "navigation" | "action" | null;

function headerOf(init: RequestInit | undefined, input: RequestInfo | URL, name: string): string | null {
  try {
    if (init?.headers) {
      const h = new Headers(init.headers);
      if (h.has(name)) return h.get(name);
    }
    if (typeof Request !== "undefined" && input instanceof Request) return input.headers.get(name);
  } catch {
    /* odd header shapes — treat as absent */
  }
  return null;
}

/**
 * Should this request light the bar, and as what?
 *  - "navigation": a page load to a DIFFERENT url — stays lit until the url changes;
 *  - "action": a server action, a same-page refresh, or a write — lit while it runs;
 *  - null: background reads, prefetches, other origins, our own error beacon.
 */
export function classifyRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  here: { origin: string; pathname: string; search: string },
): TrackKind {
  let url: URL;
  try {
    const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    url = new URL(raw, here.origin);
  } catch {
    return null;
  }
  if (url.origin !== here.origin) return null;
  if (url.pathname === "/api/client-log") return null;

  const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
  if (headerOf(init, input, "next-router-prefetch")) return null;
  if (headerOf(init, input, "next-action")) return "action";

  if (headerOf(init, input, "rsc")) {
    url.searchParams.delete("_rsc");
    const target = url.pathname + (url.search === "?" ? "" : url.search);
    const current = here.pathname + here.search;
    return target === current ? "action" : "navigation";
  }
  if (method !== "GET" && method !== "HEAD") return "action";
  return null;
}

/**
 * Is a click on this anchor an in-app page change we should show progress for?
 * Same-origin, plain left click, not a new tab / download / same-page anchor,
 * and actually a different page.
 */
export function isInternalNavigationClick(
  anchor: HTMLAnchorElement,
  event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean },
  here: { origin: string; pathname: string; search: string },
): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || /^(mailto|tel|sms|whatsapp|intent|javascript):/i.test(href)) return false;
  let url: URL;
  try {
    url = new URL(href, here.origin + here.pathname);
  } catch {
    return false;
  }
  if (url.origin !== here.origin) return false;
  return url.pathname + url.search !== here.pathname + here.search;
}

/** Test hook. */
export function _resetActivityForTests(): void {
  active = 0;
  lastGestureAt = 0;
  listeners.clear();
}
