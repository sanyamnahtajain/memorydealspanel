import { NextResponse } from "next/server";

import { accessCopy } from "@/lib/access-status";
import { AUTO_RENEW_ON_ORDER } from "@/lib/constants";
import {
  LAPSED_GRACE_DAYS,
  MAX_REMINDER_DAYS,
  istDateKey,
  milestoneFor,
  type ExpiryMilestone,
} from "@/lib/notify/expiry-milestones";
import type { NotifyTopicKey } from "@/lib/notify/topics";
import {
  CART_IDLE_MAX_MS,
  CART_IDLE_MIN_MS,
  CART_REMINDER_COOLDOWN_MS,
  cartReminderDue,
  cartReminderMessage,
} from "@/lib/notify/cart-reminder";
import { prisma } from "@/server/db";
import { customerIdsWithLiveGrant } from "@/server/services/access";
import { notifyCustomer } from "@/server/notify/push";
import { writeAudit } from "@/server/security/audit";
import { isCronAuthorized } from "@/server/security/cron-auth";

/**
 * GET /api/cron/notify
 *
 * The daily "your access is ending" nudge (see vercel.json crons). It walks
 * every buyer whose price access is about to lapse and pushes a reminder at
 * 7, 3 and 1 days out, plus one "it has ended" note on the day it lapses.
 * Each message repeats the deal the owner insists we keep saying: placing ONE
 * order buys another `AUTO_RENEW_ON_ORDER.EXTEND_DAYS` days, automatically.
 *
 * Companion to `/api/cron/expiry`, which does the write-side sweep
 * (APPROVED → EXPIRED). This route never changes access state — it only
 * talks. Both share the same CRON_SECRET auth and JSON envelope.
 *
 * Protected by a shared secret. Vercel Cron sends `Authorization: Bearer
 * <CRON_SECRET>`; we also accept an `x-cron-secret` header for manual/GH
 * triggers. When CRON_SECRET is unset the route refuses to run rather than
 * exposing an endpoint that can spam every customer's phone.
 *
 * The day-bucketing rule lives in `@/lib/notify/expiry-milestones` (pure, unit
 * tested); this route only owns auth, the queries, dedupe and the envelope.
 */

export const dynamic = "force-dynamic";

const MS_PER_DAY = 86_400_000;

/**
 * DEDUPE (the critical property): the job may run twice in a day — a Vercel
 * retry, a manual trigger, a redeploy — and must never send the same reminder
 * twice.
 *
 * We do it with the `Notification` table we already have, no new model: every
 * message sent writes ONE row whose `type` names the milestone and whose
 * payload carries `{ customerId, expiresOn }`. Before sending, one query pulls
 * back the recent rows of these four types and we skip anything already there.
 *
 * Why this shape:
 *   - The milestone is in the `type`, not the payload, so the existence check
 *     is a `type in (...)` + `createdAt >= cutoff` scan — a single indexed
 *     query for the WHOLE run (see the `@@index([type, createdAt])` on
 *     Notification), rather than one lookup per customer or a payload filter
 *     Mongo cannot index well.
 *   - `expiresOn` (the IST calendar date the access ends) is in the key, so
 *     the identity is (customer, milestone, THIS expiry). A buyer who renews
 *     and later runs down a NEW grant gets a fresh set of nudges, while a
 *     re-run against the same expiry is silently skipped. Keying on
 *     (customer, milestone) alone would mute a customer forever after their
 *     first lapse.
 *   - The row is written BEFORE the push. A crash between the two costs one
 *     missed reminder; the other order would cost a duplicate on every retry,
 *     and the owner would rather we under-nag than nag twice.
 */
const NOTIFICATION_TYPE: Record<ExpiryMilestone, string> = {
  d7: "access.expiring.d7",
  d3: "access.expiring.d3",
  d1: "access.expiring.d1",
  expired: "access.expired",
};

const ALL_NOTIFICATION_TYPES = Object.values(NOTIFICATION_TYPE);

/** Which push topic carries each milestone (preferences + sound come from it). */
const TOPIC: Record<ExpiryMilestone, NotifyTopicKey> = {
  d7: "access.expiring",
  d3: "access.expiring",
  d1: "access.expiring",
  expired: "access.expired",
};

