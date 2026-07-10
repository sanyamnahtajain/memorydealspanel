import type { AccessRequest, Customer } from "@prisma/client";
import type { AccessRequestInput } from "@/lib/schemas/customer";
import { hashPassword } from "@/server/auth/password";
import { revokeAllForCustomer } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { sendPushToAdmin } from "@/server/notify/push";
import { requestAccessLimiter } from "@/server/security/ratelimit";
import { verifyTurnstile } from "@/server/security/turnstile";

/**
 * Access-lifecycle service — the customer price-access state machine.
 *
 * This is the single place that moves a customer through the
 * PENDING → APPROVED → EXPIRED / REJECTED / BLOCKED graph while keeping the
 * two coupled facts consistent:
 *   - `Customer.status`
 *   - the set of `AccessGrant` rows (approvedAt / expiresAt / revokedAt)
 *
 * `resolveViewer.priceAccess` is computed from exactly these two facts
 * (status === "APPROVED" AND a live, unrevoked, unexpired grant), so every
 * transition here must leave them in agreement. The unit tests assert that
 * invariant after each move.
 *
 * These functions are transport-agnostic. Authorization (assertAdmin), input
 * validation (zod) and audit/revalidation live in
 * `@/server/actions/access`. The one exception is `requestAccess`, which is a
 * PUBLIC entry point and therefore owns its own abuse protection (Turnstile +
 * rate limit) here.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * MS_PER_DAY);
}

/* ----------------------------------------------------------------------- */
/* Public: request access                                                  */
/* ----------------------------------------------------------------------- */

export type RequestAccessResult =
  | { ok: true; customerId: string; status: "PENDING"; duplicate: boolean }
  | { ok: false; error: string };

/**
 * Public access-request entry point (F-C7). Verifies the Turnstile token and
 * consumes a rate-limit point (keyed by IP), then:
 *   - dedupes by phone: if a customer already exists whose latest request is
 *     PENDING (or who is already APPROVED), we return the current state
 *     WITHOUT creating a duplicate customer/request;
 *   - otherwise creates the Customer (PENDING, hashed password) + a PENDING
 *     AccessRequest + an 'access_request' Notification, and pings admins over
 *     Web Push.
 *
 * `input` must already be validated by the caller (the action layer parses it
 * with `accessRequestSchema`, which normalizes the phone to +91XXXXXXXXXX and
 * canonicalizes the GSTIN).
 */
export async function requestAccess(
  input: AccessRequestInput,
  turnstileToken: string,
  ip: string,
): Promise<RequestAccessResult> {
  const captcha = await verifyTurnstile(turnstileToken, ip);
  if (!captcha.ok) {
    return { ok: false, error: "Captcha verification failed. Please retry." };
  }

  const limited = await requestAccessLimiter.limit(ip || "unknown");
  if (!limited.ok) {
    return {
      ok: false,
      error: "Too many requests. Please try again in a little while.",
    };
  }

  // Dedupe by phone (Customer.phone is @unique).
  const existing = await prisma.customer.findUnique({
    where: { phone: input.phone },
    select: { id: true, status: true },
  });

  if (existing) {
    // Already approved, or a request is still pending: don't duplicate.
    if (existing.status === "APPROVED") {
      return {
        ok: false,
        error: "This number is already approved. Please sign in.",
      };
    }
    const pending = await prisma.accessRequest.findFirst({
      where: { customerId: existing.id, status: "PENDING" },
      select: { id: true },
    });
    if (pending) {
      return {
        ok: true,
        customerId: existing.id,
        status: "PENDING",
        duplicate: true,
      };
    }
    // A previously rejected/expired/blocked customer may re-apply: open a
    // fresh PENDING request and move them back to PENDING for review.
    const passwordHash = await hashPassword(input.password);
    const reopened = await prisma.customer.update({
      where: { id: existing.id },
      data: {
        businessName: input.businessName,
        contactName: input.contactName,
        passwordHash,
        email: input.email ?? null,
        gstNumber: input.gstNumber ?? null,
        city: input.city ?? null,
        status: "PENDING",
        requests: { create: { status: "PENDING" } },
      },
      select: { id: true, businessName: true },
    });
    await notifyAdminsOfRequest(reopened.id, reopened.businessName, input.phone);
    return {
      ok: true,
      customerId: reopened.id,
      status: "PENDING",
      duplicate: false,
    };
  }

  const passwordHash = await hashPassword(input.password);
  const customer = await prisma.customer.create({
    data: {
      businessName: input.businessName,
      contactName: input.contactName,
      phone: input.phone,
      passwordHash,
      email: input.email ?? null,
      gstNumber: input.gstNumber ?? null,
      city: input.city ?? null,
      status: "PENDING",
      requests: { create: { status: "PENDING" } },
    },
    select: { id: true, businessName: true },
  });

  await notifyAdminsOfRequest(customer.id, customer.businessName, input.phone);

  return {
    ok: true,
    customerId: customer.id,
    status: "PENDING",
    duplicate: false,
  };
}

