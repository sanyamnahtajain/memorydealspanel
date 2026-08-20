"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import {
  approveRequest,
  extendGrant,
  rejectRequest,
  requestAccess as requestAccessService,
  revokeGrant,
  type RequestAccessResult,
  snoozeRequest,
  unsnoozeRequest,
} from "@/server/services/access";
import {
  bulkApprove,
  bulkExtend,
  bulkReject,
  bulkRevoke,
  type BulkResult,
} from "@/server/services/customers";
import { accessRequestSchema } from "@/lib/schemas/customer";
import { randomBytes } from "node:crypto";
import {
  consumeSignupHandoff,
  linkGoogleAccount,
  refundSignupHandoff,
} from "@/server/services/google-auth";
import { createSession } from "@/server/auth/session";
import { objectIdSchema } from "@/lib/schemas/shared";
import {
  ACCESS_EXPIRY_PRESETS_DAYS,
  DEFAULT_ACCESS_EXPIRY_DAYS,
} from "@/lib/constants";

/**
 * Access-lifecycle server actions (grants over a selection of customers).
 *
 * These are thin transport wrappers: authorization (`assertAdmin`), input
 * validation (zod), audit and revalidation live here; the price-access state
 * machine itself lives in `@/server/services/access` +
 * `@/server/services/customers` so the invariant (status ⇄ grants) is enforced
 * in one place. Never throws to the client — failures are `{ ok:false, error }`.
 */

export type ActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const ACTOR = "admin" as const;

/* ------------------------------------------------------------------ */
/* input schemas                                                       */
/* ------------------------------------------------------------------ */

/**
 * Validity chosen on approve / extend. Matches the {@link ExpiryDial}'s
 * `ExpiryActionInput`: either a preset (7/30/90 days), an explicit `expiresAt`
 * ISO timestamp (the dial's custom value), `expiresAt: null` for a
 * never-expiring grant, or absent ⇒ the default preset (30 days).
 */
// NOTE: not exported — a "use server" file may only export async functions,
// so runtime values (zod schemas) must stay module-internal.
const expiryInputSchema = z
  .object({
    /** Convenience preset selector — one of ACCESS_EXPIRY_PRESETS_DAYS. */
    presetDays: z
      .union(
        ACCESS_EXPIRY_PRESETS_DAYS.map((d) => z.literal(d)) as [
          z.ZodLiteral<number>,
          ...z.ZodLiteral<number>[],
        ],
      )
      .optional(),
    /** Explicit expiry timestamp (ISO), or null for a never-expiring grant. */
    expiresAt: z.iso.datetime().nullable().optional(),
  })
  .default({});
type ExpiryInput = z.infer<typeof expiryInputSchema>;

/**
 * Resolve an ExpiryInput to a concrete day count from now (or null = forever).
 * The services take a day count; a custom `expiresAt` is translated back to the
 * number of whole days between now and that date (min 1).
 */
function resolveDays(expiry: ExpiryInput): number | null {
  if (expiry.expiresAt !== undefined) {
    if (expiry.expiresAt === null) return null;
    const target = new Date(expiry.expiresAt).getTime();
    const diffMs = target - Date.now();
    return Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
  }
  if (expiry.presetDays !== undefined) return expiry.presetDays;
  return DEFAULT_ACCESS_EXPIRY_DAYS;
}

const approveSchema = z.object({
  customerId: objectIdSchema,
  expiry: expiryInputSchema,
});

const rejectSchema = z.object({
  customerId: objectIdSchema,
  reason: z.string().trim().max(500).optional(),
});

const revokeSchema = z.object({ customerId: objectIdSchema });

/** Public access-request payload: the validated form + a Turnstile token. */
const requestAccessSchema = z.object({
  form: accessRequestSchema,
  turnstileToken: z.string().default(""),
});

const bulkSchema = z.object({
  customerIds: z.array(objectIdSchema).min(1, "Select at least one customer"),
  expiry: expiryInputSchema,
});

const bulkRevokeSchema = z.object({
  customerIds: z.array(objectIdSchema).min(1, "Select at least one customer"),
});

