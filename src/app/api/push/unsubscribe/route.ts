import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin, isCustomer } from "@/server/types/viewer";
import { removePushSubscription } from "@/server/notify/push";
import { writeAudit } from "@/server/security/audit";

/**
 * POST /api/push/unsubscribe
 *
 * Removes the given Web Push subscription (identified by its endpoint) so this
 * browser stops receiving notifications. Open to any signed-in viewer —
 * admin or customer — and idempotent: removing an endpoint that no longer
 * exists is a no-op that still returns ok.
 *
 * The endpoint is a per-device secret handed out by the browser's push
 * service; the caller can only remove one they already hold, so deletion is
 * safe without an ownership lookup. Deleting is also strictly a de-escalation
 * (it can only stop messages, never redirect them).
 */
const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

export async function POST(request: Request): Promise<Response> {
  const viewer = await resolveViewer();

  if (!isAdmin(viewer) && !isCustomer(viewer)) {
    return NextResponse.json(
      { ok: false, error: "Please sign in first." },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = unsubscribeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid unsubscribe payload" },
      { status: 422 },
    );
  }

  const { endpoint } = parsed.data;

  try {
    await removePushSubscription(endpoint);
  } catch (error) {
    console.error("[push/unsubscribe] failed to remove subscription:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to remove subscription" },
      { status: 500 },
    );
  }

  const admin = isAdmin(viewer);
  await writeAudit({
    actorType: admin ? "admin" : "customer",
    actorId: admin ? viewer.adminId : viewer.customerId,
    action: "push.unsubscribe",
    entity: "PushSubscription",
    entityId: endpoint,
  });

  return NextResponse.json({ ok: true });
}
