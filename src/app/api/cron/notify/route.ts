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
import { prisma } from "@/server/db";
import { notifyCustomer } from "@/server/notify/push";
import { writeAudit } from "@/server/security/audit";

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

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed: without a configured secret there is no safe way to gate an
  // endpoint that sends notifications, so we do not run.
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  const headerSecret = request.headers.get("x-cron-secret");
  return headerSecret === secret;
}

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
  /** Reminders actually pushed this run. */
  sent: number;
  /** Milestones skipped because this run is a repeat. */
  alreadySent: number;
  /** Sent counts per milestone, for eyeballing the job in the Vercel log. */
  byMilestone: Record<string, number>;
  /** ISO timestamp the sweep ran at. */
  ranAt: string;
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const byMilestone: Record<string, number> = {};

  const empty = (): NotifySummary => ({
    ok: true,
    due: 0,
    sent: 0,
    alreadySent: 0,
    byMilestone,
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
      await notifyCustomer(entry.customerId, TOPIC[entry.milestone], message);
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
    alreadySent,
    byMilestone,
    ranAt: now.toISOString(),
  };

  return NextResponse.json(summary);
}
