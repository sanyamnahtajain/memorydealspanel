import { APP_NAME, CONTACT } from "@/lib/constants";

/**
 * WhatsApp enquiry deep-link helper — the single source of truth for the
 * product detail page's "Enquire on WhatsApp" links (used by both the inline
 * button and the sticky mobile bar).
 *
 * The number comes from `CONTACT.whatsappNumber` (digits with country code,
 * no "+" or spaces). The message pre-fills the product name + SKU so the
 * shopkeeper can look it up instantly. We NEVER include a price — the enquiry
 * is precisely the mechanism by which a non-approved buyer asks for one, so a
 * price cannot leak through this channel regardless of viewer.
 */

/** Strips everything but digits — wa.me wants a bare international number. */
function normaliseNumber(input: string): string {
  return input.replace(/\D/g, "");
}

const ADMIN_NUMBER = normaliseNumber(CONTACT.whatsappNumber);

export interface WaEnquiryInput {
  productName: string;
  sku?: string | null;
}

/** Builds a wa.me deep link with the product name (+ SKU) pre-filled. */
export function buildWhatsAppEnquiryLink({
  productName,
  sku = null,
}: WaEnquiryInput): string {
  const lines = [
    `Hi ${APP_NAME}, I'd like to enquire about:`,
    productName,
    sku ? `SKU: ${sku}` : null,
    "",
    "Could you share the wholesale price and availability?",
  ].filter((line): line is string => line !== null);
  const text = encodeURIComponent(lines.join("\n"));
  return `https://wa.me/${ADMIN_NUMBER}?text=${text}`;
}
