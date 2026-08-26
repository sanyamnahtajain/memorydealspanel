/**
 * Pure wa.me deep-link builder. Deliberately knows NO phone number: the
 * number is supplied by the caller, and the ONLY place it comes from is the
 * server-side `@/server/contact` module, which hands it out per-viewer and
 * only when the WhatsApp gate is open. Keeping this file number-free means a
 * client component can import it without the shop's number ever landing in
 * the public JS bundle.
 */

import type { OrderStatus } from "@prisma/client";

import { ORDER_STATUS_LABEL } from "@/components/storefront/orders/order-status";
import type { OrderTracking } from "@/lib/tracking";

/**
 * wa.me wants a bare INTERNATIONAL number — digits only, country code
 * included, no plus. Stripping alone is not enough: customers created before
 * phone canonicalisation (and seed rows) are stored as bare 10-digit Indian
 * mobiles, and `wa.me/9876543210` silently opens nothing. Every number this
 * shop talks to is Indian, so a 10-digit mobile (6-9 leading, optionally
 * written with a leading 0) gets the 91 prefix; anything already carrying a
 * country code passes through untouched.
 */
export function normaliseWhatsAppNumber(input: string): string {
  let digits = input.replace(/\D/g, "");
  // "09876543210" — trunk-prefix style people actually type.
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  return digits;
}

/** `https://wa.me/<number>?text=<encoded lines>` (text omitted when empty). */
export function buildWhatsAppLink(number: string, lines: string[] = []): string {
  const base = `https://wa.me/${normaliseWhatsAppNumber(number)}`;
  const text = lines.join("\n").trim();
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/* ----------------------------------------------------------------------- */
/* Admin → customer: order status message                                   */
/* ----------------------------------------------------------------------- */

/**
 * Everything the order-status message needs. `tracking` is the frozen
 * {@link OrderTracking} off the order (null until the admin attaches it).
 * Note the phone here is the CUSTOMER's — supplied by the admin-only order
 * DTO, never the shop number this module deliberately doesn't know.
 */
export interface OrderStatusMessageInput {
  appName: string;
  /** The person we greet — contact name (fall back to the business name). */
  contactName: string;
  orderNumber: string;
  status: OrderStatus;
  tracking?: OrderTracking | null;
}

/**
 * The status-specific body sentence (after "Namaste <name>, "). Statuses the
 * templates don't know fall through to a generic ORDER_STATUS_LABEL line.
 * SIMPLE ENGLISH on purpose — the buyers are not fluent readers.
 */
const ORDER_STATUS_BODY: Partial<
  Record<OrderStatus, (orderNumber: string, hasTracking: boolean) => string>
> = {
  PLACED: (n) => `we got your order ${n}. We will confirm it soon.`,
  CONFIRMED: (n) => `your order ${n} is confirmed. We will pack it soon.`,
  PROCESSING: (n, hasTracking) =>
    hasTracking
      ? `your order ${n} is packed and on the way.`
      : `your order ${n} is packed and will ship soon.`,
  FULFILLED: (n) => `your order ${n} is complete. Thank you for shopping with us.`,
  CANCELLED: (n) => `your order ${n} was cancelled. Please call us if you have any question.`,
};

/**
 * The pre-filled WhatsApp message a staff member sends a customer about their
 * order — short, warm, status-aware. When tracking exists (and the order isn't
 * cancelled) the courier name / tracking number / link are appended, so the
 * same button automatically says more once tracking is saved. Feed the result
 * to {@link buildWhatsAppLink}, which handles all URL encoding.
 */
export function orderStatusMessageLines({
  appName,
  contactName,
  orderNumber,
  status,
  tracking = null,
}: OrderStatusMessageInput): string[] {
  const showTracking = tracking !== null && status !== "CANCELLED";
  const body =
    ORDER_STATUS_BODY[status]?.(orderNumber, showTracking) ??
    `your order ${orderNumber} is now ${ORDER_STATUS_LABEL[status].toLowerCase()}.`;
  const lines: string[] = [`Namaste ${contactName}, ${body}`];
  if (showTracking) {
    if (tracking.courierName) lines.push(`Sent with ${tracking.courierName}.`);
    if (tracking.trackingId) lines.push(`Tracking number: ${tracking.trackingId}`);
    if (tracking.url) lines.push(`Track: ${tracking.url}`);
  }
  lines.push(`— ${appName}`);
  return lines;
}

export interface EnquiryLines {
  appName: string;
  productName: string;
  sku?: string | null;
}

/** The standard product-enquiry message (name + SKU, never a price). */
export function enquiryMessageLines({ appName, productName, sku = null }: EnquiryLines): string[] {
  return [
    `Hi ${appName}, I'd like to enquire about:`,
    productName,
    sku ? `SKU: ${sku}` : null,
    "",
    "Could you share the wholesale price and availability?",
  ].filter((line): line is string => line !== null);
}
