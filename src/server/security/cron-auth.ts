import { timingSafeEqual } from "node:crypto";

/**
 * Shared authorization for cron routes.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; an `x-cron-secret`
 * header is also accepted for manual/GitHub triggers.
 *
 * FAILS CLOSED: with no configured secret there is no safe way to gate a
 * mutating endpoint, so the route does not run.
 *
 * The comparison is timing-safe. With a high-entropy secret a `===` leak is
 * close to unexploitable, but these routes mutate data and export the whole
 * database — there is no reason to hand out the timing signal for free.
 */
function safeEqual(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on unequal lengths; length alone is not a secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (auth && safeEqual(auth, `Bearer ${secret}`)) return true;

  const headerSecret = request.headers.get("x-cron-secret");
  return headerSecret !== null && safeEqual(headerSecret, secret);
}