/**
 * How far back the dedupe query looks. Every milestone for one expiry date
 * falls inside a 9-day span (7 days before → 1 day after), so 30 days is
 * generous cover while still bounding the scan to a small, recent slice.
 */
const DEDUPE_LOOKBACK_DAYS = 30;



function dedupeKey(type: string, customerId: string, expiresOn: string): string {
  return `${type}|${customerId}|${expiresOn}`;
}

/**
 * The message for a milestone, in the shop's own words.
 *
 * Copy comes from `@/lib/access-status` — the single source of truth every
 * other surface (account page, price gate, sticky bar) already renders — so a
 * buyer reads the SAME sentence on their phone and in the app. The "expiring"
 * body is where the auto-extension deal is stated canonically ("place one
 * order … 30 more days free"); it must stay in step with
 * AUTO_RENEW_ON_ORDER.EXTEND_DAYS, which the "ended" message spells out from
 * the constant directly.
 */
function messageFor(
  milestone: ExpiryMilestone,
  expiresAt: Date,
): { title: string; body: string } {
  if (milestone === "expired") {
    const copy = accessCopy("expired");
    return {
      // The chip, not the title: "You are signed in, but your price access has
      // ended." is a sentence for a banner, too long for a lock screen.
      title: copy.chip,
      body: `${copy.body} Every order you place adds ${AUTO_RENEW_ON_ORDER.EXTEND_DAYS} more days.`,
    };
  }
  const copy = accessCopy("expiring", {
    signedIn: true,
    expiresAt: expiresAt.toISOString(),
  });
  return { title: copy.title, body: copy.body };
}

interface NotifySummary {
  ok: true;
  /** Buyers whose access lands on a milestone today. */
  due: number;
  /** Milestones processed this run (recorded + handed to the sender). */
  sent: number;
  /**
   * Devices a message actually REACHED. This is the number that matters: a
   * high `sent` with `delivered: 0` means nobody has alerts switched on yet
   * (usually the VAPID keys are missing), not that the job is healthy.
   */
  delivered: number;
  /** Milestones skipped because this run is a repeat. */
  alreadySent: number;
  /** Sent counts per milestone, for eyeballing the job in the Vercel log. */
  byMilestone: Record<string, number>;
  /** Idle-cart reminders processed this run. */
  cartReminders: number;
  /** Devices those cart reminders actually reached. */
  cartDelivered: number;
  /** ISO timestamp the sweep ran at. */
  ranAt: string;
}

