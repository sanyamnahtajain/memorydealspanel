/**
 * Admin live-event contract — shared by the SSE route and the admin client.
 *
 * Events are NOT a new system: they are the existing `Notification` rows
 * (order.placed, access_request, …) streamed live to any open admin panel.
 * Adding a new event type = create the Notification row where it happens and
 * add one entry to the client registry (EVENT_META) — nothing else.
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
