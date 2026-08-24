/**
 * Pure wa.me deep-link builder. Deliberately knows NO phone number: the
 * number is supplied by the caller, and the ONLY place it comes from is the
 * server-side `@/server/contact` module, which hands it out per-viewer and
 * only when the WhatsApp gate is open. Keeping this file number-free means a
 * client component can import it without the shop's number ever landing in
 * the public JS bundle.
 */

/** Strips everything but digits — wa.me wants a bare international number. */
export function normaliseWhatsAppNumber(input: string): string {
  return input.replace(/\D/g, "");
}

/** `https://wa.me/<number>?text=<encoded lines>` (text omitted when empty). */
export function buildWhatsAppLink(number: string, lines: string[] = []): string {
  const base = `https://wa.me/${normaliseWhatsAppNumber(number)}`;
  const text = lines.join("\n").trim();
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
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
