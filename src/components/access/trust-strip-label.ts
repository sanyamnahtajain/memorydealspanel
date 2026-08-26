import { resolveAccessState } from "@/lib/access-status";
import type { AccessStatusSnapshot } from "@/components/access/useAccessStatus";

/**
 * Pure label builder for the TrustStrip — kept out of the component so the
 * visibility rule and wording can be unit-tested without a DOM.
 *
 * Returns the one-line label for a HEALTHY customer, or `null` when the strip
 * must not render at all. The strip is the quiet counterpart of the
 * AccessStatusBanner: the banner owns every problem state (pending, expiring,
 * expired, rejected) and this owns ONLY "active" — so the two can share a
 * slot in the shell and never show together.
 *
 * SIMPLE ENGLISH (owner request): "Prices open", not "approved".
 */

/** Business timezone — dates shown to customers are Indian calendar dates. */
const TIME_ZONE = "Asia/Kolkata";

/** "23 Sept", with the year appended only when it is not the current year. */
export function formatTillDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const yearOf = (d: Date) =>
    d.toLocaleDateString("en-IN", { year: "numeric", timeZone: TIME_ZONE });
  const sameYear = yearOf(date) === yearOf(now);
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" as const }),
    timeZone: TIME_ZONE,
  });
}

/** "1 order" / "12 orders" — or `null` when there is nothing to brag about. */
export function formatOrderCount(count: number | undefined): string | null {
  if (!count || count <= 0 || !Number.isFinite(count)) return null;
  return `${count} ${count === 1 ? "order" : "orders"}`;
}

/**
 * The full strip label, e.g. "Prices open · till 23 Sept · 12 orders".
 *
 * `null` when the strip must stay hidden: no snapshot yet (enhancement — no
 * skeleton) or any state other than "active". "expiring" is deliberately the
 * banner's, not ours, even though prices are still open.
 */
export function trustStripLabel(
  snapshot: AccessStatusSnapshot | null,
  now: Date = new Date(),
): string | null {
  if (!snapshot) return null;
  if (resolveAccessState(snapshot, now) !== "active") return null;

  const parts = ["Prices open"];
  // Omitted entirely for a never-expiring grant.
  if (snapshot.expiresAt) {
    parts.push(`till ${formatTillDate(snapshot.expiresAt, now)}`);
  }
  const orders = formatOrderCount(snapshot.orderCount);
  if (orders) parts.push(orders);
  return parts.join(" · ");
}
