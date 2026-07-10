import { cache } from "react";
import { prisma } from "@/server/db";
import type { ViewerContext } from "@/server/types/viewer";
import { ANON_VIEWER } from "@/server/types/viewer";
import { getSession } from "./session";

/**
 * resolveViewer — THE single source of truth for who is making a request
 * and whether they may see gated prices.
 *
 * Resolution order: admin first, then customer. A session row carries either
 * an adminId or a customerId (never both). priceAccess is recomputed from the
 * live DB on every resolution — never trusted from the client or a stale copy.
 */

/**
 * priceAccess is true only when the customer's status is APPROVED AND there
 * exists at least one AccessGrant that is not revoked and either has no
 * expiry or expires in the future.
 */
async function computePriceAccess(customerId: string): Promise<boolean> {
  const now = new Date();
  const grant = await prisma.accessGrant.findFirst({
    where: {
      customerId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  return grant !== null;
}

/**
 * Uncached resolver. Reads the session cookie, looks up the subject, and
 * builds the appropriate ViewerContext. Returns ANON_VIEWER for anyone
 * without a valid session or whose backing record has vanished.
 */
export async function resolveViewer(): Promise<ViewerContext> {
  const session = await getSession();
  if (!session) {
    return ANON_VIEWER;
  }

  // Admin takes precedence.
  if (session.adminId) {
    const admin = await prisma.admin.findUnique({
      where: { id: session.adminId },
      select: { id: true },
    });
    if (!admin) {
      return ANON_VIEWER;
    }
    return { kind: "admin", adminId: admin.id };
  }

  if (session.customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: session.customerId },
      select: { id: true, status: true },
    });
    if (!customer) {
      return ANON_VIEWER;
    }
    const priceAccess =
      customer.status === "APPROVED" &&
      (await computePriceAccess(customer.id));
    return {
      kind: "customer",
      customerId: customer.id,
      status: customer.status,
      priceAccess,
    };
  }

  return ANON_VIEWER;
}

/**
 * Request-scoped memoized resolver for React Server Components: multiple
 * components in one render share a single viewer resolution (one session
 * + grant lookup per request). Server Actions / route handlers that run
 * outside the RSC render should call `resolveViewer` directly.
 */
export const getViewer = cache(resolveViewer);
