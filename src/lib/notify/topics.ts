/**
 * The notification catalogue — ONE source of truth for every kind of
 * notification the app can send, to either audience.
 *
 * Everything downstream reads this module:
 *   - the sender (`src/server/notify/push.ts`) for the default title/body,
 *     the sound to ring, and where a tap should land;
 *   - the preference UI (customer account + admin settings) to render the
 *     per-topic switches, their labels and their defaults;
 *   - the admin composer, to pick the audience of a custom broadcast.
 *
 * Adding a notification kind = adding one entry here. Nothing else needs a
 * code change to expose it in the settings UI or honour its preference.
 *
 * COPY RULE (owner request): buyers are not fluent readers. Labels and bodies
 * are short, simple English — no jargon, no marketing voice.
 */

/** Who a topic is addressed to. */
export type NotifyAudience = "customer" | "admin";

/**
 * Which tune plays when the notification lands while the app is OPEN.
 *
 * Web Push cannot carry a custom sound: once the notification is drawn by the
 * operating system, the OS picks the sound. So a custom tune is only possible
 * on the in-app path (an open tab or the installed PWA in the foreground) —
 * which is exactly the case that matters for staff watching the admin panel.
 *   - "long"  — the ~11s ring that repeats until acted on (new orders, requests)
 *   - "short" — the ~4.5s Memory Deals motif (everything else)
 *   - "none"  — silent (arrives visually only)
 */
export type NotifySound = "long" | "short" | "none";

export interface NotifyTopic {
  /** Stable storage key. Never rename — preferences are stored under it. */
  key: string;
  audience: NotifyAudience;
  /** Switch label in the settings UI. */
  label: string;
  /** One line under the label saying what it means, in plain words. */
  description: string;
  /** Whether a user who has never touched the settings gets this. */
  defaultOn: boolean;
  /**
   * Whether the user may turn this off at all. Account-critical notices
   * (access ending, an order they placed) stay on: the buyer losing prices
   * without warning is the exact failure the owner asked us to prevent.
   */
  lockedOn?: boolean;
  sound: NotifySound;
  /** Where a tap on the notification should land, when the event has no id. */
  fallbackUrl: string;
}

/**
 * Customer topics. `offers` is the one a buyer will realistically mute, so it
 * is the one we make easiest to mute — the rest are about their own account.
 */
const CUSTOMER_TOPICS = [
  {
    key: "order.placed",
    audience: "customer",
    label: "Order placed",
    description: "A confirmation the moment we receive your order.",
    defaultOn: true,
    lockedOn: true,
    sound: "short",
    fallbackUrl: "/account/orders",
  },
  {
    key: "cart.reminder",
    audience: "customer",
    label: "Items left in cart",
    description:
      "A reminder if you added items but did not place the order. At most one per week.",
    defaultOn: true,
    sound: "short",
    fallbackUrl: "/account/cart",
  },
  {
    key: "order.status",
    audience: "customer",
    label: "My order updates",
    description: "When your order is confirmed, packed or sent.",
    defaultOn: true,
    lockedOn: true,
    sound: "short",
    fallbackUrl: "/account/orders",
  },
  {
    key: "access.approved",
    audience: "customer",
    label: "Price access approved",
    description: "When the shop opens prices for you.",
    defaultOn: true,
    lockedOn: true,
    sound: "short",
    fallbackUrl: "/account",
  },
  {
    key: "access.expiring",
    audience: "customer",
    label: "Access ending soon",
    description:
      "A reminder before your prices stop, so you can place an order and keep them.",
    defaultOn: true,
    lockedOn: true,
    sound: "short",
    fallbackUrl: "/account",
  },
  {
    key: "access.expired",
    audience: "customer",
    label: "Access ended",
    description: "When your prices stop, so you can ask for them again.",
    defaultOn: true,
    lockedOn: true,
    sound: "short",
    fallbackUrl: "/account?renew=1",
  },
  {
    key: "offers",
    audience: "customer",
    label: "New stock and offers",
    description: "New items, price drops and shop news. Turn off any time.",
    defaultOn: true,
    sound: "short",
    fallbackUrl: "/",
  },
] as const satisfies readonly NotifyTopic[];

/**
 * Admin topics. The two that mean money is waiting — a new order and a new
 * access request — ring the LONG tune and are locked on, because the whole
 * point of the admin PWA is that staff cannot miss them.
 */
const ADMIN_TOPICS = [
  {
    key: "admin.order.placed",
    audience: "admin",
    label: "New order",
    description: "Rings loudly the moment a customer places an order.",
    defaultOn: true,
    lockedOn: true,
    sound: "long",
    fallbackUrl: "/admin/orders",
  },
  {
    key: "admin.access.request",
    audience: "admin",
    label: "New access request",
    description: "Someone new asked to see prices.",
    defaultOn: true,
    lockedOn: true,
    sound: "long",
    fallbackUrl: "/admin/requests",
  },
  {
    key: "admin.access.renewal",
    audience: "admin",
    label: "Renewal request",
    description: "An old customer asked for their prices back.",
    defaultOn: true,
    sound: "long",
    fallbackUrl: "/admin/requests",
  },
  {
    key: "admin.order.cancelled",
    audience: "admin",
    label: "Order cancelled",
    description: "A customer cancelled an order they had placed.",
    defaultOn: true,
    sound: "short",
    fallbackUrl: "/admin/orders",
  },
  {
    key: "admin.system",
    audience: "admin",
    label: "Shop notices",
    description: "Messages from the shop system and other staff.",
    defaultOn: true,
    sound: "short",
    fallbackUrl: "/admin/dashboard",
  },
] as const satisfies readonly NotifyTopic[];

export const NOTIFY_TOPICS: readonly NotifyTopic[] = [
  ...CUSTOMER_TOPICS,
  ...ADMIN_TOPICS,
];

/** Every topic key, as a union — so senders cannot invent one. */
export type NotifyTopicKey =
  | (typeof CUSTOMER_TOPICS)[number]["key"]
  | (typeof ADMIN_TOPICS)[number]["key"];

const BY_KEY = new Map<string, NotifyTopic>(
  NOTIFY_TOPICS.map((topic) => [topic.key, topic]),
);

/** Look up a topic. Returns null for an unknown key (never throws). */
export function findTopic(key: string): NotifyTopic | null {
  return BY_KEY.get(key) ?? null;
}

/** The topics one audience can see and configure. */
export function topicsFor(audience: NotifyAudience): readonly NotifyTopic[] {
  return NOTIFY_TOPICS.filter((topic) => topic.audience === audience);
}

/**
 * The topic key used for a custom broadcast composed in the admin panel.
 * Customer broadcasts ride on `offers` so that a buyer who muted marketing
 * stays muted — a hand-written message is still marketing to them.
 */
export const BROADCAST_TOPIC: Record<NotifyAudience, NotifyTopicKey> = {
  customer: "offers",
  admin: "admin.system",
};
