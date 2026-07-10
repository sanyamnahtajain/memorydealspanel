import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

/**
 * Session directory service — the read/mutate layer behind the admin
 * `/admin/sessions` viewer (and the SessionsForUser panel embeddable in the
 * Users page / customer drawer later).
 *
 * This module is transport-agnostic: it performs NO authorization. The server
 * actions in `@/server/actions/sessions` own `assertAdmin`, audit, and
 * revalidation. Keeping the service auth-free makes it unit-testable against
 * the seeded database and lets the admin dashboard read from it directly after
 * its own page-level guard.
 *
 * A session belongs to exactly one subject: an Admin (`adminId`) or a Customer
 * (`customerId`). We never leak one admin's sessions to another improperly —
 * every listing goes through the admin-guarded actions, and reads project only
 * a safe, non-secret shape (the token hash never leaves this module).
 */

/* --------------------------------------------------------------------- */
/* User-Agent parsing                                                    */
/* --------------------------------------------------------------------- */

/** A friendly, de-jargoned device summary derived from a raw User-Agent. */
export interface ParsedUserAgent {
  /** Browser family, e.g. "Chrome", "Safari", "Firefox" (or "Unknown"). */
  browser: string;
  /** OS / platform family, e.g. "Windows", "macOS", "iOS", "Android". */
  os: string;
  /** Coarse form-factor for iconography. */
  device: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
  /** One-line label for the table, e.g. "Chrome on Windows". */
  label: string;
}

