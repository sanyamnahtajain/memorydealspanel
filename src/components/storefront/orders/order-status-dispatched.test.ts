import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@prisma/client";

import {
  isBackwardsMove,
  statusChangeWarning,
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

  it("CAN go backwards — staff must be able to undo a mis-tap (owner request)", () => {
    // Deliberately loosened: forward-only read as tidy but left an admin
    // stuck with an order only the database could fix. The guard against
    // accidents is the confirmation step, not a locked door.
    expect(canTransition("DISPATCHED", "PROCESSING")).toBe(true);
    expect(canTransition("DISPATCHED", "PLACED")).toBe(true);
    expect(canTransition("FULFILLED", "DISPATCHED")).toBe(true);
    expect(canTransition("CANCELLED", "PLACED")).toBe(true);
  });

  it("still refuses a no-op move to the same status", () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
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

describe("every status can reach every other", () => {
  it("offers all five other statuses from any state", () => {
    for (const from of ALL) {
      const options = ORDER_STATUS_TRANSITIONS[from];
      expect(options).toHaveLength(ALL.length - 1);
      expect(options).not.toContain(from);
      for (const to of ALL) {
        if (to !== from) expect(options).toContain(to);
      }
    }
  });

  it("leaves NO terminal dead end — a closed order can always be re-opened", () => {
    // The bug this guards: a control that renders a static chip with no
    // options, stranding an order that was closed by mistake.
    expect(ORDER_STATUS_TRANSITIONS.FULFILLED.length).toBeGreaterThan(0);
    expect(ORDER_STATUS_TRANSITIONS.CANCELLED.length).toBeGreaterThan(0);
  });
});

describe("confirmation copy", () => {
  it("flags a backwards move", () => {
    expect(isBackwardsMove("DISPATCHED", "PROCESSING")).toBe(true);
    expect(isBackwardsMove("FULFILLED", "PLACED")).toBe(true);
    expect(statusChangeWarning("DISPATCHED", "PROCESSING")).toMatch(/backwards/i);
  });

  it("does not flag ordinary forward steps", () => {
    expect(isBackwardsMove("PROCESSING", "DISPATCHED")).toBe(false);
    expect(statusChangeWarning("PROCESSING", "DISPATCHED")).toBeNull();
  });

  it("names re-opening a closed order, and clearing the completed date", () => {
    expect(statusChangeWarning("CANCELLED", "PLACED")).toMatch(/re-opens/i);
    expect(statusChangeWarning("FULFILLED", "DISPATCHED")).toMatch(
      /completed date/i,
    );
  });

  it("names a cancellation", () => {
    expect(statusChangeWarning("PROCESSING", "CANCELLED")).toMatch(/cancels/i);
  });

  it("treats cancelling as an off-ramp, not a backwards move", () => {
    // Cancelling from anywhere is a normal action; it should read as "this
    // cancels the order", not "this moves the order backwards".
    expect(isBackwardsMove("PLACED", "CANCELLED")).toBe(false);
  });
});
