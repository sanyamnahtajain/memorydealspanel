/**
 * Recent-search persistence for the {@link SearchOverlay}.
 *
 * Stored client-side in localStorage — recents are a pure UX nicety and carry
 * no pricing or account data, so there is nothing gated to protect here. All
 * reads/writes are defensively guarded against SSR (no `window`), quota
 * errors, and privacy-mode failures so a broken store can never crash render.
 */

export const RECENTS_KEY = "md.search.recents";
export const MAX_RECENTS = 6;

/** Read the recent-search list, newest first. Returns `[]` on any failure. */
export function loadRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .filter((v): v is string => typeof v === "string")
          .slice(0, MAX_RECENTS)
      : [];
  } catch {
    return [];
  }
}

/**
 * Prepend `query` to the recent list (de-duplicated, capped) and persist it.
 * Returns the new list so callers can update state without a second read.
 */
export function pushRecent(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return loadRecents();
  const next = [trimmed, ...loadRecents().filter((r) => r !== trimmed)].slice(
    0,
    MAX_RECENTS,
  );
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / privacy-mode failures
  }
  return next;
}

/** Remove `query` from the recent list. Returns the new list. */
export function removeRecent(query: string): string[] {
  const next = loadRecents().filter((r) => r !== query);
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

/** Clear the entire recent-search list. */
export function clearRecents(): void {
  try {
    window.localStorage.removeItem(RECENTS_KEY);
  } catch {
    // ignore
  }
}
