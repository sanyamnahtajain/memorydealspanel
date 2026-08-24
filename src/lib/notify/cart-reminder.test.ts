import { describe, expect, it } from "vitest";

import {
  CART_IDLE_MAX_MS,
  CART_IDLE_MIN_MS,
  CART_REMINDER_COOLDOWN_MS,
  cartReminderDue,
  cartReminderMessage,
} from "./cart-reminder";

const NOW = new Date("2026-08-24T10:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function verdict(overrides: {
  lastTouchedAt?: Date;
  lastRemindedAt?: Date | null;
  itemCount?: number;
}) {
  return cartReminderDue({
    lastTouchedAt: overrides.lastTouchedAt ?? ago(3 * 24 * HOUR),
    lastRemindedAt: overrides.lastRemindedAt ?? null,
    itemCount: overrides.itemCount ?? 2,
    now: NOW,
  });
}

describe("cart reminder — when to nudge", () => {
  it("nudges a cart left sitting for a few days", () => {
    expect(verdict({})).toEqual({ due: true });
  });

  it("says nothing about an empty cart", () => {
    expect(verdict({ itemCount: 0 })).toEqual({ due: false, reason: "empty" });
  });

  it("leaves a buyer alone while they are still building the order", () => {
    // A wholesale buyer adding lines over an afternoon has not abandoned
    // anything — interrupting them is the worst possible moment.
    expect(verdict({ lastTouchedAt: ago(2 * HOUR) })).toEqual({
      due: false,
      reason: "too-fresh",
    });
  });

  it("waits the full idle window before speaking", () => {
    expect(verdict({ lastTouchedAt: ago(CART_IDLE_MIN_MS - 1) }).due).toBe(false);
    expect(verdict({ lastTouchedAt: ago(CART_IDLE_MIN_MS) }).due).toBe(true);
  });

  it("gives up on a cart nobody has touched in weeks", () => {
    // Past this point the cart is dead, and a reminder reads as spam.
    expect(verdict({ lastTouchedAt: ago(CART_IDLE_MAX_MS + HOUR) })).toEqual({
      due: false,
      reason: "too-stale",
    });
    expect(verdict({ lastTouchedAt: ago(CART_IDLE_MAX_MS) }).due).toBe(true);
  });
});

describe("cart reminder — never twice", () => {
  it("holds off while the cooldown is running", () => {
    expect(
      verdict({ lastRemindedAt: ago(CART_REMINDER_COOLDOWN_MS - HOUR) }),
    ).toEqual({ due: false, reason: "cooldown" });
  });

  it("allows another reminder once a week has passed", () => {
    expect(
      verdict({ lastRemindedAt: ago(CART_REMINDER_COOLDOWN_MS + HOUR) }).due,
    ).toBe(true);
  });

  it("treats a never-reminded buyer as eligible", () => {
    expect(verdict({ lastRemindedAt: null }).due).toBe(true);
  });
});

describe("cart reminder — odd clocks", () => {
  it("does not nudge a cart touched in the future", () => {
    // Clock skew between app servers must not produce a reminder about a
    // cart the buyer is editing right now.
    const future = new Date(NOW.getTime() + HOUR);
    expect(verdict({ lastTouchedAt: future })).toEqual({
      due: false,
      reason: "too-fresh",
    });
  });
});

describe("cart reminder — the message", () => {
  it("counts one item in the singular", () => {
    expect(cartReminderMessage(1).body).toContain("1 item in your cart");
  });

  it("counts several items in the plural", () => {
    expect(cartReminderMessage(4).body).toContain("4 items in your cart");
  });

  it("keeps the wording plain", () => {
    const { title, body } = cartReminderMessage(2);
    expect(title.length).toBeLessThanOrEqual(40);
    expect(body).not.toMatch(/subscription|endpoint|permission/i);
  });
});
