import { NextResponse } from "next/server";

import { expireDueGrants } from "@/server/services/access";
import { writeAudit } from "@/server/security/audit";

/**
 * GET /api/cron/expiry
 *
 * Daily maintenance job (see vercel.json crons) that flips access which has
 * passed its expiry: any customer holding *no* live grant — where a live grant
 * is one that is not revoked and either has no expiry or expires in the
 * future — is moved from APPROVED to EXPIRED. This is the write-side companion
 * to `resolveViewer.computePriceAccess`, which already treats such customers
 * as having no price access; running it as a cron makes the customer's status
 * reflect reality so the admin UI and notifications stay honest.
 *
 * Protected by a shared secret. Vercel Cron sends `Authorization: Bearer
 * <CRON_SECRET>`; we also accept an `x-cron-secret` header for manual/GH
 * triggers. When CRON_SECRET is unset the route refuses to run rather than
 * exposing an unauthenticated mutation.
 *
 * Expiry logic itself lives in `expireDueGrants` (`@/server/services/access`)
 * — the single home for the price-access state machine — so the write-side
 * sweep here and the read-side gate in `resolveViewer` cannot drift. This
 * route only owns auth, audit, and the JSON envelope.
 */

export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed: without a configured secret there is no safe way to gate a
  // mutating endpoint, so we do not run.
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  const headerSecret = request.headers.get("x-cron-secret");
  return headerSecret === secret;
}

interface ExpirySummary {
  ok: true;
  /** Customers transitioned APPROVED -> EXPIRED this run. */
  expiredCustomers: number;
  /** ISO timestamp the sweep ran at. */
  ranAt: string;
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  const { expired, customerIds } = await expireDueGrants(now);

  if (customerIds.length > 0) {
    await Promise.all(
      customerIds.map((id) =>
        writeAudit({
          actorType: "system",
          actorId: "cron:expiry",
          action: "customer.expire",
          entity: "Customer",
          entityId: id,
        }),
      ),
    );
  }

  const summary: ExpirySummary = {
    ok: true,
    expiredCustomers: expired,
    ranAt: now.toISOString(),
  };

  return NextResponse.json(summary);
}
