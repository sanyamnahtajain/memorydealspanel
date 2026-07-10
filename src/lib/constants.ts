/** App-wide constants for MemoryDeals. */

export const APP_NAME = "MemoryDeals";

/** Quick-pick chips for access validity on approval (F-A25 / F-U16). */
export const ACCESS_EXPIRY_PRESETS_DAYS = [7, 30, 90] as const;
export type AccessExpiryPresetDays = (typeof ACCESS_EXPIRY_PRESETS_DAYS)[number];

/** Default validity applied when the admin doesn't pick one (F-A38). */
export const DEFAULT_ACCESS_EXPIRY_DAYS: AccessExpiryPresetDays = 30;

/** Pagination / infinite-scroll page sizes. */
export const PAGE_SIZES = {
  /** Storefront category pages & search (infinite scroll batches). */
  storefront: 24,
  /** Admin tables (DealSheet, CustomerSheet, requests queue). */
  admin: 50,
  /** Hard ceiling for any caller-supplied page size. */
  max: 100,
} as const;

/** Image constraints (F-A10). */
export const MAX_IMAGES_PER_PRODUCT = 8;
/** Max accepted file size BEFORE client-side compression: 5 MB. */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;
