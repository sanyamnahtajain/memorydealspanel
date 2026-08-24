import webpush from "web-push";
import { prisma } from "@/server/db";

import {
  findTopic,
  type NotifyAudience,
  type NotifyTopicKey,
} from "@/lib/notify/topics";
import { parseNotifyPrefs, wantsTopic } from "@/lib/notify/prefs";

/**
 * Web Push for BOTH audiences — staff (new orders, access requests) and
 * buyers (their order status, their access ending, shop news).
 *
 * Requires VAPID env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and optionally
 * VAPID_SUBJECT (a mailto: or https: URL). When unset, sending is a no-op
 * (console.debug) so dev works without keys.
 *
 * TWO HARD RULES, both enforced here rather than at the call sites:
 *
 *  1. AUDIENCE ISOLATION. A subscription carries the audience it was created
 *     under; a customer device is only ever handed customer payloads. Staff
 *     alerts (margins, other buyers' orders) therefore cannot reach a buyer's
 *     phone even if a call site passes the wrong id.
 *
 *  2. PREFERENCES ARE THE SENDER'S JOB. Every send resolves the recipient's
 *     stored preferences and drops the message when the topic is muted. A new
 *     call site cannot forget to check, and "unsubscribe" genuinely stops
 *     messages instead of relying on each feature to remember.
 *
 * Subscription persistence is behind the `PushStore` seam. The default store
 * is Mongo-backed (via `prisma.pushSubscription`) so subscriptions survive
 * restarts and are shared across instances; the in-memory store is retained
 * (`defaultInMemoryStore`) as an injectable fallback for isolated unit tests
 * that must not touch the database.
 */

export interface PushPayload {
  title: string;
  body: string;
  /** Absolute or app-relative URL the notification click should open. */
  url: string;
  /** Topic key — the service worker uses it for grouping and the sound. */
  type?: string;
  /**
   * Collapse key. Two notifications with the same tag replace each other, so
   * three status changes on one order do not stack three cards.
   */
  tag?: string;
  /** Which in-app tune to ring when the app is open. See NotifySound. */
  sound?: "long" | "short" | "none";
  /** Keep the notification on screen until the user acts (staff alerts). */
  requireInteraction?: boolean;
}

/** Shape produced by PushSubscription.toJSON() in the browser, plus routing. */
export interface StoredPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  /** UA string of the subscribing browser, kept for diagnostics/pruning. */
  userAgent?: string | null;
  /** Defaults to "admin" for rows written before customers could subscribe. */
  audience?: NotifyAudience;
  /** Set when audience === "customer". */
  customerId?: string | null;
  /** Set when audience === "admin" and we know which admin subscribed. */
  adminId?: string | null;
}

/** Narrowing filter for `PushStore.list`. */
export interface PushQuery {
  audience?: NotifyAudience;
  customerId?: string;
  customerIds?: string[];
  /** Narrow to one staff member's own devices (e.g. a "test on my phone"). */
  adminId?: string;
}

/** Persistence seam for push subscriptions. */
export interface PushStore {
  save(subscription: StoredPushSubscription): Promise<void>;
  /** Remove by endpoint (the endpoint is the stable identity of a sub). */
  remove(endpoint: string): Promise<void>;
  list(query?: PushQuery): Promise<StoredPushSubscription[]>;
}

const globalForPush = globalThis as unknown as {
  __memorydealsPushSubs: Map<string, StoredPushSubscription> | undefined;
  __memorydealsPushStore: PushStore | undefined;
  __memorydealsVapidConfigured: boolean | undefined;
};

function getRegistry(): Map<string, StoredPushSubscription> {
  return (globalForPush.__memorydealsPushSubs ??= new Map());
}

/** Rows written before the audience column existed belong to admins. */
function audienceOf(subscription: StoredPushSubscription): NotifyAudience {
  return subscription.audience === "customer" ? "customer" : "admin";
}

