import { prisma } from "@/server/db";
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
  (globalThis as { __mdMaintenanceCache?: unknown }).__mdMaintenanceCache =
    undefined;
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

const globalForMaintenance = globalThis as unknown as {
  __mdMaintenanceCache: { at: number; value: Maintenance } | undefined;
};

export async function getMaintenanceCached(): Promise<Maintenance> {
  const cached = globalForMaintenance.__mdMaintenanceCache;
  if (cached && Date.now() - cached.at < MAINTENANCE_CACHE_TTL_MS) {
    return cached.value;
  }
  const value = await getMaintenance(); // already fails open internally
  globalForMaintenance.__mdMaintenanceCache = { at: Date.now(), value };
  return value;
}
