import { NextResponse, type NextRequest } from "next/server";

import { resolveViewer } from "@/server/auth/viewer";
import { canSeePrices } from "@/server/types/viewer";
import { listByIdsForViewer } from "@/server/dal/products";
import { formatPaise } from "@/lib/money";
import { parsePriceLabelIds } from "@/lib/price-labels";
import type { PricedProduct, PublicProduct } from "@/server/dto/product";

/**
 * GET /api/price-labels?ids=a,b,c — live price labels for the PUBLIC ISR home
 * rails (Best sellers / Trending / New & featured).
 *
 * Those rails are server-rendered with ANON locked pills on purpose: the
 * cached home shell must be byte-identical for every visitor. This route is
 * the other half of that contract — a price-authorised viewer's browser asks
 * for the labels of the exact cards on screen and swaps them in client-side
 * (LivePriceSlot), the same progressive-enhancement pattern /api/buy-again
 * established.
 *
 * PRICE GATE: `canSeePrices` is resolved server-side here; every other viewer
 * gets `{ labels: {} }` — indistinguishable from "no products matched", and
 * the anon pills simply stay. For entitled viewers the ids resolve through the
 * gated DAL read (hidden/deleted products drop out) and money travels ONLY as
 * a pre-formatted string. No GST caption here — this matches the buy-again
 * rail's plain label; the full breakdown lives on listing/product surfaces.
 */

// Session state is per-request; never cache this route.
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

/** Narrows a DTO to its priced form without trusting a leaked field. */
function isPriced(
  product: PublicProduct | PricedProduct,
): product is PricedProduct {
  return "price" in product;
}

function json(labels: Record<string, string>): NextResponse {
  return NextResponse.json({ labels }, { headers: NO_STORE_HEADERS });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const viewer = await resolveViewer();
  if (!canSeePrices(viewer)) return json({});

  const ids = parsePriceLabelIds(request.nextUrl.searchParams.get("ids"));
  if (ids.length === 0) return json({});

  try {
    const products = await listByIdsForViewer(viewer, ids);
    const labels: Record<string, string> = {};
    for (const product of products) {
      if (isPriced(product)) labels[product.id] = formatPaise(product.price);
    }
    return json(labels);
  } catch (error) {
    // A broken lookup must never break the home page: pills stay locked.
    console.error("[price-labels] failed:", error);
    return json({});
  }
}
