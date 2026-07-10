import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { savePushSubscription } from "@/server/notify/push";
import { writeAudit } from "@/server/security/audit";

/**
 * POST /api/push/subscribe
 *
 * Persists (or refreshes) the calling admin's Web Push subscription so that
 * `sendPushToAdmin` can later reach this browser. Admin-only: the subscription
 * store backs admin notifications, so a non-admin viewer must not be able to
 * register an endpoint. The endpoint is the stable identity — re-subscribing
 * with the same endpoint upserts rather than duplicating.
 */

// Web Push endpoints (FCM/Mozilla/WNS) run to a few hundred chars; keep a
// generous ceiling so we accept them but still bound the request body.
const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
  userAgent: z.string().max(512).optional().nullable(),
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

  const parsed = subscribeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid subscription payload" },
      { status: 422 },
    );
  }

  const { endpoint, keys, userAgent } = parsed.data;

  try {
    await savePushSubscription({
      endpoint,
      keys,
      userAgent: userAgent ?? request.headers.get("user-agent"),
    });
  } catch (error) {
    console.error("[push/subscribe] failed to save subscription:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to save subscription" },
      { status: 500 },
    );
  }

  await writeAudit({
    actorType: "admin",
    actorId: viewer.adminId,
    action: "push.subscribe",
    entity: "PushSubscription",
    entityId: endpoint,
  });

  return NextResponse.json({ ok: true });
}
