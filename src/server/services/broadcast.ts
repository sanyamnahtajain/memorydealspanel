import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";

import { EXPIRY_WARN_DAYS } from "@/lib/access-status";
import type { BroadcastSegment } from "@/lib/broadcast";
import { BROADCAST_TOPIC, type NotifyAudience } from "@/lib/notify/topics";
import {
  countSubscriptions,
  notifyAdmins,
  notifyCustomers,
} from "@/server/notify/push";
import { customerIdsWithLiveGrant } from "./access";

/**
 * Broadcast service — the engine behind the admin "write your own
 * notification" composer.
 *
 * It does exactly two things, and keeps them apart on purpose:
 *
 *   1. RESOLVE an audience description ("approved customers", "one customer",
 *      "staff") into a concrete recipient list. `countBroadcastRecipients`
 *      runs only this half, so the composer can say "this reaches 128
 *      customers" BEFORE anything is sent.
 *   2. SEND — push to those recipients and write ONE `Notification` row so the
 *      message also lands in the in-app feed (the admin SSE stream tails that
 *      collection), not only on locked phones.
 *
 * THREE RULES this module holds to:
 *
 *   - ACCESS RULES ARE NOT RESTATED HERE. "Who can see prices right now" is
 *     `customerIdsWithLiveGrant` in `./access` — the bulk form of the same
 *     `findLiveGrant` filter `resolveViewer` keys price access off. If the
 *     access rule changes, this file follows for free.
 *   - PREFERENCES ARE THE SENDER'S JOB, and the sender already does it:
 *     customer broadcasts ride the `offers` topic, so a buyer who muted shop
 *     news stays muted even when the owner hand-writes the message.
 *   - A BROADCAST NEVER THROWS. A push service outage, a missing VAPID key or
 *     a failed feed write must not turn into a red screen for the owner; every
 *     failure is counted and reported back, never raised.
 *
 * Large audiences are processed in chunks of `CHUNK_SIZE` ids, so one
 * broadcast to every customer in the shop can't build a single huge `IN`
 * query (or one enormous `Promise.all` of push requests).
 */

/** Who a broadcast is addressed to. */
export interface BroadcastTarget {
  audience: NotifyAudience;
  /** Ignored when `audience === "admin"`. Defaults to "all". */
  segment?: BroadcastSegment;
  /** Required when `segment === "one"`. */
  customerId?: string | null;
}

export interface BroadcastInput extends BroadcastTarget {
  title: string;
  body: string;
  /** App-relative deep link a tap should open. Falls back to the topic's own. */
  url?: string | null;
  /** Admin who composed it — recorded on the feed row for the audit trail. */
  actorId?: string | null;
}

export interface BroadcastResult {
  /** How many people (customers) or devices (staff) were addressed. */
  recipients: number;
  /** Devices the push service accepted. */
  sent: number;
  /** Devices the push failed for. */
  failed: number;
  /** Recipients skipped because they had muted this kind of message. */
  muted: number;
}

/** Ids per database query / push batch. */
const CHUNK_SIZE = 200;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* audience resolution                                                 */
/* ------------------------------------------------------------------ */

