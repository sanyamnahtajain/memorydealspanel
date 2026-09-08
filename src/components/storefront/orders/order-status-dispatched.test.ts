import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@prisma/client";

import {
  ORDER_STATUS_HINT,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TRANSITIONS,
  ORDER_TIMELINE,
  canTransition,
  isCancellable,
  orderStatusVariant,
} from "./order-status";

const ALL: OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "DISPATCHED",
  "FULFILLED",
  "CANCELLED",
];

/**
 * DISPATCHED sits between PROCESSING (being packed) and FULFILLED
 * (delivered). These tests pin the machine itself — every status change
 * pushes a notification to a real customer, so a wrong edge is a wrong
 * message to a buyer, not just a wrong chip.
 */
describe("DISPATCHED — presentation", () => {
  it("has a label, a hint and a chip colour like every other status", () => {
    for (const status of ALL) {
      expect(ORDER_STATUS_LABEL[status]).toBeTruthy();
      expect(ORDER_STATUS_HINT[status]).toBeTruthy();
      expect(orderStatusVariant(status)).toBeTruthy();
    }
    expect(ORDER_STATUS_LABEL.DISPATCHED).toBe("Dispatched");
  });

  it("is visually distinct from the states either side of it", () => {
    // An admin scanning the queue must tell "still with us" from "with the
    // courier" from "done" at a glance.
    expect(orderStatusVariant("DISPATCHED")).not.toBe(
      orderStatusVariant("PROCESSING"),
    );
    expect(orderStatusVariant("DISPATCHED")).not.toBe(
      orderStatusVariant("FULFILLED"),
    );
  });

  it("sits between Processing and Fulfilled on the timeline", () => {
    expect(ORDER_TIMELINE).toEqual([
      "PLACED",
      "CONFIRMED",
      "PROCESSING",
      "DISPATCHED",
      "FULFILLED",
    ]);
  });
});

describe("DISPATCHED — transitions", () => {
  it("is reachable from every pre-delivery state", () => {
    expect(canTransition("PLACED", "DISPATCHED")).toBe(true);
    expect(canTransition("CONFIRMED", "DISPATCHED")).toBe(true);
    expect(canTransition("PROCESSING", "DISPATCHED")).toBe(true);
  });

  it("can complete or be cancelled — a courier can hand a parcel back", () => {
    expect(canTransition("DISPATCHED", "FULFILLED")).toBe(true);
    expect(canTransition("DISPATCHED", "CANCELLED")).toBe(true);
  });

  it("never goes backwards, and terminal states stay terminal", () => {
    expect(canTransition("DISPATCHED", "PROCESSING")).toBe(false);
    expect(canTransition("DISPATCHED", "CONFIRMED")).toBe(false);
    expect(canTransition("DISPATCHED", "PLACED")).toBe(false);
    expect(canTransition("DISPATCHED", "DISPATCHED")).toBe(false);
    expect(canTransition("FULFILLED", "DISPATCHED")).toBe(false);
    expect(canTransition("CANCELLED", "DISPATCHED")).toBe(false);
  });

  it("every status still has a transition entry (no undefined lookups)", () => {
    for (const status of ALL) {
      expect(Array.isArray(ORDER_STATUS_TRANSITIONS[status])).toBe(true);
    }
  });

  it("does not change who may cancel — buyers still only before confirmation", () => {
    expect(isCancellable("PLACED")).toBe(true);
    expect(isCancellable("DISPATCHED")).toBe(false);
  });
});