const bulkRejectSchema = z.object({
  customerIds: z.array(objectIdSchema).min(1, "Select at least one customer"),
  reason: z.string().trim().max(500).optional(),
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function guarded<T>(
  run: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (isForbiddenError(error)) {
      return { ok: false, error: "You are not authorised to do that." };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
    }
    console.error("[actions/access] unexpected error:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

function revalidate(): void {
  revalidatePath("/admin/customers");
  revalidatePath("/admin/requests");
  revalidatePath("/admin/dashboard");
  // Pricing visibility is viewer-gated but cached per path.
  revalidatePath("/", "layout");
}

/** Collapse a service BulkResult into an action result, surfacing failures. */
function bulkResult(result: BulkResult): ActionResult<{
  count: number;
  failed: { id: string; error: string }[];
}> {
  return {
    ok: true,
    count: result.succeeded.length,
    failed: result.failed,
  };
}

/** Best-effort client IP from proxy headers (used for the request rate limit). */
async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}

/* ------------------------------------------------------------------ */
/* PUBLIC: request access (storefront form — no admin gate)            */
/* ------------------------------------------------------------------ */

/**
 * PUBLIC access-request action for the Phase 7 storefront form.
 *
 * Unlike every other action in this file it is NOT admin-gated: any visitor may
 * call it. Abuse protection (Cloudflare Turnstile + a per-IP rate limit) lives
 * inside `requestAccessService`, which also dedupes by phone so a repeat submit
 * doesn't create duplicate customers/requests. On success an admin Notification
 * + Web Push is fired by the service. Returns the service result directly so the
 * form can render "pending review" (including the `duplicate` case).
 */
export async function requestAccessAction(
  input: z.input<typeof requestAccessSchema>,
): Promise<RequestAccessResult> {
  const parsed = requestAccessSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  try {
    const ip = await clientIp();
    const result = await requestAccessService(
      parsed.data.form,
      parsed.data.turnstileToken,
      ip,
    );
    if (result.ok) {
      // Surface the new/updated pending request to the admin queue.
      revalidatePath("/admin/requests");
      revalidatePath("/admin/customers");
    }
    return result;
  } catch (error) {
    console.error("[actions/access] requestAccess failed:", error);
    return {
      ok: false,
      error: "Could not submit your request. Please try again.",
    };
  }
}

/**
 * Storefront-facing name for the request-access action. A "use server" file may
 * only export async functions (not a `const` alias), so this is a thin async
 * wrapper rather than `export const requestAccess = requestAccessAction`.
 */
export async function requestAccess(
  input: z.input<typeof requestAccessSchema>,
): Promise<RequestAccessResult> {
  return requestAccessAction(input);
}

/* ------------------------------------------------------------------ */
/* single-customer transitions                                         */
/* ------------------------------------------------------------------ */

export async function approveAccessAction(
  input: z.input<typeof approveSchema>,
): Promise<ActionResult<{ customerId: string }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_APPROVE);

    const { customerId, expiry } = approveSchema.parse(input);
    await approveRequest(customerId, {
      expiresInDays: resolveDays(expiry),
      grantedBy: viewer.adminId,
    });

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "access.approve",
      entity: "Customer",
      entityId: customerId,
      diff: { days: resolveDays(expiry) },
    });

    revalidate();
    return { ok: true, customerId };
  });
}

export async function extendAccessAction(
  input: z.input<typeof approveSchema>,
): Promise<ActionResult<{ customerId: string }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_APPROVE);

    const { customerId, expiry } = approveSchema.parse(input);
    const days = resolveDays(expiry);
    // A never-expiring extension is an approve (unlimited grant).
    if (days === null) {
      await approveRequest(customerId, {
        expiresInDays: null,
        grantedBy: viewer.adminId,
      });
    } else {
      await extendGrant(customerId, days, viewer.adminId);
    }

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "access.extend",
      entity: "Customer",
      entityId: customerId,
      diff: { days },
    });

    revalidate();
    return { ok: true, customerId };
  });
}

export async function rejectAccessAction(
  input: z.input<typeof rejectSchema>,
): Promise<ActionResult<{ customerId: string }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_APPROVE);

    const { customerId, reason } = rejectSchema.parse(input);
    await rejectRequest(customerId, reason);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "access.reject",
      entity: "Customer",
      entityId: customerId,
      diff: { reason: reason ?? null },
    });

    revalidate();
    return { ok: true, customerId };
  });
}

export async function revokeAccessAction(
  input: z.input<typeof revokeSchema>,
): Promise<ActionResult<{ customerId: string }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_APPROVE);

    const { customerId } = revokeSchema.parse(input);
    await revokeGrant(customerId);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "access.revoke",
      entity: "Customer",
      entityId: customerId,
    });

    revalidate();
    return { ok: true, customerId };
  });
}

/* ------------------------------------------------------------------ */
/* bulk transitions                                                    */
/* ------------------------------------------------------------------ */

export async function bulkApproveAccessAction(
  input: z.input<typeof bulkSchema>,
): Promise<ActionResult<{ count: number; failed: { id: string; error: string }[] }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_APPROVE);

    const { customerIds, expiry } = bulkSchema.parse(input);
    const result = await bulkApprove(customerIds, {
      expiresInDays: resolveDays(expiry),
      grantedBy: viewer.adminId,
    });

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "access.bulkApprove",
      entity: "Customer",
      entityId: customerIds[0]!,
      diff: { customerIds, days: resolveDays(expiry) },
    });

    revalidate();
    return bulkResult(result);
  });
}

