import { prisma } from "@/server/db";
import { canSeePrices, isCustomer } from "@/server/types/viewer";
import type { ViewerContext } from "@/server/types/viewer";

/**
 * The signed-in customer's access snapshot.
 *
 * Lifted out of /api/access-status so that route and /api/me/context share
 * ONE implementation — two copies of a gate this important would eventually
 * drift. Everything is recomputed from the session + live DB; nothing here
 * trusts the client. Carries NO prices: status and expiry timing only, plus a
 * non-monetary order COUNT for the trust strip.
 *
 * Anon and admin viewers get the minimal `{ signedIn: false }` snapshot, so
 * the storefront chrome renders nothing for them.
 */
export interface AccessSnapshotPayload {
  signedIn: boolean;
  status?: string;
  priceAccess?: boolean;
  expiresAt?: string | null;
  hasOpenRequest?: boolean;
  orderCount?: number;
}

export async function buildAccessSnapshot(
  viewer: ViewerContext,
): Promise<AccessSnapshotPayload> {
  // Admins are "signed in" but have no customer access lifecycle — the
  // storefront banner should treat them exactly like anon (render nothing).
  if (!isCustomer(viewer)) return { signedIn: false };

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
      where: { customerId: viewer.customerId, status: { not: "CANCELLED" } },
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

  return {
    signedIn: true,
    status: viewer.status,
    priceAccess: canSeePrices(viewer),
    expiresAt,
    hasOpenRequest: openRequest !== null,
    orderCount,
  };
}
