/**
 * Bound how long the database driver may hang.
 *
 * INCIDENT NOTE: customers reported the first page "loading and loading".
 * Measured from outside, the home page's first byte arrived in under a
 * second and then the response stalled for ~27–30 seconds. Thirty seconds is
 * the MongoDB driver's DEFAULT server-selection timeout: when a pooled
 * connection has gone bad — which is routine on serverless, where an instance
 * is frozen between requests and its sockets die quietly — the next query
 * does not fail, it WAITS, for the full default, while the customer watches a
 * skeleton screen.
 *
 * Three standard connection-string options fix that, and they are applied
 * here in code rather than left to whoever next edits DATABASE_URL:
 *
 *  - serverSelectionTimeoutMS / connectTimeoutMS: give up in seconds, not
 *    half a minute. Every read on a page path already fails soft, so a fast
 *    failure renders the page; a slow one renders nothing.
 *  - maxIdleTimeMS: retire a pooled connection that has sat idle, so a thawed
 *    instance opens a fresh socket instead of trusting a dead one.
 *
 * Anything the operator set explicitly in DATABASE_URL always wins. Verified
 * against Prisma's MongoDB engine: the options parse (no P1013) and an
 * unreachable server fails in the configured time rather than 30s.
 *
 * Deliberately NOT set: socketTimeoutMS (would kill legitimate long reads —
 * exports, the backup cron) and maxPoolSize (changes concurrency behaviour;
 * not something to alter blind during an incident).
 */

export const DB_TIMEOUT_DEFAULTS: Readonly<Record<string, string>> = {
  serverSelectionTimeoutMS: "8000",
  connectTimeoutMS: "8000",
  maxIdleTimeMS: "60000",
};

export function withBoundedTimeouts(url: string | undefined): string | undefined {
  if (!url) return url;
  // Only MongoDB URLs understand these options.
  if (!/^mongodb(\+srv)?:\/\//i.test(url)) return url;

  // String surgery, not `new URL`: a replica-set URL lists several hosts
  // ("mongodb://a,b,c/db"), which the WHATWG parser rejects.
  const queryAt = url.indexOf("?");
  const base = queryAt === -1 ? url : url.slice(0, queryAt);
  const query = queryAt === -1 ? "" : url.slice(queryAt + 1);

  const present = new Set(
    query
      .split("&")
      .map((pair) => pair.split("=")[0]?.trim().toLowerCase())
      .filter((key): key is string => Boolean(key)),
  );

  const additions = Object.entries(DB_TIMEOUT_DEFAULTS)
    .filter(([key]) => !present.has(key.toLowerCase()))
    .map(([key, value]) => `${key}=${value}`);
  if (additions.length === 0) return url;

  // A URL with no database path needs the "/" before "?" to stay valid.
  const hasPath = /^mongodb(\+srv)?:\/\/[^/]+\//i.test(base);
  const safeBase = hasPath ? base : `${base}/`;
  const merged = [query, ...additions].filter(Boolean).join("&");
  return `${safeBase}?${merged}`;
}
