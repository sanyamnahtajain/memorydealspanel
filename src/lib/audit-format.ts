/**
 * Pure audit-log formatting helpers.
 *
 * These are transport- and React-agnostic string builders shared by the audit
 * preview components ({@link AuditLogPreview}, {@link RecentActivityPanel}) and
 * unit-tested in `audit-format.test.ts`. They never throw on unknown input:
 * every function degrades to a sensible, human-readable fallback so a novel
 * `action` or an unexpected `diff` shape still renders something usable.
 *
 * Conventions mirrored from the codebase:
 *   - `action` is "<entity>.<verb>" (e.g. "product.update", "access.approve").
 *     A bare verb ("approve") or a deeper key ("product.image.setPrimary") is
 *     tolerated — the last dotted segment is the verb.
 *   - `diff` is a small JSON object, most commonly one of:
 *       { changed: ["name", "price"] }        → "name, price"
 *       { status: "APPROVED" }                → "status → APPROVED"
 *       { order: [...] } / { url, count } ... → field-name list fallback
 */

/* ------------------------------------------------------------------ */
/* humanizeAction                                                      */
/* ------------------------------------------------------------------ */

/** Known verbs → human sentence fragment. Keyed by the trailing verb. */
const VERB_LABELS: Record<string, string> = {
  create: "Created",
  createsub: "Created",
  add: "Added",
  addmanual: "Added",
  update: "Updated",
  edit: "Updated",
  save: "Updated",
  notes: "Updated notes on",
  reorder: "Reordered",
  status: "Changed status of",
  setstatus: "Changed status of",
  delete: "Deleted",
  softdelete: "Deleted",
  remove: "Removed",
  restore: "Restored",
  duplicate: "Duplicated",
  approve: "Approved",
  bulkapprove: "Approved",
  reject: "Rejected",
  block: "Blocked",
  extend: "Extended",
  bulkextend: "Extended",
  grant: "Granted",
  revoke: "Revoked",
  bulkrevoke: "Revoked",
  resetpassword: "Reset password for",
  login: "Signed in to",
  register: "Registered",
  attach: "Added image to",
  setprimary: "Set primary image on",
};

/**
 * Known entity keys → a lowercase noun for the object of the sentence.
 * The verb comes from the action; the noun from the action's entity prefix.
 */
const ENTITY_NOUNS: Record<string, string> = {
  product: "product",
  category: "category",
  customer: "customer",
  access: "access",
  grant: "access",
  role: "role",
  user: "user",
  admin: "admin",
  request: "access request",
  accessrequest: "access request",
  image: "image",
};

/**
 * Title-cases a bare identifier, splitting on separators and camel/Pascal-case
 * boundaries: "access_request" → "Access request", "AccessRequest" → "Access
 * request", "setPrimary" → "Set primary".
 */
function titleize(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim();
  if (!spaced) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Turns an audit `action` into a short human phrase, e.g.
 *   "product.update"        → "Updated product"
 *   "access.approve"        → "Approved access"
 *   "product.image.setPrimary" → "Set primary image on product"
 *   "role.create"           → "Created role"
 *
 * Unknown verbs fall back to a title-cased verb; unknown entity prefixes fall
 * back to a title-cased noun. Never throws.
 */
export function humanizeAction(action: string): string {
  const raw = (action ?? "").trim();
  if (!raw) return "Made a change";

  const segments = raw.split(".");
  const verbKey = segments[segments.length - 1].toLowerCase();
  const entityKey = segments.length > 1 ? segments[0].toLowerCase() : "";

  const verb = VERB_LABELS[verbKey] ?? titleize(verbKey);
  const noun = entityKey
    ? (ENTITY_NOUNS[entityKey] ?? titleize(entityKey).toLowerCase())
    : "";

  return noun ? `${verb} ${noun}` : verb;
}

/* ------------------------------------------------------------------ */
/* summarizeDiff                                                       */
/* ------------------------------------------------------------------ */

/** Keys that carry bookkeeping, not user-meaningful change, when listing fields. */
const NOISE_KEYS = new Set(["count", "grantId", "changed"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/** Renders a scalar diff value compactly for the "field → value" form. */
function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

/**
 * Produces a short humanized summary of a diff JSON blob:
 *   { changed: ["name", "price"] }  → "name, price"
 *   { status: "APPROVED" }          → "status → APPROVED"
 *   { order: [...] }                → "order"
 *   { url, count }                  → "url"
 *
 * Rules (first match wins):
 *   1. An explicit `changed` array is rendered as a comma list of field names.
 *   2. A single meaningful scalar key becomes "key → value".
 *   3. Otherwise, the meaningful field names are listed comma-separated.
 * Returns an empty string when there is nothing worth showing. Never throws.
 */
export function summarizeDiff(diff: unknown): string {
  if (diff === null || diff === undefined) return "";

  // Non-object diffs (rare) — stringify a scalar, ignore arrays.
  if (!isPlainObject(diff)) {
    return Array.isArray(diff) ? "" : formatScalar(diff);
  }

  // 1. Explicit changed-field list.
  const changed = diff.changed;
  if (Array.isArray(changed) && changed.length > 0) {
    return changed.map((f) => String(f)).join(", ");
  }

  const entries = Object.entries(diff).filter(([, v]) => v !== undefined);
  const meaningful = entries.filter(([k]) => !NOISE_KEYS.has(k));
  const pool = meaningful.length > 0 ? meaningful : entries;
  if (pool.length === 0) return "";

  // 2. Single scalar key → "key → value".
  if (pool.length === 1) {
    const [key, value] = pool[0];
    if (!isPlainObject(value) && !Array.isArray(value)) {
      return `${key} → ${formatScalar(value)}`;
    }
    return key;
  }

  // 3. Multiple keys → list the field names.
  return pool.map(([k]) => k).join(", ");
}

/* ------------------------------------------------------------------ */
/* relativeTime                                                        */
/* ------------------------------------------------------------------ */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * A humanized "x ago" label with no external dependency, e.g.
 *   "just now", "2 minutes ago", "3 hours ago", "yesterday", "5 days ago".
 * Beyond a week it renders an en-IN short date ("11 Jul 2026").
 *
 * `now` is injectable so callers can pass a request-stable reference (keeping
 * SSR deterministic) and tests stay hermetic; it defaults to `Date.now()`.
 * Future timestamps clamp to "just now". Never throws — an invalid date yields
 * an empty string.
 */
export function relativeTime(date: Date | string | number, now: number = Date.now()): string {
  const then = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (Number.isNaN(then)) return "";

  const diff = now - then;
  if (diff < 45 * SECOND) return "just now";

  if (diff < HOUR) {
    const m = Math.max(1, Math.round(diff / MINUTE));
    return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  }
  if (diff < DAY) {
    const h = Math.round(diff / HOUR);
    return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  }
  if (diff < 2 * DAY) return "yesterday";
  if (diff < WEEK) {
    const d = Math.round(diff / DAY);
    return `${d} days ago`;
  }

  return new Date(then).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