/**
 * Persist an in-app Notification and fire a Web Push to admins. Never throws:
 * a notification failure must not fail the access request itself.
 */
async function notifyAdminsOfRequest(
  customerId: string,
  businessName: string,
  phone: string,
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        type: "access_request",
        payload: { customerId, businessName, phone },
      },
    });
  } catch (error) {
    console.error("[access] failed to persist notification:", error);
  }

  try {
    await sendPushToAdmin({
      title: "New access request",
      body: `${businessName} requested price access`,
      url: `/admin/requests`,
    });
  } catch (error) {
    console.error("[access] failed to send admin push:", error);
  }
}

/* ----------------------------------------------------------------------- */
/* Admin transitions                                                       */
/* ----------------------------------------------------------------------- */

export interface ApproveOptions {
  /**
   * Days of validity from now, or `null` for an unlimited (never-expiring)
   * grant. When omitted the caller-side default (30d) should be applied
   * before calling; this service treats `undefined` as `null`.
   */
  expiresInDays?: number | null;
  /** Admin id recorded as `AccessGrant.grantedBy`. */
  grantedBy: string;
}

export interface AccessGrantRecord {
  id: string;
  customerId: string;
  approvedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  grantedBy: string;
}

export interface ApproveResult {
  customer: Customer;
  grant: AccessGrantRecord;
}

/**
 * Approve a pending (or re-approve a lapsed) customer: creates a fresh
 * AccessGrant, flips the customer to APPROVED, and marks the latest PENDING
 * request APPROVED. After this, `priceAccess` is true.
 */
export async function approveRequest(
  customerId: string,
  options: ApproveOptions,
): Promise<ApproveResult> {
  const now = new Date();
  const days = options.expiresInDays ?? null;
  const expiresAt = days === null ? null : addDays(now, days);

  const grant = await prisma.accessGrant.create({
    data: {
      customerId,
      approvedAt: now,
      expiresAt,
      // Persist `revokedAt` as an explicit null so the live-grant filter
      // (`revokedAt: null`) matches this row. On MongoDB an omitted optional
      // field is absent rather than null, and Prisma's `{ revokedAt: null }`
      // equality does NOT match an absent field — so a freshly minted grant
      // must set it explicitly or the price gate never opens. The seed does
      // the same; keep them consistent.
      revokedAt: null,
      grantedBy: options.grantedBy,
    },
  });

  const customer = await prisma.customer.update({
    where: { id: customerId },
    data: { status: "APPROVED" },
  });

  await prisma.accessRequest.updateMany({
    where: { customerId, status: "PENDING" },
    data: { status: "APPROVED", decidedAt: now },
  });

  return { customer, grant };
}

/**
 * Reject a pending request: marks the latest PENDING request REJECTED (with an
 * optional reason) and sets the customer to REJECTED. No grant is created, so
 * `priceAccess` stays false.
 */
export async function rejectRequest(
  customerId: string,
  reason?: string,
): Promise<Customer> {
  const now = new Date();
  await prisma.accessRequest.updateMany({
    where: { customerId, status: "PENDING" },
    data: { status: "REJECTED", reason: reason ?? null, decidedAt: now },
  });
  return prisma.customer.update({
    where: { id: customerId },
    data: { status: "REJECTED" },
  });
}

/**
 * Find the customer's current live grant (unrevoked and unexpired), if any.
 * This is the exact grant `resolveViewer` keys price-access off.
 */
