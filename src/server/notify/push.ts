import webpush from "web-push";
import { prisma } from "@/server/db";

/**
 * Web Push notifications for admins (new access requests, etc.).
 *
 * Requires VAPID env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and optionally
 * VAPID_SUBJECT (a mailto: or https: URL). When unset, sending is a no-op
 * (console.debug) so dev works without keys.
 *
 * Subscription persistence is behind the `PushStore` seam. The default store
 * is now Mongo-backed (via `prisma.pushSubscription`) so subscriptions
 * survive restarts and are shared across instances; the in-memory store is
 * retained (`defaultInMemoryStore`) as an injectable fallback for isolated
 * unit tests that must not touch the database.
 */

export interface PushPayload {
  title: string;
  body: string;
  /** Absolute or app-relative URL the notification click should open. */
  url: string;
}

/** Shape produced by PushSubscription.toJSON() in the browser. */
export interface StoredPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  /** UA string of the subscribing browser, kept for diagnostics/pruning. */
  userAgent?: string | null;
}

/** Persistence seam for push subscriptions. */
export interface PushStore {
  save(subscription: StoredPushSubscription): Promise<void>;
  /** Remove by endpoint (the endpoint is the stable identity of a sub). */
  remove(endpoint: string): Promise<void>;
  list(): Promise<StoredPushSubscription[]>;
}

const globalForPush = globalThis as unknown as {
  __memorydealsPushSubs: Map<string, StoredPushSubscription> | undefined;
  __memorydealsPushStore: PushStore | undefined;
  __memorydealsVapidConfigured: boolean | undefined;
};

function getRegistry(): Map<string, StoredPushSubscription> {
  return (globalForPush.__memorydealsPushSubs ??= new Map());
}

/** In-memory PushStore (per-process; fine for dev, lost on restart). */
export const defaultInMemoryStore: PushStore = {
  async save(subscription) {
    getRegistry().set(subscription.endpoint, subscription);
  },
  async remove(endpoint) {
    getRegistry().delete(endpoint);
  },
  async list() {
    return [...getRegistry().values()];
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
    await prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: subscription.userAgent ?? undefined,
      },
      update: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: subscription.userAgent ?? undefined,
      },
    });
  },
  async remove(endpoint) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  },
  async list() {
    const rows = await prisma.pushSubscription.findMany({
      select: { endpoint: true, p256dh: true, auth: true },
    });
    return rows.map((row) => ({
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
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
}

/**
 * Send a push notification to every stored admin subscription.
 * Never throws; expired subscriptions (404/410) are pruned from the store.
 */
export async function sendPushToAdmin(
  payload: PushPayload,
): Promise<SendPushResult> {
  if (!ensureVapid()) {
    console.debug(
      `[push] VAPID keys not set — skipping push: ${payload.title}`,
    );
    return { sent: 0, failed: 0, pruned: 0 };
  }

  let subscriptions: StoredPushSubscription[];
  try {
    subscriptions = await getStore().list();
  } catch (error) {
    console.error("[push] failed to list subscriptions:", error);
    return { sent: 0, failed: 0, pruned: 0 };
  }

  const body = JSON.stringify(payload);
  const result: SendPushResult = { sent: 0, failed: 0, pruned: 0 };

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, body);
        result.sent += 1;
      } catch (error) {
        const statusCode =
          error instanceof webpush.WebPushError ? error.statusCode : undefined;
        if (statusCode === 404 || statusCode === 410) {
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