/** Every customer id matching `where` (id-only projection — a cheap read). */
async function customerIds(
  where: Prisma.CustomerWhereInput,
): Promise<string[]> {
  const rows = await prisma.customer.findMany({
    where,
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Run the live-grant lookup over a long id list in chunks, returning the
 * subset that still holds access (optionally, whose access ends within a
 * window).
 */
async function liveSubset(
  ids: string[],
  options: { now: Date; expiringBefore?: Date },
): Promise<string[]> {
  const live: string[] = [];
  for (const part of chunk(ids, CHUNK_SIZE)) {
    live.push(...(await customerIdsWithLiveGrant(part, options)));
  }
  return live;
}

/**
 * Turn an audience description into the customer ids it reaches.
 *
 * Segment rules — all of them exclude BLOCKED customers, because a blocked
 * shop must not be marketed to:
 *
 *   all       every customer whose status is not BLOCKED.
 *   approved  status APPROVED **and** a live (unrevoked, unexpired) grant —
 *             i.e. the people who can actually see prices right now. Status
 *             alone is not enough: a grant can lapse before the nightly cron
 *             flips the status.
 *   expiring  the "approved" set, narrowed to those whose live grant ENDS
 *             within EXPIRY_WARN_DAYS (7) days. Unlimited grants never expire
 *             and so are never in this set.
 *   expired   status EXPIRED — access has lapsed and not been renewed.
 *   one       a single customer, when they exist and are not BLOCKED.
 *
 * Returns `[]` for the admin audience: staff are addressed by device, not by
 * customer id (see `sendBroadcast`).
 */
export async function resolveBroadcastRecipients(
  target: BroadcastTarget,
  now: Date = new Date(),
): Promise<string[]> {
  if (target.audience === "admin") return [];

  const segment: BroadcastSegment = target.segment ?? "all";

  if (segment === "one") {
    const id = target.customerId;
    if (!id) return [];
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!customer || customer.status === "BLOCKED") return [];
    return [customer.id];
  }

  if (segment === "all") {
    return customerIds({ status: { not: "BLOCKED" } });
  }

  if (segment === "expired") {
    return customerIds({ status: "EXPIRED" });
  }

  // "approved" / "expiring" — status APPROVED plus a live grant.
  const approved = await customerIds({ status: "APPROVED" });
  if (approved.length === 0) return [];

  if (segment === "approved") {
    return liveSubset(approved, { now });
  }

  return liveSubset(approved, {
    now,
    expiringBefore: new Date(now.getTime() + EXPIRY_WARN_DAYS * MS_PER_DAY),
  });
}

/**
 * How many people (or, for staff, devices) a broadcast would reach — the
 * number the composer shows before the owner presses send. Never throws: an
 * unreadable database answers "0" rather than breaking the composer.
 */
export async function countBroadcastRecipients(
  target: BroadcastTarget,
  now: Date = new Date(),
): Promise<number> {
  try {
    if (target.audience === "admin") {
      const counts = await countSubscriptions();
      return counts.admin;
    }
    const recipients = await resolveBroadcastRecipients(target, now);
    return recipients.length;
  } catch (error) {
    console.error("[broadcast] failed to count recipients:", error);
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* sending                                                             */
/* ------------------------------------------------------------------ */

/** Record the broadcast in the in-app feed. Never throws. */
async function writeFeedRow(
  input: BroadcastInput,
  recipients: number,
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        type: "notify.broadcast",
        payload: {
          audience: input.audience,
          segment: input.audience === "admin" ? "all" : (input.segment ?? "all"),
          customerId: input.customerId ?? null,
          title: input.title,
          body: input.body,
          url: input.url ?? null,
          recipients,
          sentBy: input.actorId ?? null,
        },
      },
    });
  } catch (error) {
    // The push already went out; a feed-write failure must not undo it.
    console.error("[broadcast] failed to write feed notification:", error);
  }
}

/**
 * Send one hand-written message to an audience.
 *
 * Staff broadcasts ride `admin.system`; customer broadcasts ride `offers`, so
 * a buyer who switched shop news off never receives one (that gate lives in
 * the sender — see `@/server/notify/push`).
 *
 * Always resolves. Push failures are counted in `failed`, never raised.
 */
export async function sendBroadcast(
  input: BroadcastInput,
  now: Date = new Date(),
): Promise<BroadcastResult> {
  const payload = {
    title: input.title,
    body: input.body,
    ...(input.url ? { url: input.url } : {}),
  };

  if (input.audience === "admin") {
    const result: BroadcastResult = {
      recipients: 0,
      sent: 0,
      failed: 0,
      muted: 0,
    };
    try {
      result.recipients = (await countSubscriptions()).admin;
    } catch {
      result.recipients = 0;
    }
    try {
      const push = await notifyAdmins(BROADCAST_TOPIC.admin, payload);
      result.sent = push.sent;
      result.failed = push.failed;
      result.muted = push.muted ?? 0;
    } catch (error) {
      console.error("[broadcast] staff push failed:", error);
    }
    await writeFeedRow(input, result.recipients);
    return result;
  }

  let recipients: string[] = [];
  try {
    recipients = await resolveBroadcastRecipients(input, now);
  } catch (error) {
    console.error("[broadcast] failed to resolve recipients:", error);
  }

  const result: BroadcastResult = {
    recipients: recipients.length,
    sent: 0,
    failed: 0,
    muted: 0,
  };

  for (const part of chunk(recipients, CHUNK_SIZE)) {
    try {
      const push = await notifyCustomers(part, BROADCAST_TOPIC.customer, payload);
      result.sent += push.sent;
      result.failed += push.failed;
      result.muted += push.muted ?? 0;
    } catch (error) {
      // One bad batch must not lose the rest of the audience.
      console.error("[broadcast] customer push batch failed:", error);
      result.failed += part.length;
    }
  }

  await writeFeedRow(input, result.recipients);
  return result;
}