function matchesQuery(
  subscription: StoredPushSubscription,
  query?: PushQuery,
): boolean {
  if (!query) return true;
  if (query.audience && audienceOf(subscription) !== query.audience) {
    return false;
  }
  if (query.customerId && subscription.customerId !== query.customerId) {
    return false;
  }
  if (query.customerIds) {
    const id = subscription.customerId;
    if (!id || !query.customerIds.includes(id)) return false;
  }
  if (query.adminId && subscription.adminId !== query.adminId) return false;
  return true;
}

/** In-memory PushStore (per-process; fine for dev, lost on restart). */
export const defaultInMemoryStore: PushStore = {
  async save(subscription) {
    getRegistry().set(subscription.endpoint, subscription);
  },
  async remove(endpoint) {
    getRegistry().delete(endpoint);
  },
  async list(query) {
    return [...getRegistry().values()].filter((sub) =>
      matchesQuery(sub, query),
    );
  },
};

/**
 * Mongo-backed PushStore over `prisma.pushSubscription`. The endpoint is the
 * stable identity of a subscription (`@unique`), so `save` upserts on it —
 * re-subscribing with the same endpoint refreshes the keys rather than
 * duplicating rows. This is the default store used in dev and production.
 */
export const prismaPushStore: PushStore = {
  async save(subscription) {
    const audience = audienceOf(subscription);
    const shared = {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: subscription.userAgent ?? undefined,
      audience,
      // A device can switch hands (staff logs out, buyer logs in). Writing
      // both ids on every save — one of them null — keeps the row honest
      // instead of leaving a stale owner attached to the endpoint.
      customerId: audience === "customer" ? (subscription.customerId ?? null) : null,
      adminId: audience === "admin" ? (subscription.adminId ?? null) : null,
      lastSeenAt: new Date(),
    };
    await prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: { endpoint: subscription.endpoint, ...shared },
      update: shared,
    });
  },
  async remove(endpoint) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  },
  async list(query) {
    const where: Record<string, unknown> = {};
    if (query?.audience === "customer") {
      where.audience = "customer";
    } else if (query?.audience === "admin") {
      // Exact match, deliberately. Rows written before this column existed
      // have the field ABSENT, and in MongoDB an absent field matches
      // neither `null` nor `not: "customer"` — so no clever filter rescues
      // them. They are fixed once by scripts/backfill-push-audience.mjs,
      // which must run against any database that predates this feature.
      where.audience = "admin";
    }
    if (query?.customerId) where.customerId = query.customerId;
    if (query?.customerIds) where.customerId = { in: query.customerIds };
    if (query?.adminId) where.adminId = query.adminId;

    const rows = await prisma.pushSubscription.findMany({
      where,
      select: {
        endpoint: true,
        p256dh: true,
        auth: true,
        audience: true,
        customerId: true,
        adminId: true,
      },
    });
    return rows.map((row) => ({
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
      audience: row.audience === "customer" ? ("customer" as const) : ("admin" as const),
      customerId: row.customerId,
      adminId: row.adminId,
    }));
  },
};

/**
 * Inject a custom store (e.g. `defaultInMemoryStore` for a hermetic unit
 * test). When no store is injected the Mongo-backed `prismaPushStore` is used.
 */
export function setPushStore(store: PushStore): void {
  globalForPush.__memorydealsPushStore = store;
}

function getStore(): PushStore {
  return globalForPush.__memorydealsPushStore ?? prismaPushStore;
}

function vapidConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
}

function ensureVapid(): boolean {
  if (!vapidConfigured()) return false;
  if (!globalForPush.__memorydealsVapidConfigured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:admin@memorydeals.local",
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    globalForPush.__memorydealsVapidConfigured = true;
  }
  return true;
}

export async function savePushSubscription(
  subscription: StoredPushSubscription,
): Promise<void> {
  await getStore().save(subscription);
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  await getStore().remove(endpoint);
}

export interface SendPushResult {
  sent: number;
  failed: number;
  /** Subscriptions removed because the push service reported them gone. */
  pruned: number;
  /** Recipients skipped because they muted the topic. */
  muted?: number;
}

