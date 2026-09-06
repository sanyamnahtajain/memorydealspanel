import { z } from "zod";

/**
 * Maintenance mode — the owner's "take the shop down" switch.
 *
 * WHAT IT DOES: while ON, storefront GET navigations render one bare screen
 * carrying the owner's message and, optionally, when the shop expects to be
 * back. Nothing else about the app changes.
 *
 * WHAT IT DELIBERATELY DOES NOT DO — and why each matters more than the
 * feature itself, because this switch can take a live shop offline:
 *
 *  - It NEVER covers /admin. The one thing worse than an outage is an outage
 *    you cannot switch off, so the console that holds the toggle always stays
 *    reachable (see src/proxy.ts for the exempt list).
 *  - It FAILS OPEN. A malformed row, a missing field, a database hiccup — all
 *    resolve to OFF. A shop that is accidentally up is a nuisance; a shop
 *    that is accidentally down is lost orders.
 *  - `until` NEVER lifts maintenance by itself. It is a promise printed for
 *    customers, not a timer. Auto-lifting would put a half-migrated shop back
 *    in front of buyers at exactly the moment nobody is watching; leaving it
 *    down until a human flips it back is the safe direction to fail.
 */

export const MAX_MAINTENANCE_MESSAGE_CHARS = 500;

export const maintenanceSchema = z.object({
  enabled: z.boolean(),
  /** Owner's copy for the screen. Empty => the built-in wording is used. */
  message: z
    .string()
    .trim()
    .max(MAX_MAINTENANCE_MESSAGE_CHARS)
    .nullish()
    .catch(null),
  /**
   * When the shop expects to be back, as an ISO instant. Display only — see
   * the header. A malformed value degrades to null rather than failing the
   * whole config (which would flip maintenance OFF unexpectedly).
   */
  until: z
    .string()
    .datetime({ offset: true })
    .nullish()
    .catch(null),
});

export type Maintenance = z.infer<typeof maintenanceSchema>;

/** Before it has ever been configured: the shop is up. */
export const MAINTENANCE_OFF: Maintenance = {
  enabled: false,
  message: null,
  until: null,
};

/**
 * Defensive read of the stored JSON. Absent or malformed => OFF. See the
 * header: this must fail open, always.
 */
export function parseMaintenance(value: unknown): Maintenance {
  if (value === null || value === undefined) return MAINTENANCE_OFF;
  const parsed = maintenanceSchema.safeParse(value);
  if (!parsed.success) return MAINTENANCE_OFF;
  return {
    enabled: parsed.data.enabled,
    message: parsed.data.message?.trim() ? parsed.data.message.trim() : null,
    until: parsed.data.until ?? null,
  };
}

/** The wording customers see when the owner left the message blank. */
export const MAINTENANCE_FALLBACK_MESSAGE =
  "We're making some updates to the shop. Please check back shortly.";

/**
 * "Back by 4:30 pm, 5 Sep" for the screen — or null when no time was set or
 * the stored value is unusable. Never throws; the screen must render.
 */
export function backOnlineLabel(
  until: string | null,
  locale = "en-IN",
): string | null {
  if (!until) return null;
  const when = new Date(until);
  if (Number.isNaN(when.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      day: "numeric",
      month: "short",
      timeZone: "Asia/Kolkata",
    }).format(when);
  } catch {
    return null;
  }
}

/**
 * Seconds for a `Retry-After` header, when a return time is set and still in
 * the future. Bounded to a day so a stale config can't tell a crawler to
 * disappear for a month.
 */
export function retryAfterSeconds(
  until: string | null,
  now: Date = new Date(),
): number | null {
  if (!until) return null;
  const when = new Date(until);
  if (Number.isNaN(when.getTime())) return null;
  const seconds = Math.round((when.getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return null;
  return Math.min(seconds, 86_400);
}
