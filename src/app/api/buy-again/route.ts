import { NextResponse } from "next/server";

import { resolveViewer } from "@/server/auth/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";
import { customerBuyAgainIds } from "@/server/services/recommendations";
import { listByIdsForViewer } from "@/server/dal/products";
import { formatPaise } from "@/lib/money";
import type { PricedProduct, PublicProduct } from "@/server/dto/product";

/**
 * GET /api/buy-again — the signed-in customer's "buy again" rail: the
 * products THEY re-order most (recency-weighted; src/lib/buy-again.ts).
 *
 * Fetched client-side from the PUBLIC ISR home page so the cached shell stays
 * anonymous; the personalisation happens per-request here. Anon and admin
 * viewers get `{ items: [] }` — the rail renders nothing and the home page is
 * byte-identical to the cached public shell for them.
 *
 * PRICE GATE: the ranked ids resolve through the gated DAL read
 * (`listByIdsForViewer` — hidden products drop out, and for a non-priced
 * viewer the DAL's projection never even selects money). On top of that this
 * route serialises `priceLabel` as a PRE-FORMATTED STRING and ONLY when
 * `canSeePrices(viewer)` — no raw paise number ever travels to any client,
 * and none at all to an unentitled one (`priceLabel: null` ⇒ the rail shows
 * the same masked "₹•,•••" chip the cards use).
 */

// Session state is per-request; never cache this route.
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

/** Hard cap on rail length. */
const MAX_ITEMS = 10;

/** Card-safe payload: identity + presentation only, money pre-gated. */
export interface BuyAgainItem {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  /** Pre-formatted "₹1,299" — present ONLY for price-authorised viewers. */
  priceLabel: string | null;
}

/** Narrows a DTO to its priced form without trusting a leaked field. */
function isPriced(
  product: PublicProduct | PricedProduct,
): product is PricedProduct {
  return "price" in product;
}

function json(items: BuyAgainItem[]): NextResponse {
  return NextResponse.json({ items }, { headers: NO_STORE_HEADERS });
}

export async function GET(): Promise<NextResponse> {
  const viewer = await resolveViewer();
  // Admins have no order history of their own; anon has no identity. Both get
  // the empty rail so the storefront home renders exactly its public shell.
  if (!isCustomer(viewer)) return json([]);

  try {
    const ids = await customerBuyAgainIds(viewer.customerId, MAX_ITEMS);
    if (ids.length === 0) return json([]);

    // Gated DAL read: preserves the recommender's ranking, drops products
    // that have since been hidden or deleted.
    const products = await listByIdsForViewer(viewer, ids);
    const seePrices = canSeePrices(viewer);

    const items: BuyAgainItem[] = products.map((product) => {
      const image =
        product.images.find((img) => img.isPrimary) ??
        product.images[0] ??
        null;
      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        brand: product.brandRef?.name ?? product.brand ?? null,
        imageUrl: image ? (image.thumbUrl ?? image.url) : null,
        priceLabel:
          seePrices && isPriced(product) ? formatPaise(product.price) : null,
      };
    });
    return json(items);
  } catch (error) {
    // A broken recommender must never break the home page: empty rail.
    console.error("[buy-again] failed:", error);
    return json([]);
  }
}
