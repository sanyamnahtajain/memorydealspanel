/**
 * Install-prompt snooze + placement rules — pure, storage-injected helpers so
 * `InstallPrompt` stays a thin view and the rules are unit-testable.
 *
 * WHY A SNOOZE ON TOP OF THE ENGAGEMENT LADDER: the engagement algorithm
 * (src/lib/notify/engagement.ts) decides WHEN the shop has earned the right to
 * ask; it does not know that the desktop toast quietly auto-hid after twelve
 * seconds, and it would happily ask again on the next page view. The audit
 * finding was precisely "a card pinned over content that never goes away":
 * any dismissal — a tap on Not now, the X, or the auto-hide — now parks the
 * prompt for seven days on this device, remembered in localStorage.
 */

export type InstallVariant = "storefront" | "admin";

export const SNOOZE_DAYS = 7;
export const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;

/** Desktop toast auto-hide, in ms. */
export const DESKTOP_AUTO_HIDE_MS = 12_000;

/** Minimal storage shape so tests can hand in a Map-backed fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function snoozeKey(variant: InstallVariant): string {
  return `md-pwa-install-snoozed:${variant}`;
}

function defaultStore(): KeyValueStore | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Timestamp (ms) until which the prompt is parked, or 0 when it is free to show. */
export function readSnoozedUntil(
  variant: InstallVariant,
  store: KeyValueStore | null = defaultStore(),
): number {
  if (!store) return 0;
  try {
    const raw = store.getItem(snoozeKey(variant));
    if (!raw) return 0;
    const until = Number(raw);
    return Number.isFinite(until) && until > 0 ? until : 0;
  } catch {
    return 0;
  }
}

/** True while a previous dismissal is still in force. */
export function isSnoozed(
  variant: InstallVariant,
  now: number = Date.now(),
  store: KeyValueStore | null = defaultStore(),
): boolean {
  return readSnoozedUntil(variant, store) > now;
}

/** Park the prompt for {@link SNOOZE_DAYS} from `now`. Silent on storage failure. */
export function snooze(
  variant: InstallVariant,
  now: number = Date.now(),
  store: KeyValueStore | null = defaultStore(),
): void {
  if (!store) return;
  try {
    store.setItem(snoozeKey(variant), String(now + SNOOZE_MS));
  } catch {
    /* quota / private mode — the prompt simply may show again sooner */
  }
}

/** Forget a snooze (used after a successful install, and by tests). */
export function clearSnooze(
  variant: InstallVariant,
  store: KeyValueStore | null = defaultStore(),
): void {
  if (!store) return;
  try {
    store.removeItem(snoozeKey(variant));
  } catch {
    /* ignore */
  }
}

/**
 * Paths where the prompt must NOT appear because a fixed call-to-action
 * already owns the bottom of a phone screen (the product page's sticky
 * purchase bar, the cart/checkout totals bar) or the page is a wall (gate,
 * maintenance, offline). Skipping is free: the engagement ask is only
 * recorded once the sheet actually shows, so the next eligible page asks.
 */
export function isQuietPath(pathname: string): boolean {
  return (
    pathname.startsWith("/p/") ||
    pathname.startsWith("/account/cart") ||
    pathname.startsWith("/account/checkout") ||
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/gate") ||
    pathname.startsWith("/maintenance") ||
    pathname === "/offline" ||
    pathname.startsWith("/reels")
  );
}
