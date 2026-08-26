import { NextResponse } from "next/server";

import type { AccessStatusSnapshot } from "@/components/access/useAccessStatus";
import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";

/**
 * GET /api/access-status — the signed-in customer's access snapshot for
 * client surfaces (AccessStatusBanner, price gates) that are mounted in many
 * places where threading the server-resolved viewer would touch every page.
 *
 * Viewer-derived and PRIVATE: everything is recomputed from the session +
 * live DB — nothing here trusts the client. Anon (and admin) viewers get the
 * minimal `{ signedIn: false }` snapshot so the storefront chrome renders
 * nothing. Carries NO prices — status + expiry timing only.
 */

// Session state is per-request; never cache this route.
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

function json(snapshot: AccessStatusSnapshot): NextResponse {
  return NextResponse.json({ snapshot }, { headers: NO_STORE_HEADERS });
}

export async function GET(): Promise<NextResponse> {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) {
    // Admins are "signed in" but have no customer access lifecycle — the
    // storefront banner should treat them exactly like anon (render nothing).
    return json({ signedIn: false });
  }

  const now = new Date();
  const [liveGrants, openRequest, orderCount] = await Promise.all([
    prisma.accessGrant.findMany({
      where: {
        customerId: viewer.customerId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { expiresAt: true },
    }),
    prisma.accessRequest.findFirst({
      where: {
        customerId: viewer.customerId,
        status: { in: ["PENDING", "SNOOZED"] },
      },
      select: { id: true },
    }),
    // Trust strip: how many orders this shop has placed. A COUNT only — no
    // amounts, so it stays inside the "no prices without canSeePrices" law.
    prisma.order.count({
      where: {
        customerId: viewer.customerId,
        status: { not: "CANCELLED" },
      },
    }),
  ]);

  // Effective expiry across live grants: unlimited (null) if ANY grant never
  // expires, otherwise the LATEST expiry — the moment access actually lapses.
  let expiresAt: string | null = null;
  if (liveGrants.length > 0 && liveGrants.every((g) => g.expiresAt !== null)) {
    expiresAt = new Date(
      Math.max(...liveGrants.map((g) => (g.expiresAt as Date).getTime())),
    ).toISOString();
  }

  return json({
    signedIn: true,
    status: viewer.status,
    priceAccess: canSeePrices(viewer),
    expiresAt,
    hasOpenRequest: openRequest !== null,
    orderCount,
  });
}