/** Deliver one payload to an explicit set of subscriptions. */
async function deliver(
  subscriptions: StoredPushSubscription[],
  payload: PushPayload,
): Promise<SendPushResult> {
  const result: SendPushResult = { sent: 0, failed: 0, pruned: 0 };
  if (subscriptions.length === 0) return result;

  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, body);
        result.sent += 1;
      } catch (error) {
        const statusCode =
          error instanceof webpush.WebPushError ? error.statusCode : undefined;
        if (statusCode === 404 || statusCode === 410) {
          // The push service says this endpoint is gone for good.
          try {
            await getStore().remove(subscription.endpoint);
            result.pruned += 1;
          } catch (removeError) {
            console.error("[push] failed to prune subscription:", removeError);
            result.failed += 1;
          }
        } else {
          console.error(
            `[push] send failed (${statusCode ?? "network"}):`,
            error,
          );
          result.failed += 1;
        }
      }
    }),
  );

  return result;
}

async function listFor(query: PushQuery): Promise<StoredPushSubscription[]> {
  try {
    return await getStore().list(query);
  } catch (error) {
    console.error("[push] failed to list subscriptions:", error);
    return [];
  }
}

/**
 * Fill in the topic's own sound/url/tag defaults, so a call site only has to
 * supply what is specific to the event.
 */
function withTopicDefaults(
  topicKey: string,
  payload: Omit<PushPayload, "url"> & { url?: string },
): PushPayload {
  const topic = findTopic(topicKey);
  return {
    ...payload,
    type: topicKey,
    url: payload.url ?? topic?.fallbackUrl ?? "/",
    sound: payload.sound ?? topic?.sound ?? "short",
    tag: payload.tag ?? topicKey,
    // Staff alerts stay on screen until someone deals with them.
    requireInteraction:
      payload.requireInteraction ?? topic?.sound === "long",
  };
}

/**
 * Send to every subscribed STAFF device, honouring each admin's preferences.
 *
 * Legacy subscriptions with no `adminId` (registered before we recorded it)
 * are treated as opted in: dropping them would silently stop the alerts the
 * shop already depends on.
 */
export async function notifyAdmins(
  topicKey: NotifyTopicKey,
  payload: Omit<PushPayload, "url"> & { url?: string },
): Promise<SendPushResult> {
  if (!ensureVapid()) {
    console.debug(`[push] VAPID keys not set — skipping push: ${payload.title}`);
    return { sent: 0, failed: 0, pruned: 0 };
  }

  const subscriptions = await listFor({ audience: "admin" });
  if (subscriptions.length === 0) return { sent: 0, failed: 0, pruned: 0 };

  const adminIds = [
    ...new Set(
      subscriptions
        .map((s) => s.adminId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  // One query for every admin that owns a subscribed device.
  const prefsById = new Map<string, ReturnType<typeof parseNotifyPrefs>>();
  if (adminIds.length > 0) {
    try {
      const admins = await prisma.admin.findMany({
        where: { id: { in: adminIds } },
        select: { id: true, notifyPrefs: true },
      });
      for (const admin of admins) {
        prefsById.set(admin.id, parseNotifyPrefs(admin.notifyPrefs));
      }
    } catch (error) {
      // Preference lookup must never silence an operational alert.
      console.error("[push] failed to load admin preferences:", error);
    }
  }

  let muted = 0;
  const wanted = subscriptions.filter((subscription) => {
    if (!subscription.adminId) return true; // legacy row — opted in
    const prefs = prefsById.get(subscription.adminId);
    if (!prefs) return true; // unknown admin — fail open, staff alerts matter
    if (wantsTopic(prefs, topicKey)) return true;
    muted += 1;
    return false;
  });

  const result = await deliver(wanted, withTopicDefaults(topicKey, payload));
  return { ...result, muted };
}

/**
 * Send to one buyer's devices, honouring their preferences.
 * Silently does nothing when the buyer has no subscribed device.
 */
export async function notifyCustomer(
  customerId: string,
  topicKey: NotifyTopicKey,
  payload: Omit<PushPayload, "url"> & { url?: string },
): Promise<SendPushResult> {
  if (!ensureVapid()) {
    console.debug(`[push] VAPID keys not set — skipping push: ${payload.title}`);
    return { sent: 0, failed: 0, pruned: 0 };
  }

  let prefs = parseNotifyPrefs(null);
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { notifyPrefs: true },
    });
    if (!customer) return { sent: 0, failed: 0, pruned: 0 };
    prefs = parseNotifyPrefs(customer.notifyPrefs);
  } catch (error) {
    console.error("[push] failed to load customer preferences:", error);
    // Fail CLOSED for buyers: an unreadable preference must not become an
    // unwanted notification to someone who may have muted this topic.
    return { sent: 0, failed: 0, pruned: 0 };
  }

  if (!wantsTopic(prefs, topicKey)) {
    return { sent: 0, failed: 0, pruned: 0, muted: 1 };
  }

  const subscriptions = await listFor({ audience: "customer", customerId });
  return deliver(subscriptions, withTopicDefaults(topicKey, payload));
}

