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
  website: "https://thememorydeals.com",
  // NOTE: the phone / WhatsApp number is intentionally NOT here. This constant
  // is imported by client components (so it ships in the public JS bundle),
  // and the shop's number must only reach viewers with live price access.
  // It lives server-side in `@/server/contact` (BUSINESS_PHONE) and is handed
  // out per-viewer through the gated helpers there.
  addressLines: [
    "The Memory Deals",
    "Shop No. 55 (Basement), HUDA Market",
    "Sector 15 Main, Faridabad",
    "Haryana 121007, India",
  ],
  /** Google Maps directions to the shop. */
  mapsUrl:
    "https://www.google.com/maps/search/?api=1&query=HUDA%20Market%20Shop%20No%2055%20Sector%2015%20Main%20Faridabad%20Haryana%20121007",
  hours: "Mon–Sat, 10:00–20:00 IST",
} as const;

/** Effective date shown on the legal pages. Update when policies change. */
export const LEGAL_UPDATED = "11 July 2026";

/** Quick-pick chips for access validity on approval (F-A25 / F-U16). */
export const ACCESS_EXPIRY_PRESETS_DAYS = [7, 30, 90] as const;
export type AccessExpiryPresetDays = (typeof ACCESS_EXPIRY_PRESETS_DAYS)[number];

/** Default validity applied when the admin doesn't pick one (F-A38). */
export const DEFAULT_ACCESS_EXPIRY_DAYS: AccessExpiryPresetDays = 30;

/**
 * Auto-renewal on order (owner request): when an approved buyer places an
 * order and their (finite) access expires within `WINDOW_DAYS`, push the expiry
 * out by `EXTEND_DAYS` — an active buyer should never get locked out mid-flow.
 * Never-expiring access and access with more than the window left are left
 * untouched.
 */
export const AUTO_RENEW_ON_ORDER = {
  WINDOW_DAYS: 30,
  EXTEND_DAYS: 30,
} as const;

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
