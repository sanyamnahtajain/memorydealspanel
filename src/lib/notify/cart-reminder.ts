/**
 * When is an idle cart worth a nudge?
 *
 * Pure decision logic, kept out of the cron route so it can be tested without
 * a database or a clock. The route supplies the facts; this decides.
 *
 * The shape of the rule matters more than the numbers. A wholesale buyer
 * building an order over a couple of days is NOT abandoning it, so we wait a
 * full day before saying anything. A cart untouched for weeks is a dead cart,
 * and a reminder about it reads as spam — so there is an upper bound too. And
 * one reminder per week, whatever happens, because the fastest way to get
 * notifications switched off is to send the same one twice.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Leave the buyer alone until the cart has been untouched this long. */
export const CART_IDLE_MIN_MS = 24 * HOUR;

/** Past this, the cart is stale rather than pending — say nothing. */
export const CART_IDLE_MAX_MS = 14 * DAY;

/** Never more than one cart reminder per buyer in this window. */
export const CART_REMINDER_COOLDOWN_MS = 7 * DAY;

export interface CartReminderInput {
  /** When the buyer last touched any line in their cart. */
  lastTouchedAt: Date;
  /** When we last sent this buyer a cart reminder, if ever. */
  lastRemindedAt: Date | null;
  /** How many lines are sitting in the cart. */
  itemCount: number;
  now: Date;
}

export type CartReminderVerdict =
  | { due: true }
  | { due: false; reason: "empty" | "too-fresh" | "too-stale" | "cooldown" };

/** Should this buyer hear about their cart right now? */
export function cartReminderDue(input: CartReminderInput): CartReminderVerdict {
  const { lastTouchedAt, lastRemindedAt, itemCount, now } = input;

  if (itemCount <= 0) return { due: false, reason: "empty" };

  const idleFor = now.getTime() - lastTouchedAt.getTime();
  // A negative idle time means the clock moved backwards or the row was just
  // written; either way it is not idle.
  if (idleFor < CART_IDLE_MIN_MS) return { due: false, reason: "too-fresh" };
  if (idleFor > CART_IDLE_MAX_MS) return { due: false, reason: "too-stale" };

  if (lastRemindedAt !== null) {
    const since = now.getTime() - lastRemindedAt.getTime();
    if (since < CART_REMINDER_COOLDOWN_MS) {
      return { due: false, reason: "cooldown" };
    }
  }

  return { due: true };
}

/**
 * The reminder text. Simple English, and it names the number of items so the
 * buyer recognises their own cart rather than reading it as an advert.
 */
export function cartReminderMessage(itemCount: number): {
  title: string;
  body: string;
} {
  const items = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  return {
    title: "Your cart is waiting",
    body: `You have ${items} in your cart. Place the order when you are ready — prices can change.`,
  };
}