/**
 * Send one payload to many buyers (the admin composer's broadcast). Runs the
 * same preference gate per recipient, so a broadcast can never reach someone
 * who muted the topic.
 */
export async function notifyCustomers(
  customerIds: string[],
  topicKey: NotifyTopicKey,
  payload: Omit<PushPayload, "url"> & { url?: string },
): Promise<SendPushResult> {
  if (!ensureVapid()) {
    console.debug(`[push] VAPID keys not set — skipping push: ${payload.title}`);
    return { sent: 0, failed: 0, pruned: 0 };
  }
  if (customerIds.length === 0) return { sent: 0, failed: 0, pruned: 0 };

  const subscriptions = await listFor({
    audience: "customer",
    customerIds,
  });
  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0, pruned: 0 };
  }

  // Only look up buyers who actually have a device subscribed.
  const reachable = [
    ...new Set(
      subscriptions
        .map((s) => s.customerId)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];

  const allowed = new Set<string>();
  let muted = 0;
  try {
    const customers = await prisma.customer.findMany({
      where: { id: { in: reachable } },
      select: { id: true, notifyPrefs: true },
    });
    for (const customer of customers) {
      if (wantsTopic(parseNotifyPrefs(customer.notifyPrefs), topicKey)) {
        allowed.add(customer.id);
      } else {
        muted += 1;
      }
    }
  } catch (error) {
    console.error("[push] failed to load customer preferences:", error);
    return { sent: 0, failed: 0, pruned: 0 };
  }

  const wanted = subscriptions.filter(
    (s) => s.customerId !== null && s.customerId !== undefined && allowed.has(s.customerId),
  );

  const result = await deliver(wanted, withTopicDefaults(topicKey, payload));
  return { ...result, muted };
}

/**
 * Send to ONE staff member's own devices. Used by the "send me a test"
 * button: a test must prove *this* person's setup works without ringing
 * every phone in the shop.
 */
export async function notifyOneAdmin(
  adminId: string,
  topicKey: NotifyTopicKey,
  payload: Omit<PushPayload, "url"> & { url?: string },
): Promise<SendPushResult> {
  if (!ensureVapid()) {
    console.debug(`[push] VAPID keys not set — skipping push: ${payload.title}`);
    return { sent: 0, failed: 0, pruned: 0 };
  }
  const subscriptions = await listFor({ audience: "admin", adminId });
  return deliver(subscriptions, withTopicDefaults(topicKey, payload));
}

/**
 * Back-compat wrapper for the original admin-only sender. New code should
 * call `notifyAdmins` with an explicit topic so the message respects staff
 * preferences and rings the right tune.
 */
export async function sendPushToAdmin(
  payload: PushPayload,
): Promise<SendPushResult> {
  return notifyAdmins("admin.system", payload);
}

/** How many devices are currently subscribed, per audience (admin UI stat). */
export async function countSubscriptions(): Promise<{
  admin: number;
  customer: number;
}> {
  try {
    const [admin, customer] = await Promise.all([
      listFor({ audience: "admin" }),
      listFor({ audience: "customer" }),
    ]);
    return { admin: admin.length, customer: customer.length };
  } catch {
    return { admin: 0, customer: 0 };
  }
}