async function findLiveGrant(customerId: string, now: Date) {
  return prisma.accessGrant.findFirst({
    where: {
      customerId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { approvedAt: "desc" },
  });
}

/**
 * Extend / renew access by `days`.
 *
 * If the customer has a live grant we push its `expiresAt` out from the later
 * of "now" and its current expiry (so renewing early stacks time rather than
 * shortening it). If there is no live grant (expired/never granted) we create
 * a fresh grant of `days` from now and re-approve the customer — this is the
 * renewal path that flips `priceAccess` back to true.
 */
export async function extendGrant(
  customerId: string,
  days: number,
  grantedBy: string,
): Promise<AccessGrantRecord> {
  const now = new Date();
  const live = await findLiveGrant(customerId, now);

  if (live) {
    // A never-expiring grant stays never-expiring.
    if (live.expiresAt === null) {
      await prisma.customer.update({
        where: { id: customerId },
        data: { status: "APPROVED" },
      });
      return live;
    }
    const base = live.expiresAt.getTime() > now.getTime() ? live.expiresAt : now;
    const updated = await prisma.accessGrant.update({
      where: { id: live.id },
      data: { expiresAt: addDays(base, days) },
    });
    await prisma.customer.update({
      where: { id: customerId },
      data: { status: "APPROVED" },
    });
    return updated;
  }

  const grant = await prisma.accessGrant.create({
    data: {
      customerId,
      approvedAt: now,
      expiresAt: addDays(now, days),
      // Explicit null so `findLiveGrant`'s `revokedAt: null` filter matches
      // this row on MongoDB (an omitted optional field is absent, not null).
      revokedAt: null,
      grantedBy,
    },
  });
  await prisma.customer.update({
    where: { id: customerId },
    data: { status: "APPROVED" },
  });
  return grant;
}

/** Alias for `extendGrant` — renewing lapsed access is the same operation. */
export const renewGrant = extendGrant;

/**
 * Revoke all live grants for a customer (sets `revokedAt`), moves them to
 * EXPIRED, and kills their sessions so price access is cut immediately. After
 * this, `priceAccess` is false. Idempotent.
 */
export async function revokeGrant(customerId: string): Promise<Customer> {
  const now = new Date();
  await prisma.accessGrant.updateMany({
    where: { customerId, revokedAt: null },
    data: { revokedAt: now },
  });
  const customer = await prisma.customer.update({
    where: { id: customerId },
    data: { status: "EXPIRED" },
  });
  await revokeAllForCustomer(customerId);
  return customer;
}

/**
 * Block a customer: flips status to BLOCKED and revokes every live grant +
 * session. A blocked customer never has price access regardless of grants.
 */
export async function blockCustomer(customerId: string): Promise<Customer> {
  const now = new Date();
  await prisma.accessGrant.updateMany({
    where: { customerId, revokedAt: null },
    data: { revokedAt: now },
  });
  const customer = await prisma.customer.update({
    where: { id: customerId },
    data: { status: "BLOCKED" },
  });
  await revokeAllForCustomer(customerId);
  return customer;
}

/**
 * Unblock a customer. Because blocking revoked their grants, unblocking cannot
 * silently restore price access — it returns them to REJECTED (a neutral,
 * non-approved state) from which an admin re-approves or extends to grant
 * access. `priceAccess` stays false until an explicit approve/extend.
 */
export async function unblockCustomer(customerId: string): Promise<Customer> {
  return prisma.customer.update({
    where: { id: customerId },
    data: { status: "REJECTED" },
  });
}

/* ----------------------------------------------------------------------- */
/* Cron: expire due grants                                                 */
/* ----------------------------------------------------------------------- */

export interface ExpireDueResult {
  /** Number of customers moved to EXPIRED. */
  expired: number;
  customerIds: string[];
}

/**
 * Expire grants whose `expiresAt` has passed (used by a scheduled cron).
 *
 * A customer is expired when they are currently APPROVED but have no live
 * grant at `now` (their only grants are past their `expiresAt` and none is
 * unlimited/unrevoked). We flip those customers to EXPIRED so the price gate
 * closes; the grant rows themselves are left as historical record (their
 * lapsed `expiresAt` already excludes them from `findLiveGrant`).
 */
export async function expireDueGrants(
  now: Date = new Date(),
): Promise<ExpireDueResult> {
  // Candidates: APPROVED customers who have at least one already-expired grant.
  const dueGrants = await prisma.accessGrant.findMany({
    where: {
      revokedAt: null,
      expiresAt: { lte: now },
      customer: { status: "APPROVED" },
    },
    select: { customerId: true },
  });

  const candidateIds = [...new Set(dueGrants.map((g) => g.customerId))];
  if (candidateIds.length === 0) {
    return { expired: 0, customerIds: [] };
  }

  const expiredIds: string[] = [];
  for (const customerId of candidateIds) {
    // Only expire if there is genuinely no live grant left for them.
    const live = await findLiveGrant(customerId, now);
    if (live) continue;
    await prisma.customer.update({
      where: { id: customerId },
      data: { status: "EXPIRED" },
    });
    expiredIds.push(customerId);
  }

  return { expired: expiredIds.length, customerIds: expiredIds };
}

/**
 * Compute a customer's live price-access exactly as `resolveViewer` does, from
 * status + grants. Exported so callers (and tests) can assert the price-access
 * invariant without going through the session/cookie layer.
 */
export async function computeCustomerPriceAccess(
  customerId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { status: true },
  });
  if (!customer || customer.status !== "APPROVED") {
    return false;
  }
  const live = await findLiveGrant(customerId, now);
  return live !== null;
}

/** The current PENDING/APPROVED request for a customer, if any. */
export async function currentRequest(
  customerId: string,
): Promise<AccessRequest | null> {
  return prisma.accessRequest.findFirst({
    where: { customerId },
    orderBy: { createdAt: "desc" },
  });
}
