import type { OrderStatus } from "@prisma/client";

import type { StatusChipVariant } from "@/components/common/StatusChip";

/**
 * Shared order-status presentation helpers, used by BOTH the customer history
 * views and (re-exported) the admin queue. Keeps the label/colour/step mapping
 * in one place so the storefront and admin never drift.
 */

/** Human label for each status. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PLACED: "Placed",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  DISPATCHED: "Dispatched",
  FULFILLED: "Fulfilled",
  CANCELLED: "Cancelled",
};

/** One-line description shown in timelines / tooltips. */
export const ORDER_STATUS_HINT: Record<OrderStatus, string> = {
  PLACED: "Received — awaiting confirmation from the wholesaler.",
  CONFIRMED: "Confirmed by the wholesaler and queued for processing.",
  PROCESSING: "Being prepared for dispatch / collection.",
  DISPATCHED: "Handed to the courier and on its way.",
  FULFILLED: "Completed — items handed over.",
  CANCELLED: "This order was cancelled.",
};

/** Map an order status onto the shared StatusChip colour variant. */
export function orderStatusVariant(status: OrderStatus): StatusChipVariant {
  switch (status) {
    case "PLACED":
      return "pending";
    case "CONFIRMED":
      return "approved";
    case "PROCESSING":
      return "low";
    case "DISPATCHED":
      // Shares CONFIRMED's tone: both are "agreed and moving", and it stays
      // visibly distinct from PROCESSING (amber) and FULFILLED (green) so an
      // admin scanning the queue can tell "still with us" from "with the
      // courier" at a glance.
      return "approved";
    case "FULFILLED":
      return "active";
    case "CANCELLED":
      return "rejected";
  }
}

/**
 * The forward lifecycle used to render a progress timeline. CANCELLED is a
 * terminal off-ramp and is handled separately by the UI (not part of the line).
 */
export const ORDER_TIMELINE: OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "DISPATCHED",
  "FULFILLED",
];

/** Whether a buyer may still cancel (only before the wholesaler confirms). */
export function isCancellable(status: OrderStatus): boolean {
  return status === "PLACED";
}

/** Every status, in lifecycle order, with the terminal off-ramp last. */
export const ORDER_STATUSES: OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "DISPATCHED",
  "FULFILLED",
  "CANCELLED",
];

/**
 * Where an order may go from here: ANY other status (owner request).
 *
 * This used to be forward-only, which read as tidy but left an admin stuck
 * with an order they could not correct — one mis-tap on "Dispatched" and the
 * only way back was the database. Real shops fix mistakes, so any state can
 * now reach any other, and the guard against accidents is a CONFIRMATION step
 * in the UI rather than a locked door (see OrderStatusControl).
 *
 * Pure data (no server deps) so the admin control can import it client-side;
 * the server re-exports the same table and enforces it at mutation time.
 *
 * NOTE this is the STAFF-side table. A buyer's own cancel window is separate
 * and unchanged — see {@link isCancellable}.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> =
  Object.fromEntries(
    ORDER_STATUSES.map((from) => [
      from,
      ORDER_STATUSES.filter((to) => to !== from),
    ]),
  ) as Record<OrderStatus, OrderStatus[]>;

/** Whether `next` is a permitted transition from `current`. */
export function canTransition(current: OrderStatus, next: OrderStatus): boolean {
  if (current === next) return false;
  return ORDER_STATUS_TRANSITIONS[current].includes(next);
}

/**
 * Whether this move walks the lifecycle BACKWARDS (Dispatched → Placed) or
 * re-opens a closed order (Cancelled → anything). Not forbidden — just the
 * kind of change worth naming in a confirmation, because it contradicts what
 * the buyer was last told.
 */
export function isBackwardsMove(
  current: OrderStatus,
  next: OrderStatus,
): boolean {
  if (current === next) return false;
  if (current === "CANCELLED") return true;
  if (next === "CANCELLED") return false;
  const from = ORDER_TIMELINE.indexOf(current);
  const to = ORDER_TIMELINE.indexOf(next);
  // A status off the timeline can't be compared; treat it as forward.
  if (from < 0 || to < 0) return false;
  return to < from;
}

/**
 * The extra sentence a confirmation should show for this move, or null when
 * it is an ordinary step forward. Pure so both the copy and the decision are
 * testable without rendering anything.
 */
export function statusChangeWarning(
  current: OrderStatus,
  next: OrderStatus,
): string | null {
  if (current === "CANCELLED") {
    return "This re-opens an order you had cancelled.";
  }
  if (current === "FULFILLED") {
    return "This re-opens a completed order and clears its completed date.";
  }
  if (isBackwardsMove(current, next)) {
    return "This moves the order backwards, contradicting what the buyer was last told.";
  }
  if (next === "CANCELLED") {
    return "This cancels the order.";
  }
  return null;
}