export async function bulkExtendAccessAction(
  input: z.input<typeof bulkSchema>,
): Promise<ActionResult<{ count: number; failed: { id: string; error: string }[] }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_APPROVE);

    const { customerIds, expiry } = bulkSchema.parse(input);
    const days = resolveDays(expiry);
    const result =
      days === null
        ? await bulkApprove(customerIds, {
            expiresInDays: null,
            grantedBy: viewer.adminId,
          })
        : await bulkExtend(customerIds, days, viewer.adminId);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "access.bulkExtend",
      entity: "Customer",
      entityId: customerIds[0]!,
      diff: { customerIds, days },
    });

    revalidate();
    return bulkResult(result);
  });
}

export async function bulkRevokeAccessAction(
  input: z.input<typeof bulkRevokeSchema>,
): Promise<ActionResult<{ count: number; failed: { id: string; error: string }[] }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_APPROVE);

    const { customerIds } = bulkRevokeSchema.parse(input);
    const result = await bulkRevoke(customerIds);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "access.bulkRevoke",
      entity: "Customer",
      entityId: customerIds[0]!,
      diff: { customerIds },
    });

    revalidate();
    return bulkResult(result);
  });
}

export async function bulkRejectAccessAction(
  input: z.input<typeof bulkRejectSchema>,
): Promise<ActionResult<{ count: number; failed: { id: string; error: string }[] }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_APPROVE);

    const { customerIds, reason } = bulkRejectSchema.parse(input);
    const result = await bulkReject(customerIds, reason);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "access.bulkReject",
      entity: "Customer",
      entityId: customerIds[0]!,
      diff: { customerIds, reason: reason ?? null },
    });

    revalidate();
    return bulkResult(result);
  });
}


/**
 * Request-access completion for a GOOGLE-authenticated visitor (no password,
 * no captcha — the Google login already proves a human + a verified email).
 * The `g` handoff token is single-use and 15-minute; the EMAIL comes from the
 * token (never the form), the password is an unusable random value, and on
 * success the Google identity is linked and the visitor is signed in
 * immediately (price-gated until approved, same as password login). A failure
 * AFTER the consume refunds the token so fixing a field never forces a fresh
 * Google round-trip.
 */
export async function requestAccessViaGoogle(input: {
  form: {
    businessName: string;
    contactName: string;
    phone: string;
    gstNumber?: string;
    city: string;
  };
  g: string;
}): Promise<RequestAccessResult> {
  const g = typeof input.g === "string" ? input.g : "";
  const handoff = g ? await consumeSignupHandoff(g) : null;
  if (!handoff) {
    return {
      ok: false,
      error: "Your Google sign-in expired — please tap Continue with Google again.",
    };
  }

  const parsed = accessRequestSchema.safeParse({
    ...input.form,
    email: handoff.email, // ALWAYS the verified Google email
    password: randomBytes(24).toString("base64url"), // unusable; Google is the login
  });
  if (!parsed.success) {
    await refundSignupHandoff(g);
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  try {
    const ip = await clientIp();
    const result = await requestAccessService(parsed.data, "", ip, "google");
    if (!result.ok) {
      await refundSignupHandoff(g);
      return result;
    }
    await linkGoogleAccount(handoff.sub, result.customerId, handoff.email);
    // Sign the requester in right away (PENDING = price-gated, like password
    // login) so they land in their account and can watch the approval status.
    await createSession({ kind: "customer", customerId: result.customerId });
    revalidatePath("/admin/requests");
    revalidatePath("/admin/customers");
    return result;
  } catch (error) {
    await refundSignupHandoff(g);
    console.error("[actions/access] requestAccessViaGoogle failed:", error);
    return {
      ok: false,
      error: "Could not submit your request. Please try again.",
    };
  }
}

const snoozeSchema = z.object({ requestId: objectIdSchema });

/**
 * Skip a request for now (T: review later): parks it in the "Later" tab.
 * Same permission rung as approve/reject — it's a queue-management decision.
 */
export async function snoozeAccessAction(
  input: z.input<typeof snoozeSchema>,
): Promise<ActionResult<{ requestId: string }>> {
  return guarded<{ requestId: string }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_APPROVE);
    const { requestId } = snoozeSchema.parse(input);
    const res = await snoozeRequest(requestId);
    if (!res.ok) return { ok: false, error: "This request was already handled." };
    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "access.snooze",
      entity: "AccessRequest",
      entityId: requestId,
    });
    revalidate();
    return { ok: true, requestId };
  });
}

/** Move a skipped request back into the pending queue. */
export async function unsnoozeAccessAction(
  input: z.input<typeof snoozeSchema>,
): Promise<ActionResult<{ requestId: string }>> {
  return guarded<{ requestId: string }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_APPROVE);
    const { requestId } = snoozeSchema.parse(input);
    const res = await unsnoozeRequest(requestId);
    if (!res.ok) return { ok: false, error: "This request was already handled." };
    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "access.unsnooze",
      entity: "AccessRequest",
      entityId: requestId,
    });
    revalidate();
    return { ok: true, requestId };
  });
}
