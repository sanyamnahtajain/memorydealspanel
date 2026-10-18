/**
 * Recently viewed products — kept entirely in the browser (localStorage), so
 * it needs no server tracking, no account, and no request: the product page
 * records a price-FREE card (id, slug, name, brand, image) and the rail reads
 * the list back. Newest first, de-duplicated, capped. Every read and write is
 * wrapped: a private window or a cleared store just means an empty rail.
 */

export const RECENTLY_VIEWED_KEY = "md-recently-viewed:v1";
export const RECENTLY_VIEWED_MAX = 12;

export interface RecentlyViewedItem {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  /** Epoch ms of the view — lets the rail drop very old entries. */
  at: number;
}

/** Entries older than this are ignored on read (a shelf of last month's clicks is noise). */
export const RECENTLY_VIEWED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function isItem(value: unknown): value is RecentlyViewedItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.slug === "string" &&
    typeof v.name === "string" &&
    (typeof v.brand === "string" || v.brand === null) &&
    (typeof v.imageUrl === "string" || v.imageUrl === null) &&
    typeof v.at === "number"
  );
}

/** Pure: the list after recording `item` at the front. */
export function withRecorded(
  list: RecentlyViewedItem[],
  item: RecentlyViewedItem,
  max = RECENTLY_VIEWED_MAX,
): RecentlyViewedItem[] {
  return [item, ...list.filter((x) => x.id !== item.id)].slice(0, max);
}

/** Pure: parse whatever was stored, dropping junk and stale entries. */
export function parseStored(raw: string | null, now: number): RecentlyViewedItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isItem).filter((x) => now - x.at < RECENTLY_VIEWED_TTL_MS).slice(0, RECENTLY_VIEWED_MAX);
  } catch {
    return [];
  }
}

export function loadRecentlyViewed(now = Date.now()): RecentlyViewedItem[] {
  try {
    return parseStored(window.localStorage.getItem(RECENTLY_VIEWED_KEY), now);
  } catch {
    return [];
  }
}

export function recordRecentlyViewed(item: Omit<RecentlyViewedItem, "at">, now = Date.now()): void {
  try {
    const next = withRecorded(loadRecentlyViewed(now), { ...item, at: now });
    window.localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — the rail simply stays empty */
  }
}
