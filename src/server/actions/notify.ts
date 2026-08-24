"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin, isCustomer } from "@/server/types/viewer";
import { isForbiddenError } from "@/server/dal/guard";
import { writeAudit } from "@/server/security/audit";
import {
  getNotifyTopicStates,
  setAllTopics,
  setTopicEnabled,
  type NotifyOwner,
} from "@/server/services/notify-prefs";
import type { NotifyTopicState } from "@/lib/notify/prefs";
import { notifyCustomer, notifyOneAdmin } from "@/server/notify/push";

/**
 * Notification-preference actions, shared by the customer account screen and
 * the admin settings screen.
 *
 * The viewer decides whose preferences are edited — the client never names an
 * owner, so one signed-in person can only ever change their own switches.
 * Never throws to the client: failures come back as `{ ok:false, error }`.
 */

export type ActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

async function guarded<T>(
  run: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (isForbiddenError(error)) {
      return { ok: false, error: "You are not allowed to do that." };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
    }
    console.error("[actions/notify] unexpected error:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** The signed-in person, or null for an anonymous caller. */
async function currentOwner(): Promise<NotifyOwner | null> {
  const viewer = await resolveViewer();
  if (isAdmin(viewer)) return { kind: "admin", id: viewer.adminId };
  if (isCustomer(viewer)) return { kind: "customer", id: viewer.customerId };
  return null;
}

const toggleSchema = z.object({
  topicKey: z.string().min(1).max(64),
  enabled: z.boolean(),
});

export interface TopicsResult {
  topics: NotifyTopicState[];
}

/** Flip one notification switch for the signed-in person. */
export async function setNotifyTopicAction(
  input: z.infer<typeof toggleSchema>,
): Promise<ActionResult<TopicsResult>> {
  return guarded<TopicsResult>(async () => {
    const owner = await currentOwner();
    if (!owner) return { ok: false, error: "Please sign in first." };

    const { topicKey, enabled } = toggleSchema.parse(input);
    const topics = await setTopicEnabled(owner, topicKey, enabled);

    await writeAudit({
      actorType: owner.kind,
      actorId: owner.id,
      action: "notify.setTopic",
      entity: owner.kind === "admin" ? "Admin" : "Customer",
      entityId: owner.id,
      diff: { topicKey, enabled },
    });

    revalidatePath(owner.kind === "admin" ? "/admin/settings" : "/account");
    return { ok: true, topics };
  });
}

const allSchema = z.object({ enabled: z.boolean() });

/** Master switch: turn every optional topic on or off. */
export async function setAllNotifyTopicsAction(
  input: z.infer<typeof allSchema>,
): Promise<ActionResult<TopicsResult>> {
  return guarded<TopicsResult>(async () => {
    const owner = await currentOwner();
    if (!owner) return { ok: false, error: "Please sign in first." };

    const { enabled } = allSchema.parse(input);
    const topics = await setAllTopics(owner, enabled);

    await writeAudit({
      actorType: owner.kind,
      actorId: owner.id,
      action: "notify.setAll",
      entity: owner.kind === "admin" ? "Admin" : "Customer",
      entityId: owner.id,
      diff: { enabled },
    });

    revalidatePath(owner.kind === "admin" ? "/admin/settings" : "/account");
    return { ok: true, topics };
  });
}

/** Read the current switches (used to refresh the panel after subscribing). */
export async function getNotifyTopicsAction(): Promise<
  ActionResult<TopicsResult>
> {
  return guarded<TopicsResult>(async () => {
    const owner = await currentOwner();
    if (!owner) return { ok: false, error: "Please sign in first." };
    return { ok: true, topics: await getNotifyTopicStates(owner) };
  });
}

/**
 * Send a test notification to the caller's own devices, so a user can prove
 * the setup works without waiting for a real event. Deliberately routed
 * through the normal senders — if preferences or the audience gate would drop
 * a real message, the test is dropped too and the user learns the truth.
 */
export async function sendTestNotificationAction(): Promise<
  ActionResult<{ sent: number }>
> {
  return guarded<{ sent: number }>(async () => {
    const owner = await currentOwner();
    if (!owner) return { ok: false, error: "Please sign in first." };

    const result =
      owner.kind === "admin"
        ? await notifyOneAdmin(owner.id, "admin.system", {
            title: "Test alert",
            body: "Notifications are working on this device.",
            url: "/admin/dashboard",
          })
        : await notifyCustomer(owner.id, "offers", {
            title: "Test message",
            body: "Notifications are on. We will tell you about your orders.",
            url: "/account",
          });

    return { ok: true, sent: result.sent };
  });
}