export async function GET(request: Request): Promise<Response> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const byMilestone: Record<string, number> = {};

  // The cart sweep is independent of the expiry sweep, so it runs even when
  // no access is expiring today — hence it is resolved before the early exit.
  const cart = await sweepIdleCarts(now);

  const empty = (): NotifySummary => ({
    ok: true,
    due: 0,
    sent: 0,
    alreadySent: 0,
    byMilestone,
    delivered: 0,
    cartReminders: cart.processed,
    cartDelivered: cart.delivered,
    ranAt: now.toISOString(),
  });

  // (1) Candidates: any unrevoked grant whose expiry sits inside the nudge
  // window (a day of slack on each side so a drifting run never misses one).
  const windowStart = new Date(now.getTime() - (LAPSED_GRACE_DAYS + 1) * MS_PER_DAY);
  const windowEnd = new Date(now.getTime() + (MAX_REMINDER_DAYS + 1) * MS_PER_DAY);

  const nearby = await prisma.accessGrant.findMany({
    where: { revokedAt: null, expiresAt: { gte: windowStart, lte: windowEnd } },
    select: { customerId: true },
  });
  const candidateIds = [...new Set(nearby.map((grant) => grant.customerId))];
  if (candidateIds.length === 0) return NextResponse.json(empty());

  // (2) A customer can hold several grants. What matters is when their access
  // ACTUALLY ends — the latest expiry among their live grants — and an
  // unlimited grant means it never ends. Resolving this per customer (rather
  // than per grant) is what stops us warning someone who just renewed.
  const grants = await prisma.accessGrant.findMany({
    where: { customerId: { in: candidateIds }, revokedAt: null },
    select: { customerId: true, expiresAt: true },
  });

  const unlimited = new Set<string>();
  const endsAt = new Map<string, Date>();
  for (const grant of grants) {
    if (grant.expiresAt === null) {
      unlimited.add(grant.customerId);
      continue;
    }
    const current = endsAt.get(grant.customerId);
    if (!current || grant.expiresAt.getTime() > current.getTime()) {
      endsAt.set(grant.customerId, grant.expiresAt);
    }
  }

  // (3) Ask the pure helper which reminder (if any) each buyer is due.
  const due: { customerId: string; milestone: ExpiryMilestone; expiresAt: Date }[] = [];
  for (const [customerId, expiresAt] of endsAt) {
    if (unlimited.has(customerId)) continue;
    const milestone = milestoneFor(expiresAt, now);
    if (milestone) due.push({ customerId, milestone, expiresAt });
  }
  if (due.length === 0) return NextResponse.json(empty());

  // (4) A blocked (or deleted) customer hears nothing — blocking is meant to
  // end the relationship, not to keep pinging them about it.
  const customers = await prisma.customer.findMany({
    where: { id: { in: due.map((entry) => entry.customerId) } },
    select: { id: true, status: true },
  });
  const reachable = new Set(
    customers.filter((customer) => customer.status !== "BLOCKED").map((c) => c.id),
  );

  // (5) One query answers "what have we already sent?" for the whole run.
  const lookbackFrom = new Date(now.getTime() - DEDUPE_LOOKBACK_DAYS * MS_PER_DAY);
  const previous = await prisma.notification.findMany({
    where: {
      type: { in: ALL_NOTIFICATION_TYPES },
      createdAt: { gte: lookbackFrom },
    },
    select: { type: true, payload: true },
  });
  const alreadySentKeys = new Set(
    previous.map((row) => {
      const payload = (row.payload ?? {}) as {
        customerId?: unknown;
        expiresOn?: unknown;
      };
      return dedupeKey(
        row.type,
        typeof payload.customerId === "string" ? payload.customerId : "",
        typeof payload.expiresOn === "string" ? payload.expiresOn : "",
      );
    }),
  );

  let sent = 0;
  let delivered = 0;
  let alreadySent = 0;

  for (const entry of due) {
    if (!reachable.has(entry.customerId)) continue;

    const type = NOTIFICATION_TYPE[entry.milestone];
    const expiresOn = istDateKey(entry.expiresAt);
    const key = dedupeKey(type, entry.customerId, expiresOn);
    if (alreadySentKeys.has(key)) {
      alreadySent += 1;
      continue;
    }

    // Claim the milestone FIRST (see the dedupe note above), and treat a
    // failed claim as "do not send" — an unrecorded send is a send we would
    // repeat on the next run.
    try {
      await prisma.notification.create({
        data: {
          type,
          payload: {
            customerId: entry.customerId,
            expiresOn,
            milestone: entry.milestone,
            expiresAt: entry.expiresAt.toISOString(),
          },
        },
      });
    } catch (error) {
      console.error("[cron/notify] failed to record milestone:", error);
      continue;
    }
    // In-process guard too: two grants can never resolve to the same key here,
    // but the set keeps the invariant local and obvious.
    alreadySentKeys.add(key);

    const message = messageFor(entry.milestone, entry.expiresAt);
    // `notifyCustomer` owns the preference gate and never throws; the catch is
    // belt-and-braces so one bad recipient cannot end the run.
    try {
      const result = await notifyCustomer(
        entry.customerId,
        TOPIC[entry.milestone],
        message,
      );
      delivered += result.sent;
    } catch (error) {
      console.error("[cron/notify] push failed:", error);
    }

    sent += 1;
    byMilestone[entry.milestone] = (byMilestone[entry.milestone] ?? 0) + 1;

    await writeAudit({
      actorType: "system",
      actorId: "cron:notify",
      action: "access.expiryNudge",
      entity: "Customer",
      entityId: entry.customerId,
      diff: { milestone: entry.milestone, expiresOn },
    });
  }

  const summary: NotifySummary = {
    ok: true,
    due: due.length,
    sent,
    delivered,
    alreadySent,
    byMilestone,
    cartReminders: cart.processed,
    cartDelivered: cart.delivered,
    ranAt: now.toISOString(),
  };

  return NextResponse.json(summary);
}

