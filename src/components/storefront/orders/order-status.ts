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
  FULFILLED: "Fulfilled",
  CANCELLED: "Cancelled",
};

/** One-line description shown in timelines / tooltips. */
export const ORDER_STATUS_HINT: Record<OrderStatus, string> = {
  PLACED: "Received — awaiting confirmation from the wholesaler.",
  CONFIRMED: "Confirmed by the wholesaler and queued for processing.",
  PROCESSING: "Being prepared for dispatch / collection.",
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
  "FULFILLED",
];

/** Whether a buyer may still cancel (only before the wholesaler confirms). */
export function isCancellable(status: OrderStatus): boolean {
  return status === "PLACED";
}

/**
 * Allowed forward transitions per status. Pure data (no server deps) so the
 * CUSTOM admin status control can import it client-side; the server service
 * re-exports this same table and enforces it authoritatively at mutation time.
 * PLACED can still be CANCELLED; FULFILLED / CANCELLED are terminal.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ["CONFIRMED", "PROCESSING", "FULFILLED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "FULFILLED", "CANCELLED"],
  PROCESSING: ["FULFILLED", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
};

/** Whether `next` is a permitted transition from `current`. */
export function canTransition(current: OrderStatus, next: OrderStatus): boolean {
  if (current === next) return false;
  return ORDER_STATUS_TRANSITIONS[current].includes(next);
}
