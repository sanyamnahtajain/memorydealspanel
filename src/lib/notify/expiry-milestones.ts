/**
 * "Your access is ending" day-bucketing — the PURE brain of the daily nudge
 * cron (`/api/cron/notify`).
 *
 * The rule the owner asked for: warn a buyer 7, 3 and 1 days before their
 * price access lapses, and tell them once on the day it actually lapses. Every
 * message repeats the same deal — one order buys another
 * `AUTO_RENEW_ON_ORDER.EXTEND_DAYS` days.
 *
 * WHY CALENDAR DAYS, NOT ELAPSED HOURS: the cron fires once a day, but the
 * exact minute drifts (Vercel schedules "around" the slot, retries happen, and
 * a manual trigger can land at any hour). Bucketing on the raw millisecond gap
 * would mean a grant expiring at 09:00 IST is "7 days out" at a 08:00 run and
 * "6 days out" at a 10:00 run — the 7-day nudge would be skipped entirely.
 * So we compare IST CALENDAR DAYS: every run on the same Indian day resolves
 * to the same milestone, whatever the clock says. The shop and every buyer are
 * in IST, so IST is the honest calendar to count in — not UTC, which rolls
 * over at 05:30 in the middle of the Indian morning.
 *
 * Pure module: no DB, no env, no `new Date()` default hidden anywhere the
 * caller cannot control. The route supplies `now`.
 */

/** One nudge point on the run-up to expiry. */
export type ExpiryMilestone = "d7" | "d3" | "d1" | "expired";

/** Days-before-expiry that get a reminder, in the order we count them down. */
export const EXPIRY_REMINDER_DAYS = [7, 3, 1] as const;

/**
 * How many IST days after the lapse we may still send the "access ended"
 * note. It must be at least 1: a grant expiring at 23:00 IST has already
 * lapsed by the time the next morning's run happens, and that run is the first
 * chance we get to tell the buyer. Beyond that the news is stale — a customer
 * who lapsed last month should not suddenly be told about it.
 */
export const LAPSED_GRACE_DAYS = 1;

/** How far ahead the cron needs to look for candidates. */
export const MAX_REMINDER_DAYS = EXPIRY_REMINDER_DAYS[0];

/** India Standard Time is a fixed UTC+05:30 — no DST, ever. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const MS_PER_DAY = 86_400_000;

/** The IST calendar day an instant falls on, as a day number since epoch. */
function istDayNumber(at: Date): number {
  return Math.floor((at.getTime() + IST_OFFSET_MS) / MS_PER_DAY);
}

/** The IST calendar date of an instant as `YYYY-MM-DD` (a dedupe key part). */
export function istDateKey(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Whole IST calendar days from `now` to `expiresAt`. 0 = expiry falls today,
 * 7 = a week from today, negative = already in the past.
 */
export function istDaysUntil(expiresAt: Date, now: Date): number {
  return istDayNumber(expiresAt) - istDayNumber(now);
}

/**
 * Which reminder (if any) is due for a grant expiring at `expiresAt`, judged
 * at `now`. Returns `null` when nothing should be sent.
 *
 *  - `null` expiry  → never nudge (unlimited access has nothing to end)
 *  - 7 / 3 / 1 IST days out → "d7" / "d3" / "d1"
 *  - already lapsed, today or yesterday in IST → "expired"
 *  - anything else (2 days out, 4 days out, lapsed long ago) → null
 *
 * Note "0 days out but not yet lapsed" is deliberately null: the buyer heard
 * from us yesterday ("d1"), and they will hear again the moment it lapses.
 * Sending a fourth warning the same morning is nagging, not helping.
 */
export function milestoneFor(
  expiresAt: Date | null | undefined,
  now: Date,
): ExpiryMilestone | null {
  if (!expiresAt) return null;

  const lapsed = expiresAt.getTime() <= now.getTime();
  const days = istDaysUntil(expiresAt, now);

  if (lapsed) {
    return days >= -LAPSED_GRACE_DAYS ? "expired" : null;
  }

  for (const day of EXPIRY_REMINDER_DAYS) {
    if (days === day) return `d${day}`;
  }
  return null;
}
