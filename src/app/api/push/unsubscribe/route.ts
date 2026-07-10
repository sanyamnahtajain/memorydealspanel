import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { removePushSubscription } from "@/server/notify/push";
import { writeAudit } from "@/server/security/audit";

/**
 * POST /api/push/unsubscribe
 *
 * Removes the given Web Push subscription (identified by its endpoint) so this
 * browser stops receiving admin notifications. Admin-only and idempotent —
 * removing an endpoint that no longer exists is a no-op that still returns ok.
 */
const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

export async function POST(request: Request): Promise<Response> {
  const viewer = await resolveViewer();
  try {
    assertAdmin(viewer);
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    throw error;
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

  await writeAudit({
    actorType: "admin",
    actorId: viewer.adminId,
    action: "push.unsubscribe",
    entity: "PushSubscription",
    entityId: endpoint,
  });

  return NextResponse.json({ ok: true });
}
