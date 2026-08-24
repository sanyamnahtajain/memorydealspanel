import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin, isCustomer } from "@/server/types/viewer";
import { savePushSubscription } from "@/server/notify/push";
import { writeAudit } from "@/server/security/audit";

/**
 * POST /api/push/subscribe
 *
 * Registers (or refreshes) the caller's Web Push subscription for THIS
 * browser, so the server can later reach this device.
 *
 * Both audiences may subscribe:
 *   - an admin registers a staff device (order/request alerts);
 *   - a signed-in customer registers their own device (their order updates,
 *     their access reminders, shop news).
 *
 * Anonymous callers are refused: a subscription with no owner could never be
 * addressed correctly, and storing one would leak notifications to whoever
 * happens to hold the endpoint. The audience is taken from the SESSION, never
 * from the request body — a buyer cannot register themselves as staff.
 *
 * The endpoint is the stable identity: re-subscribing upserts rather than
 * duplicating, which is also how a device that was signed in as staff and is
 * now signed in as a buyer gets re-pointed at the right owner.
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

  const parsed = subscribeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid subscription payload" },
      { status: 422 },
    );
  }

  const { endpoint, keys, userAgent } = parsed.data;
  const admin = isAdmin(viewer);

  try {
    await savePushSubscription({
      endpoint,
      keys,
      userAgent: userAgent ?? request.headers.get("user-agent"),
      audience: admin ? "admin" : "customer",
      adminId: admin ? viewer.adminId : null,
      customerId: admin ? null : viewer.customerId,
    });
  } catch (error) {
    console.error("[push/subscribe] failed to save subscription:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to save subscription" },
      { status: 500 },
    );
  }

  await writeAudit({
    actorType: admin ? "admin" : "customer",
    actorId: admin ? viewer.adminId : viewer.customerId,
    action: "push.subscribe",
    entity: "PushSubscription",
    entityId: endpoint,
  });

  return NextResponse.json({ ok: true });
}
