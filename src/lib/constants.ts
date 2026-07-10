/** App-wide constants for MemoryDeals. */

export const APP_NAME = "The Memory Deals";
export const APP_SHORT = "TMD";
export const APP_TAGLINE = "A hub of mobile accessories — wholesale prices on approval.";
/** Brand slogan from the logo. */
export const APP_SLOGAN = "You need it — we have it.";

/**
 * Business contact details shown in the footer / Contact page.
 * EDIT the phone/email/address with your real details before going live.
 * (Name, tagline and map link are from the real business.)
 */
export const CONTACT = {
  email: "hello@thememorydeals.com",
  website: "https://thememorydeals.com",
  /** Display phone + a wa.me-compatible number (digits only, incl. country code). */
  phoneDisplay: "+91 90000 00000",
  whatsappNumber: "919000000000",
  addressLines: [
    "The Memory Deals",
    "Best Branded Mobile Accessories Store",
    "Faridabad, Haryana",
    "India",
  ],
  /** Google Maps listing (real). */
  mapsUrl: "https://maps.app.goo.gl/dczfg6BeqZV1LD5d6",
  hours: "Mon–Sat, 10:00–20:00 IST",
} as const;

/** Effective date shown on the legal pages. Update when policies change. */
export const LEGAL_UPDATED = "11 July 2026";

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
