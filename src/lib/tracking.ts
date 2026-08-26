import { z } from "zod";

/**
 * Courier tracking on an order (owner request) — the admin attaches a courier
 * name, a tracking number and/or a tracking link once the parcel ships; the
 * buyer sees a "Track your parcel" row on their order page.
 *
 * STORAGE (Order.tracking Json?): `{ courierName?, trackingId?, url? }`.
 * Absent on every unshipped/legacy order — {@link parseStoredTracking} reads
 * that (and any junk) as `null`, so historical orders render exactly as before.
 *
 * NOT MONEY: tracking is never price-gated. It carries no amounts.
 */

export const TRACKING_LIMITS = {
  courierName: 60,
  trackingId: 64,
  url: 2048,
} as const;

/**
 * A saveable tracking link must be a full, plausible https address — never
 * plain http (the buyer taps this from their phone) and never a bare host
 * with no dot (a typo, not a courier site).
 */
export function isValidTrackingUrl(value: string): boolean {
  if (value.length > TRACKING_LIMITS.url) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname.includes(".");
}

/**
 * Admin input for saving tracking. Empty strings collapse to `undefined`,
 * and at least one of trackingId/url must remain — a courier name alone
 * gives the buyer nothing to track with.
 */
export const trackingInputSchema = z
  .object({
    courierName: z
      .string()
      .trim()
      .max(TRACKING_LIMITS.courierName, "Courier name is too long (60 letters max).")
      .optional(),
    trackingId: z
      .string()
      .trim()
      .max(TRACKING_LIMITS.trackingId, "Tracking number is too long (64 characters max).")
      .optional(),
    url: z
      .string()
      .trim()
      .max(TRACKING_LIMITS.url, "That link is too long.")
      .optional(),
  })
  .transform((value) => ({
    courierName: value.courierName || undefined,
    trackingId: value.trackingId || undefined,
    url: value.url || undefined,
  }))
  .refine((value) => !value.url || isValidTrackingUrl(value.url), {
    message: "The tracking link must be a full web address starting with https://",
    path: ["url"],
  })
  .refine((value) => Boolean(value.trackingId || value.url), {
    message: "Add a tracking number or a tracking link.",
  });

export type TrackingInput = z.input<typeof trackingInputSchema>;
/** The normalized shape written into Order.tracking. */
export type OrderTrackingWrite = z.output<typeof trackingInputSchema>;

/** Tracking as read back from a frozen order — null-normalized for the views. */
export interface OrderTracking {
  courierName: string | null;
  trackingId: string | null;
  url: string | null;
}

function readText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed !== "" && trimmed.length <= max ? trimmed : null;
}

/**
 * Defensive read of a frozen `Order.tracking` JSON blob. Absent, malformed or
 * junk values — including a stored url that is not https — resolve to `null`
 * (or drop the one bad field), so a single bad write can never blank an order
 * view or hand the buyer an unsafe link.
 */
export function parseStoredTracking(raw: unknown): OrderTracking | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;
  const courierName = readText(t.courierName, TRACKING_LIMITS.courierName);
  const trackingId = readText(t.trackingId, TRACKING_LIMITS.trackingId);
  const storedUrl = readText(t.url, TRACKING_LIMITS.url);
  const url = storedUrl !== null && isValidTrackingUrl(storedUrl) ? storedUrl : null;
  // Nothing the buyer could track with → treat as "no tracking yet".
  if (trackingId === null && url === null) return null;
  return { courierName, trackingId, url };
}

/** One-line label for a tracking record, e.g. "Bluedart · AWB12345". */
export function trackingSummary(tracking: OrderTracking): string {
  if (tracking.courierName && tracking.trackingId) {
    return `${tracking.courierName} · ${tracking.trackingId}`;
  }
  return tracking.courierName ?? tracking.trackingId ?? "Tracking link";
}

/**
 * Push-notification body for the first tracking save (SIMPLE ENGLISH —
 * the buyers are not fluent readers).
 */
export function trackingPushBody(tracking: OrderTracking): string {
  const parts: string[] = [];
  if (tracking.courierName) parts.push(`Sent with ${tracking.courierName}.`);
  if (tracking.trackingId) parts.push(`Tracking number: ${tracking.trackingId}.`);
  parts.push("Tap to see your order.");
  return parts.join(" ");
}
