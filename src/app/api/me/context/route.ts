import { NextResponse, type NextRequest } from "next/server";

import { resolveViewer } from "@/server/auth/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";
import type { ViewerContext } from "@/server/types/viewer";
import { listOrdersForCustomer } from "@/server/services/orders";
import { customerBuyAgainIds } from "@/server/services/recommendations";
import { listByIdsForViewer } from "@/server/dal/products";
import { formatPaise } from "@/lib/money";
import { ORDER_STATUS_LABEL } from "@/components/storefront/orders/order-status";
import { parsePriceLabelIds } from "@/lib/price-labels";
import { buildAccessSnapshot } from "@/server/services/access-snapshot";
import { CONTEXT_SLICES, parseSlices } from "@/lib/viewer-context";
import type { OrderStatus } from "@prisma/client";
import type { PricedProduct, PublicProduct } from "@/server/dto/product";

/**
 * GET /api/me/context — ONE request for everything a page needs about the
 * signed-in viewer.
 *
 * WHY THIS EXISTS: the storefront used to fan out to four separate per-viewer
 * endpoints on a single page load (access status, last order, buy again,
 * price labels). On Vercel each of those is billed three ways at once — a
 * function invocation, its Fluid CPU, and the observability events it emits —
 * so the home page cost six invocations to render one screen. Collapsing them
 * into one request cuts that to two without changing a single guarantee.
 *
 * ONLY WHAT WAS ASKED FOR: the client names the slices it actually needs
 * (`?want=access,lastOrder`), so a product page still does exactly the access
 * query it did before and never pays for the home page's rails.
 *
 * PRICE GATE — unchanged, and deliberately identical to the routes this
 * replaces: entitlement is resolved SERVER-SIDE here (`canSeePrices`), gated
 * viewers get `priceLabels: {}` and `buyAgain` items whose `priceLabel` is
 * null, product ids resolve through the gated DAL read (which never selects
 * money for an unentitled viewer), and money leaves this process ONLY as a
 * pre-formatted string. No raw paise crosses to any client.
 *
 * Every slice fails independently and degrades to its empty value: one broken
 * rail must never take down the rest of the page.
 */

// Session state is per-request; never cache this route.
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

/** Hard cap on the buy-again rail, matching the route this replaces. */
const BUY_AGAIN_MAX = 10;

export interface ContextBuyAgainItem {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  /** Pre-formatted "₹1,299" — present ONLY for price-authorised viewers. */
  priceLabel: string | null;
}

export interface ContextLastOrder {
  orderNumber: string;
  statusLabel: string;
  placedAt: string;
}

/** Narrows a DTO to its priced form without trusting a leaked field. */
function isPriced(
  product: PublicProduct | PricedProduct,
): product is PricedProduct {
  return "price" in product;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const want = parseSlices(params.get("want"));
  const viewer = await resolveViewer();
  const customer = isCustomer(viewer) ? viewer : null;
  const seePrices = canSeePrices(viewer);

  // Admins are "signed in" but have no customer lifecycle, orders or cart, so
  // every customer-shaped slice resolves exactly as it does for anon: empty.
  // The storefront then renders its public shell for them, unchanged.

  const [access, lastOrder, buyAgain, priceLabels] = await Promise.all([
    want.has(CONTEXT_SLICES.access)
      ? buildAccessSnapshot(viewer).catch((error) => {
          console.error("[me/context] access slice failed:", error);
          return null;
        })
      : Promise.resolve(null),

    want.has(CONTEXT_SLICES.lastOrder) && customer
      ? loadLastOrder(customer.customerId)
      : Promise.resolve(null),

    want.has(CONTEXT_SLICES.buyAgain) && customer
      ? loadBuyAgain(viewer, customer.customerId, seePrices)
      : Promise.resolve([]),

    want.has(CONTEXT_SLICES.priceLabels)
      ? loadPriceLabels(viewer, params.get("ids"), seePrices)
      : Promise.resolve({}),
  ]);

  return NextResponse.json(
    { access, lastOrder, buyAgain, priceLabels },
    { headers: NO_STORE_HEADERS },
  );
}

async function loadLastOrder(
  customerId: string,
): Promise<ContextLastOrder | null> {
  try {
    const [last] = await listOrdersForCustomer(customerId, { take: 1 });
    if (!last) return null;
    return {
      orderNumber: last.orderNumber,
      statusLabel:
        ORDER_STATUS_LABEL[last.status as OrderStatus] ?? last.status,
      placedAt: last.placedAt.toISOString(),
    };
  } catch (error) {
    console.error("[me/context] last-order slice failed:", error);
    return null;
  }
}

async function loadBuyAgain(
  viewer: ViewerContext,
  customerId: string,
  seePrices: boolean,
): Promise<ContextBuyAgainItem[]> {
  try {
    const ids = await customerBuyAgainIds(customerId, BUY_AGAIN_MAX);
    if (ids.length === 0) return [];

    // Gated DAL read: preserves the recommender's ranking and drops products
    // that have since been hidden or deleted.
    const products = await listByIdsForViewer(viewer, ids);

    return products.map((product) => {
      const image =
        product.images.find((img) => img.isPrimary) ?? product.images[0] ?? null;
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
  } catch (error) {
    console.error("[me/context] buy-again slice failed:", error);
    return [];
  }
}

async function loadPriceLabels(
  viewer: ViewerContext,
  rawIds: string | null,
  seePrices: boolean,
): Promise<Record<string, string>> {
  // Resolved server-side: an unentitled viewer gets {} — indistinguishable
  // from "nothing matched" — and the anon locked pills simply stay.
  if (!seePrices) return {};
  const ids = parsePriceLabelIds(rawIds);
  if (ids.length === 0) return {};
  try {
    const products = await listByIdsForViewer(viewer, ids);
    const labels: Record<string, string> = {};
    for (const product of products) {
      if (isPriced(product)) labels[product.id] = formatPaise(product.price);
    }
    return labels;
  } catch (error) {
    console.error("[me/context] price-labels slice failed:", error);
    return {};
  }
}
