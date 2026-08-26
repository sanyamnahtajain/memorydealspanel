import { NextResponse } from "next/server";
import type { OrderStatus } from "@prisma/client";

import { resolveViewer } from "@/server/auth/viewer";
import { isCustomer } from "@/server/types/viewer";
import { listOrdersForCustomer } from "@/server/services/orders";
import { ORDER_STATUS_LABEL } from "@/components/storefront/orders/order-status";

/**
 * GET /api/last-order — the signed-in customer's most recent order, as a
 * tiny glance payload for the home page's "Your last order" card.
 *
 * Fetched client-side from the PUBLIC ISR home page so the cached shell stays
 * anonymous; the personalisation happens per-request here (same contract as
 * /api/buy-again). Anon and admin viewers get `{ order: null }` — the card
 * renders nothing and the home page is byte-identical to the cached public
 * shell for them.
 *
 * NO MONEY, EVER: the payload is identity + presentation only — order number,
 * a plain-English status label and the placed date. Totals, items and every
 * other field stay behind /account/orders/<n>, which gates them itself.
 */

// Session state is per-request; never cache this route.
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

/** Glance payload: no money fields at all. */
export interface LastOrderGlance {
  orderNumber: string;
  /** Plain-English label ("Placed", "Confirmed", …) resolved server-side. */
  statusLabel: string;
  /** ISO timestamp; the client formats it for display. */
  placedAt: string;
}

function json(order: LastOrderGlance | null): NextResponse {
  return NextResponse.json({ order }, { headers: NO_STORE_HEADERS });
}

export async function GET(): Promise<NextResponse> {
  const viewer = await resolveViewer();
  // Admins have no orders of their own; anon has no identity. Both get null
  // so the storefront home renders exactly its public shell.
  if (!isCustomer(viewer)) return json(null);

  try {
    const [last] = await listOrdersForCustomer(viewer.customerId, { take: 1 });
    if (!last) return json(null);

    return json({
      orderNumber: last.orderNumber,
      statusLabel:
        ORDER_STATUS_LABEL[last.status as OrderStatus] ?? last.status,
      placedAt: last.placedAt.toISOString(),
    });
  } catch (error) {
    // A broken glance must never break the home page: render nothing.
    console.error("[last-order] failed:", error);
    return json(null);
  }
}
