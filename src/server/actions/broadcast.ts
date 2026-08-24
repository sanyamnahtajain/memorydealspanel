"use server";

import { z } from "zod";

import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import {
  countBroadcastRecipients,
  sendBroadcast,
} from "@/server/services/broadcast";
import {
  previewAudienceSchema,
  sendBroadcastSchema,
  type ActionResult,
  type PreviewAudienceInput,
  type SendBroadcastInput,
} from "./broadcast-schema";

/**
 * Broadcast actions — the transport in front of `@/server/services/broadcast`
 * for the admin "write your own notification" composer.
 *
 * Same shape as every other admin action module:
 *   assertAdmin → assertPermission → zod → service → audit.
 * Never throws to the client; failures come back as `{ ok:false, error }`.
 *
 * AUTHZ: `settings.manage`. Writing to every customer's phone is an
 * owner-level act, so it sits with the other shop-wide settings rather than
 * with the day-to-day customer permissions.
 *
 * NOTE: schemas and types live in `./broadcast-schema` — a `"use server"`
 * module may only export async functions.
 */

const ACTOR = "admin" as const;

async function guarded<T>(
  run: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (isForbiddenError(error)) {
      return { ok: false, error: "You are not authorised to do that." };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
    }
    console.error("[actions/broadcast] unexpected error:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/**
 * How many people this audience reaches, WITHOUT sending anything.
 *
 * The composer calls this whenever the audience changes so the owner reads
 * "this will reach 128 customers" before deciding — and the same number is
 * repeated back in the confirmation.
 */
export async function previewBroadcastAudienceAction(
  input: PreviewAudienceInput,
): Promise<ActionResult<{ recipients: number }>> {
  return guarded<{ recipients: number }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);

    const target = previewAudienceSchema.parse(input);
    const recipients = await countBroadcastRecipients({
      audience: target.audience,
      segment: target.segment,
      customerId: target.customerId ?? null,
    });

    return { ok: true, recipients };
  });
}

/** Send the composed message. Audited as `notify.broadcast`. */
export async function sendBroadcastAction(
  input: SendBroadcastInput,
): Promise<ActionResult<{ recipients: number; sent: number }>> {
  return guarded<{ recipients: number; sent: number }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);

    const data = sendBroadcastSchema.parse(input);

    const result = await sendBroadcast({
      audience: data.audience,
      segment: data.segment,
      customerId: data.customerId ?? null,
      title: data.title,
      body: data.body,
      url: data.url ?? null,
      actorId: viewer.adminId,
    });

    // Audited even when nothing reached a device: "the owner wrote this to
    // this audience at this time" is the fact worth keeping.
    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "notify.broadcast",
      entity: "Notification",
      entityId: viewer.adminId,
      diff: {
        audience: data.audience,
        segment: data.segment,
        customerId: data.customerId ?? null,
        title: data.title,
        url: data.url ?? null,
        recipients: result.recipients,
        sent: result.sent,
        failed: result.failed,
        muted: result.muted,
      },
    });

    return { ok: true, recipients: result.recipients, sent: result.sent };
  });
}
