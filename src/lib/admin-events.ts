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
  "contact_message",
] as const;

/** Does this Notification row belong on the staff live feed? */
export function isAdminFeedType(type: string): boolean {
  return (ADMIN_FEED_TYPES as readonly string[]).includes(type);
}

/**
 * How far back a reconnecting admin client may catch up (ms). Long enough to
 * cover a serverless restart or a phone's screen-off blip; short enough that a
 * tab reopened hours later starts fresh instead of replaying a pile of alerts.
 */
export const ADMIN_EVENTS_MAX_RESUME_MS = 10 * 60 * 1000;

/**
 * Where a (re)connecting stream should start reading from.
 *
 * `lastEventId` is the `Last-Event-ID` header the browser replays after a
 * dropped connection — we set it to the last event's `createdAt`. Resuming
 * from it is what stops events going missing while the stream was down, which
 * is how a new access request could sit unseen until an admin reloaded.
 *
 * Returns `now` when there is nothing usable to resume from, and never reaches
 * further back than ADMIN_EVENTS_MAX_RESUME_MS.
 */
export function resolveResumeCursor(
  lastEventId: string | null,
  now: Date = new Date(),
): Date {
  if (!lastEventId) return now;

  const resumed = new Date(lastEventId);
  if (Number.isNaN(resumed.getTime())) return now;

  // A clock-skewed or forged future id must not skip real events.
  if (resumed.getTime() > now.getTime()) return now;

  const oldest = now.getTime() - ADMIN_EVENTS_MAX_RESUME_MS;
  return new Date(Math.max(resumed.getTime(), oldest));
}