/* ------------------------------------------------------------------ */
/* idle carts                                                          */
/* ------------------------------------------------------------------ */

/** Notification type used both to send and to remember a cart reminder. */
const CART_REMINDER_TYPE = "cart.reminder";

/**
 * Nudge buyers who filled a cart and never placed the order.
 *
 * Deliberately conservative — see `src/lib/notify/cart-reminder.ts` for the
 * timing rules and why they are what they are. Only buyers who can actually
 * complete the order are contacted: someone whose price access has lapsed
 * would be told to go to a cart they cannot check out, which is worse than
 * silence.
 *
 * Like the expiry sweep, the reminder is RECORDED before it is sent, so a
 * crash costs one missed nudge rather than a repeat on every retry.
 */
async function sweepIdleCarts(
  now: Date,
): Promise<{ processed: number; delivered: number }> {
  const oldest = new Date(now.getTime() - CART_IDLE_MAX_MS);
  const newest = new Date(now.getTime() - CART_IDLE_MIN_MS);

  let rows: { customerId: string; updatedAt: Date }[];
  try {
    rows = await prisma.cartItem.findMany({
      where: { updatedAt: { gte: oldest, lte: newest } },
      select: { customerId: true, updatedAt: true },
    });
  } catch (error) {
    console.error("[cron/notify] failed to read carts:", error);
    return { processed: 0, delivered: 0 };
  }
  if (rows.length === 0) return { processed: 0, delivered: 0 };

  // One cart per buyer: the freshest line is when they last touched it.
  const carts = new Map<string, { itemCount: number; lastTouchedAt: Date }>();
  for (const row of rows) {
    const current = carts.get(row.customerId);
    if (!current) {
      carts.set(row.customerId, { itemCount: 1, lastTouchedAt: row.updatedAt });
      continue;
    }
    current.itemCount += 1;
    if (row.updatedAt > current.lastTouchedAt) {
      current.lastTouchedAt = row.updatedAt;
    }
  }

  const customerIds = [...carts.keys()];

  // Who was reminded recently? One query for the whole run.
  const cooldownStart = new Date(now.getTime() - CART_REMINDER_COOLDOWN_MS);
  const lastRemindedAt = new Map<string, Date>();
  try {
    const previous = await prisma.notification.findMany({
      where: { type: CART_REMINDER_TYPE, createdAt: { gte: cooldownStart } },
      select: { payload: true, createdAt: true },
    });
    for (const row of previous) {
      const payload = row.payload as { customerId?: unknown } | null;
      const id = typeof payload?.customerId === "string" ? payload.customerId : null;
      if (!id) continue;
      const seen = lastRemindedAt.get(id);
      if (!seen || row.createdAt > seen) lastRemindedAt.set(id, row.createdAt);
    }
  } catch (error) {
    // Fail CLOSED: without the cooldown history we could spam everyone.
    console.error("[cron/notify] failed to read cart reminder history:", error);
    return { processed: 0, delivered: 0 };
  }

  // Only buyers who could actually place the order.
  let reachable: Set<string>;
  try {
    reachable = new Set(await customerIdsWithLiveGrant(customerIds, { now }));
  } catch (error) {
    console.error("[cron/notify] failed to resolve cart access:", error);
    return { processed: 0, delivered: 0 };
  }

  let sent = 0;
  let delivered = 0;
  for (const [customerId, cart] of carts) {
    if (!reachable.has(customerId)) continue;

    const verdict = cartReminderDue({
      lastTouchedAt: cart.lastTouchedAt,
      lastRemindedAt: lastRemindedAt.get(customerId) ?? null,
      itemCount: cart.itemCount,
      now,
    });
    if (!verdict.due) continue;

    try {
      await prisma.notification.create({
        data: {
          type: CART_REMINDER_TYPE,
          payload: { customerId, itemCount: cart.itemCount },
        },
      });
    } catch (error) {
      console.error("[cron/notify] failed to record cart reminder:", error);
      continue;
    }

    try {
      const result = await notifyCustomer(
        customerId,
        "cart.reminder",
        cartReminderMessage(cart.itemCount),
      );
      delivered += result.sent;
    } catch (error) {
      console.error("[cron/notify] cart push failed:", error);
    }
    sent += 1;
  }

  return { processed: sent, delivered };
}
