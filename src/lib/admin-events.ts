/**
 * Admin live-event contract — shared by the SSE route and the admin client.
 *
 * Events are NOT a new system: they are the existing `Notification` rows
 * (order.placed, access_request, …) streamed live to any open admin panel.
 * Adding a new event type = create the Notification row where it happens, add
 * its type to ADMIN_FEED_TYPES below, and add one entry to the client registry
 * (EVENT_META) — nothing else.
 */

export interface AdminEventDTO {
  id: string;
  /** Notification.type — e.g. "order.placed", "access_request". */
  type: string;
  /** Notification.payload, verbatim (shape depends on `type`). */
  payload: Record<string, unknown>;
  /** ISO timestamp. */
  createdAt: string;
}

/** SSE event name the stream emits for each Notification row. */
export const ADMIN_EVENT_NAME = "notification";

/** How often the stream tails the collection (ms). */
export const ADMIN_EVENTS_POLL_MS = 4_000;

/** Keep-alive comment interval (ms) so proxies never cut the stream. */
export const ADMIN_EVENTS_HEARTBEAT_MS = 20_000;

/**
 * The Notification table serves BOTH audiences: rows addressed to a buyer
 * (their order status, their access reminders) and bookkeeping rows the daily
 * nudge job writes to avoid sending a reminder twice all live alongside the
 * staff ones.
 *
 * So the live feed opts IN by type rather than streaming the table. Without
 * this, staff would get a burst of meaningless "New notification" toasts every
 * morning when the reminder job runs, which is exactly the alert fatigue that
 * makes people mute a panel they need.
 *
 * Every type here must also have an EVENT_META entry in AdminLiveEvents, or it
 * renders as a generic toast.
 */
export const ADMIN_FEED_TYPES = [
  "order.placed",
  "access_request",
  "renewal_request",
  "order.cancelledByCustomer",
] as const;

/** Does this Notification row belong on the staff live feed? */
export function isAdminFeedType(type: string): boolean {
  return (ADMIN_FEED_TYPES as readonly string[]).includes(type);
}
