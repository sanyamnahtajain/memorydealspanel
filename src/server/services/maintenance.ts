import { prisma } from "@/server/db";
import { resetSwrCache, swrCached } from "@/server/cache/swr";
import {
  MAINTENANCE_OFF,
  parseMaintenance,
  type Maintenance,
} from "@/lib/maintenance";

/**
 * Server side of maintenance mode. Read src/lib/maintenance.ts first — it
 * carries the safety contract (storefront only, never /admin, fail open,
 * `until` never self-lifts).
 */

const SETTINGS_KEY = "default";

/** Direct read. Fails OPEN: a broken row must never take the shop down. */
export async function getMaintenance(): Promise<Maintenance> {
  try {
    const row = await prisma.storeSettings.findUnique({
      where: { key: SETTINGS_KEY },
      select: { maintenance: true },
    });
    return parseMaintenance(row?.maintenance);
  } catch (error) {
    console.error("[maintenance] read failed:", error);
    return MAINTENANCE_OFF;
  }
}

export async function updateMaintenance(next: Maintenance): Promise<void> {
  await prisma.storeSettings.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, maintenance: next },
    update: { maintenance: next },
  });
  // The proxy caches this (see below); drop it so the instance that took the
  // save applies it immediately. Other instances catch up within the TTL.
  resetSwrCache(MAINTENANCE_CACHE_KEY);
}

/* ------------------------------------------------------------------ */
/* proxy-facing (the storefront wall)                                  */
/* ------------------------------------------------------------------ */

/**
 * Cached read for the PROXY, which runs on every request — a per-request DB
 * read there would put the settings row on the hot path of every page view.
 *
 * TTL is deliberately SHORTER than the entry gate's 30s: turning the shop
 * back on is urgent in a way that adjusting a shop code is not, and ten
 * seconds of staleness is the most an owner should wait to see the site
 * return. The admin screen says so.
 *
 * Fails OPEN like everything else here.
 */
const MAINTENANCE_CACHE_TTL_MS = 10_000;

const MAINTENANCE_CACHE_KEY = "maintenance";

/**
 * How long a COLD proxy instance will wait for this read before letting the
 * request through. The proxy sits in front of every page: with no bound, one
 * stalled database connection here hangs the entire storefront, not just the
 * page that needed the data. A single-document lookup normally answers in
 * tens of milliseconds, so this only ever bites when the database is already
 * in trouble — which is exactly when failing open matters most.
 */
const PROXY_READ_BUDGET_MS = 1_500;

export function getMaintenanceCached(): Promise<Maintenance> {
  // Stale-while-revalidate (src/server/cache/swr.ts): once a value exists the
  // proxy never waits on the database again, and concurrent requests share
  // one refresh instead of each issuing their own when the TTL lapses.
  return swrCached<Maintenance>(MAINTENANCE_CACHE_KEY, getMaintenance, {
    ttlMs: MAINTENANCE_CACHE_TTL_MS,
    coldBudgetMs: PROXY_READ_BUDGET_MS,
    fallback: MAINTENANCE_OFF, // fails OPEN, like everything else here
    label: "maintenance setting",
  });
}
