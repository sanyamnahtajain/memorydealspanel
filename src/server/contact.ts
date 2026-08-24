import type { ViewerContext } from "@/server/types/viewer";
import { canContactOnWhatsApp } from "@/server/types/viewer";
import { APP_NAME } from "@/lib/constants";
import { buildWhatsAppLink, enquiryMessageLines } from "@/lib/whatsapp-link";

/**
 * The shop's direct contact number — SERVER-ONLY by design (owner request:
 * "if no access provided, customer can't reach Raghav on WhatsApp").
 *
 * This module lives under `src/server/` and must never be imported from a
 * client component: the number used to sit in the shared `CONTACT` constant,
 * which client components import, so it was baked into the public JS bundle
 * for every visitor regardless of any gating. Now the number only ever leaves
 * the server through the gated helpers below, which return `null` for anyone
 * whose price access isn't live.
 *
 * EDIT the number here (digits with country code, no "+"/spaces) before going
 * live; `display` is the human-readable form printed on PDFs.
 */
export const BUSINESS_PHONE = {
  display: "088827 67999",
  whatsapp: "918882767999",
} as const;

/** The raw WhatsApp number — ONLY for a viewer allowed to contact the shop. */
export function whatsappNumberForViewer(viewer: ViewerContext): string | null {
  return canContactOnWhatsApp(viewer) ? BUSINESS_PHONE.whatsapp : null;
}

/** The display phone — same gate as WhatsApp (it's the same number). */
export function phoneDisplayForViewer(viewer: ViewerContext): string | null {
  return canContactOnWhatsApp(viewer) ? BUSINESS_PHONE.display : null;
}

/**
 * A product-enquiry wa.me link for this viewer, or `null` when gated. Pages
 * pass the result straight to the CTA components, which render the
 * "request access" affordance on `null` — so a gated page literally has no
 * link to leak.
 */
export function whatsappEnquiryHrefForViewer(
  viewer: ViewerContext,
  input: { productName: string; sku?: string | null },
): string | null {
  const number = whatsappNumberForViewer(viewer);
  if (!number) return null;
  return buildWhatsAppLink(
    number,
    enquiryMessageLines({ appName: APP_NAME, productName: input.productName, sku: input.sku }),
  );
}

/** A bare "message us" wa.me link for this viewer, or `null` when gated. */
export function whatsappContactHrefForViewer(viewer: ViewerContext): string | null {
  const number = whatsappNumberForViewer(viewer);
  return number ? buildWhatsAppLink(number) : null;
}
