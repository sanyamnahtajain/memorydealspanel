import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import type { Session } from "@prisma/client";
import { prisma } from "@/server/db";
import { SESSION_COOKIE } from "./cookie";

/**
 * Session management for the hand-rolled cookie auth.
 *
 * A session is a random 256-bit token delivered to the browser in an
 * httpOnly cookie. Only the SHA-256 of the token is persisted (Session.tokenHash),
 * so a database leak never yields usable session cookies. Admin sessions
 * are short (24h); customer sessions long-lived (30d) for a smoother
 * wholesale-buyer experience.
 */

/**
 * Cookie name for the opaque session token. Re-exported from the Edge-safe
 * `./cookie` module so existing importers (`actions.ts`) keep working, while
 * the single source of truth lives in a Prisma-/crypto-free file that the Edge
 * middleware can import without dragging Prisma into the Edge runtime.
 */
export { SESSION_COOKIE };

const TOKEN_BYTES = 32; // 256-bit opaque token
const ADMIN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CUSTOMER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d

/**
 * Only bump lastSeenAt at most once per this interval to avoid a DB write
 * on every request while still giving a usable "active sessions" signal.
 */
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000; // 5min

/** SHA-256 hex of the raw token — what we store and look up by. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Trim + length-cap an optional request-context string, collapsing empty /
 * whitespace-only values to null. Keeps stray-long UA/IP headers from bloating
 * the row without rejecting the login.
 */
function normalizeContextValue(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export interface CreateSessionResult {
  /** The raw (unhashed) token — only returned here, never persisted. */
  token: string;
  expiresAt: Date;
}

type SessionSubject =
  | { kind: "admin"; adminId: string }
  | { kind: "customer"; customerId: string };

/**
 * Optional request-context captured at login so the admin Sessions viewer can
 * show which device/network a session belongs to. Both fields are best-effort
 * and may be absent (e.g. programmatic logins, tests); they are never trusted
 * for authorization — only surfaced for observability.
 */
export interface SessionContext {
  /** Client IP as derived from x-forwarded-for / x-real-ip. */
  ipAddress?: string | null;
  /** Raw User-Agent header, parsed into a friendly label at read time. */
  userAgent?: string | null;
}

/**
 * Create a session for an admin or customer, persist only its hash, and set
 * the httpOnly cookie. Returns the raw token + expiry (mostly for testing;
 * callers normally just rely on the cookie side effect).
 *
 * `context` (ip/userAgent) is optional and additive: existing callers that omit
 * it keep working, and the columns simply stay null.
 */
export async function createSession(
  subject: SessionSubject,
  context?: SessionContext,
): Promise<CreateSessionResult> {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(token);
  const ttl = subject.kind === "admin" ? ADMIN_TTL_MS : CUSTOMER_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);

  await prisma.session.create({
    data: {
      tokenHash,
      expiresAt,
      adminId: subject.kind === "admin" ? subject.adminId : null,
      customerId: subject.kind === "customer" ? subject.customerId : null,
      ipAddress: normalizeContextValue(context?.ipAddress, 100),
      userAgent: normalizeContextValue(context?.userAgent, 512),
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return { token, expiresAt };
}

/**
 * Resolve the current session from the cookie: an unrevoked, unexpired
 * Session row, or null. Bumps lastSeenAt at most once per throttle window.
 * Never throws — a bad/absent cookie or DB hiccup yields null.
 */
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);
  const now = new Date();

  let session: Session | null;
  try {
    session = await prisma.session.findUnique({ where: { tokenHash } });
  } catch {
    return null;
  }

  if (
    !session ||
    session.revokedAt !== null ||
    session.expiresAt.getTime() <= now.getTime()
  ) {
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() >= LAST_SEEN_THROTTLE_MS) {
    try {
      await prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      });
      session.lastSeenAt = now;
    } catch {
      // A failed throttle bump must not fail the request.
    }
  }

  return session;
}

/**
 * Revoke a single session by its raw token (soft delete via revokedAt).
 * Idempotent: revoking an unknown/already-revoked token is a no-op.
 */
export async function revokeSession(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revoke every active session for a customer — used when a customer is
 * blocked or their access is revoked, to immediately cut off price access.
 */
export async function revokeAllForCustomer(customerId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { customerId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Clear the session cookie from the browser. */
export async function destroyCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