/** Ordered browser probes — first hit wins (order matters: Edge before Chrome). */
const BROWSER_RULES: { name: string; test: RegExp }[] = [
  { name: "Edge", test: /\bEdg(?:e|A|iOS)?\//i },
  { name: "Opera", test: /\b(?:OPR|Opera)\//i },
  { name: "Samsung Internet", test: /\bSamsungBrowser\//i },
  { name: "Firefox", test: /\bFirefox\//i },
  // Chrome must come after Edge/Opera/Samsung (they all embed "Chrome").
  { name: "Chrome", test: /\b(?:Chrome|CriOS|Chromium)\//i },
  // Safari must come last — Chrome/Edge UAs also contain "Safari".
  { name: "Safari", test: /\bVersion\/[\d.]+ .*Safari\//i },
];

const OS_RULES: { name: string; test: RegExp }[] = [
  { name: "iOS", test: /\b(?:iPhone|iPad|iPod)\b/i },
  { name: "Android", test: /\bAndroid\b/i },
  { name: "Windows", test: /\bWindows NT\b/i },
  { name: "macOS", test: /\bMac OS X\b/i },
  { name: "ChromeOS", test: /\bCrOS\b/i },
  { name: "Linux", test: /\bLinux\b/i },
];

const BOT_RE = /\b(bot|crawler|spider|crawl|slurp|facebookexternalhit|curl|wget|python-requests|httpclient|headless)\b/i;

/**
 * Parse a raw User-Agent header into a friendly, human-readable summary.
 *
 * Deliberately small and dependency-free (no ua-parser install): it recognizes
 * the browsers/OSes a wholesale buyer or admin realistically uses and degrades
 * gracefully to "Unknown device" for anything else. Never throws. Pure — unit
 * tested in `sessions.test.ts`.
 */
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  const raw = (ua ?? "").trim();
  if (!raw) {
    return { browser: "Unknown", os: "Unknown", device: "unknown", label: "Unknown device" };
  }

  if (BOT_RE.test(raw)) {
    return { browser: "Bot", os: "Unknown", device: "bot", label: "Automated client" };
  }

  const browser = BROWSER_RULES.find((r) => r.test.test(raw))?.name ?? "Unknown";
  const os = OS_RULES.find((r) => r.test.test(raw))?.name ?? "Unknown";

  // Form-factor: tablets (iPad, Android without "Mobile"), phones, else desktop.
  let device: ParsedUserAgent["device"];
  if (/\biPad\b/i.test(raw) || (/\bAndroid\b/i.test(raw) && !/\bMobile\b/i.test(raw))) {
    device = "tablet";
  } else if (/\b(Mobile|iPhone|iPod|Android)\b/i.test(raw)) {
    device = "mobile";
  } else if (browser === "Unknown" && os === "Unknown") {
    device = "unknown";
  } else {
    device = "desktop";
  }

  const label =
    browser === "Unknown" && os === "Unknown"
      ? "Unknown device"
      : browser === "Unknown"
        ? os
        : os === "Unknown"
          ? browser
          : `${browser} on ${os}`;

  return { browser, os, device, label };
}

/* --------------------------------------------------------------------- */
/* Session records                                                       */
/* --------------------------------------------------------------------- */

export type SessionKind = "admin" | "customer";

/** Serialized, secret-free session shape returned to the admin viewer. */
export interface SessionRecord {
  id: string;
  kind: SessionKind;
  /** Owning subject id (admin or customer). */
  subjectId: string;
  /** Display name — admin's name, or customer's business name. */
  subjectName: string;
  /** Admin email / customer phone, for disambiguation. */
  subjectDetail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  /** Friendly parse of `userAgent` (never null; degrades gracefully). */
  device: ParsedUserAgent;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  /** True when revoked OR past expiry — i.e. no longer usable. */
  revoked: boolean;
  /** When it was explicitly revoked (null when only expired / still active). */
  revokedAt: Date | null;
}

export interface ListSessionsParams {
  /** Restrict to admin or customer sessions; omit for both. */
  kind?: SessionKind;
  /** When true, only sessions that are neither revoked nor expired. */
  activeOnly?: boolean;
  /** 1-based page. @default 1 */
  page?: number;
  /** Rows per page (clamped 1..100). @default 20 */
  pageSize?: number;
}

export interface ListSessionsResult {
  sessions: SessionRecord[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SESSION_SELECT = {
  id: true,
  adminId: true,
  customerId: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
  lastSeenAt: true,
  expiresAt: true,
  revokedAt: true,
  admin: { select: { id: true, name: true, email: true } },
  customer: { select: { id: true, businessName: true, phone: true } },
} satisfies Prisma.SessionSelect;

type SessionRow = Prisma.SessionGetPayload<{ select: typeof SESSION_SELECT }>;

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function clampPageSize(size: number | undefined): number {
  if (!size || !Number.isFinite(size)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(size)));
}

function toRecord(row: SessionRow, now: Date): SessionRecord {
  const kind: SessionKind = row.adminId ? "admin" : "customer";
  const revoked =
    row.revokedAt !== null || row.expiresAt.getTime() <= now.getTime();

  const subjectName = row.admin
    ? row.admin.name
    : (row.customer?.businessName ?? "Unknown");
  const subjectDetail = row.admin
    ? row.admin.email
    : (row.customer?.phone ?? null);

  return {
    id: row.id,
    kind,
    subjectId: (row.adminId ?? row.customerId)!,
    subjectName,
    subjectDetail,
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    device: parseUserAgent(row.userAgent),
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    revoked,
    revokedAt: row.revokedAt ?? null,
  };
}

/**
 * Base WHERE clause for a `kind` filter.
 *
 * NOTE on `revokedAt: null`: like the `isActive` handling in the admin-user
 * service, we deliberately DO NOT filter on `revokedAt: null` in the Mongo
 * query. Sessions seeded/created before the field existed omit the key, and a
 * Prisma `where: { revokedAt: null }` filter does not match key-absent rows —
 * it even fails to match freshly-created rows here — so the "active" predicate
 * is applied in JS (`isSessionActive`) after hydrating the default. `expiresAt`
 * is a real stored Date and filters correctly, so it stays in the query.
 */
function buildKindWhere(
  kind: SessionKind | undefined,
): Prisma.SessionWhereInput {
  if (kind === "admin") return { adminId: { not: null } };
  if (kind === "customer") return { customerId: { not: null } };
  return {};
}

/** A session is active when it is neither revoked nor past its expiry. */
function isSessionActive(
  row: { revokedAt: Date | null; expiresAt: Date },
  now: Date,
): boolean {
  return row.revokedAt === null && row.expiresAt.getTime() > now.getTime();
}

/* --------------------------------------------------------------------- */
/* Reads                                                                 */
/* --------------------------------------------------------------------- */

/**
 * Paginated listing of sessions (admin and/or customer), newest-seen first.
 * Admin-only — call from an admin-guarded action/page.
 */
export async function listSessions(
  params: ListSessionsParams = {},
): Promise<ListSessionsResult> {
  const now = new Date();
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = clampPageSize(params.pageSize);
  const kindWhere = buildKindWhere(params.kind);

  // The `activeOnly` predicate depends on `revokedAt`, which we must evaluate
  // in JS (see buildKindWhere). To keep pagination correct we fetch the matching
  // rows, filter, then slice — session volumes are admin-scale, not unbounded.
  if (params.activeOnly) {
    const all = await prisma.session.findMany({
      where: kindWhere,
      select: SESSION_SELECT,
      orderBy: [{ lastSeenAt: "desc" }],
    });
    const active = all.filter((r) => isSessionActive(r, now));
    const total = active.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    return {
      sessions: active.slice(start, start + pageSize).map((r) => toRecord(r, now)),
      total,
      page: Math.min(page, pageCount),
      pageSize,
      pageCount,
    };
  }

  const [total, rows] = await Promise.all([
    prisma.session.count({ where: kindWhere }),
    prisma.session.findMany({
      where: kindWhere,
      select: SESSION_SELECT,
      orderBy: [{ lastSeenAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return {
    sessions: rows.map((r) => toRecord(r, now)),
    total,
    page: Math.min(page, pageCount),
    pageSize,
    pageCount,
  };
}

/**
 * All sessions for a single subject (admin or customer), newest-seen first.
 * Backs the embeddable `SessionsForUser` panel. Admin-only.
 */
export async function listSessionsForSubject(
  kind: SessionKind,
  id: string,
): Promise<SessionRecord[]> {
  const now = new Date();
  const rows = await prisma.session.findMany({
    where: kind === "admin" ? { adminId: id } : { customerId: id },
    select: SESSION_SELECT,
    orderBy: [{ lastSeenAt: "desc" }],
  });
  return rows.map((r) => toRecord(r, now));
}

/**
 * Counts a subject's currently-active (unrevoked, unexpired) sessions. The
 * revoked/expired predicate is evaluated in JS (see buildKindWhere) so it also
 * counts rows created before `revokedAt` existed.
 */
export async function countActiveSessionsForSubject(
  kind: SessionKind,
  id: string,
): Promise<number> {
  const now = new Date();
  const rows = await prisma.session.findMany({
    where: kind === "admin" ? { adminId: id } : { customerId: id },
    select: { revokedAt: true, expiresAt: true },
  });
  return rows.filter((r) => isSessionActive(r, now)).length;
}

/* --------------------------------------------------------------------- */
/* Mutations                                                             */
/* --------------------------------------------------------------------- */

/**
 * Revoke a single session by its id (soft delete via revokedAt). Returns the
 * subject it belonged to (for auditing/revalidation), or null when the id is
 * unknown. Idempotent — already-revoked rows are left untouched but still
 * report their subject.
 */
export async function revokeSessionById(
  id: string,
): Promise<{ kind: SessionKind; subjectId: string } | null> {
  const row = await prisma.session.findUnique({
    where: { id },
    select: { id: true, adminId: true, customerId: true, revokedAt: true },
  });
  if (!row) return null;

  if (row.revokedAt === null) {
    await prisma.session.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  const kind: SessionKind = row.adminId ? "admin" : "customer";
  return { kind, subjectId: (row.adminId ?? row.customerId)! };
}

/**
 * Revoke every active session for a subject (admin or customer). Returns the
 * number of sessions revoked. Used for "Sign out all devices".
 */
export async function revokeAllForSubject(
  kind: SessionKind,
  id: string,
): Promise<number> {
  // Select the not-yet-revoked rows in JS (a `where: { revokedAt: null }`
  // filter misses key-absent rows here — see buildKindWhere), then revoke by id.
  const rows = await prisma.session.findMany({
    where: kind === "admin" ? { adminId: id } : { customerId: id },
    select: { id: true, revokedAt: true },
  });
  const toRevoke = rows.filter((r) => r.revokedAt === null).map((r) => r.id);
  if (toRevoke.length === 0) return 0;

  const result = await prisma.session.updateMany({
    where: { id: { in: toRevoke } },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
