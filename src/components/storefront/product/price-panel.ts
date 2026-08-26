/**
 * Shared DOM id for the product page's PRICE PANEL — the elevated card that
 * anchors the page (price/gate + CTA). Exactly ONE element carries it per
 * page: the static panel on a non-variant product, or the VariantSelector's
 * panel on a variant product.
 *
 * The StickyMobileBar observes this element with an IntersectionObserver and
 * slides itself in only while the panel is OFF screen — the bar and the panel
 * never show the same CTA twice in one viewport.
 *
 * Lives in its own tiny module (no "use client") so the server page, the
 * client selector and the client bar can all import the constant.
 */
export const PRICE_PANEL_ID = "pdp-price-panel";
