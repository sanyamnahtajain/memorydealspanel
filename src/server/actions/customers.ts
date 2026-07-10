"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import {
  addCustomerManually,
  getCustomer,
  listCustomers,
  countCustomers,
  updateCustomerNotes,
  resetCustomerPassword,
  type CustomerDetail,
  type CustomerListItem,
} from "@/server/services/customers";
import { blockCustomer, unblockCustomer } from "@/server/services/access";
import { revokeAllForCustomer } from "@/server/auth/session";
import {
  customerStatusSchema,
  objectIdSchema,
  emptyStringAsUndefined,
  type CustomerStatus,
} from "@/lib/schemas/shared";
import { gstinSchema, indianPhoneSchema } from "@/lib/schemas/customer";
import {
  DEFAULT_ACCESS_EXPIRY_DAYS,
  PAGE_SIZES,
} from "@/lib/constants";

/**
 * Customer profile server actions — the editable side of a customer record
 * (business/contact fields, private notes, status, password). Access-grant
 * lifecycle (approve / extend / revoke) lives in `@/server/actions/access`.
 *
 * Thin transport wrappers over `@/server/services/customers` +
 * `@/server/services/access`: assertAdmin → zod → service → audit → revalidate.
 * Never throws to the client.
 */

export type ActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const ACTOR = "admin" as const;

/* ------------------------------------------------------------------ */
/* client DTOs (JSON-serializable — Dates → ISO strings)               */
/* ------------------------------------------------------------------ */

/** One customer row for the CustomerSheet grid. */
export interface CustomerRow {
  id: string;
  businessName: string;
  contactName: string;
  phone: string;
  status: CustomerStatus;
  city: string | null;
  gstNumber: string | null;
  email: string | null;
  notes: string | null;
  /** Current live grant's expiry (ISO) — null = forever OR no live grant. */
  expiresAt: string | null;
  hasActiveGrant: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface GrantHistoryItem {
  id: string;
  approvedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  grantedBy: string;
}

export interface RequestHistoryItem {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface ActivityItem {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  createdAt: string;
}

/** Full profile payload for the drawer. */
export interface CustomerProfile extends CustomerRow {
  priceAccess: boolean;
  grants: GrantHistoryItem[];
  requests: RequestHistoryItem[];
  activity: ActivityItem[];
}

/* ------------------------------------------------------------------ */
/* mappers (service shape → client DTO)                                */
/* ------------------------------------------------------------------ */

function toRow(item: CustomerListItem): CustomerRow {
  return {
    id: item.id,
    businessName: item.businessName,
    contactName: item.contactName,
    phone: item.phone,
    status: item.status,
    city: item.city,
    gstNumber: item.gstNumber,
    email: item.email,
    notes: item.notes,
    expiresAt: item.expiresAt?.toISOString() ?? null,
    hasActiveGrant: item.priceAccess,
    lastLoginAt: item.lastLoginAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
  };
}

function toProfile(detail: CustomerDetail): CustomerProfile {
  const now = new Date();
  const live = detail.grants.find(
    (g) => g.revokedAt === null && (g.expiresAt === null || g.expiresAt > now),
  );
  return {
    id: detail.id,
    businessName: detail.businessName,
    contactName: detail.contactName,
    phone: detail.phone,
    status: detail.status,
    city: detail.city,
    gstNumber: detail.gstNumber,
    email: detail.email,
    notes: detail.notes,
    expiresAt: live ? (live.expiresAt?.toISOString() ?? null) : null,
    hasActiveGrant: Boolean(live),
    lastLoginAt: detail.lastLoginAt?.toISOString() ?? null,
    createdAt: detail.createdAt.toISOString(),
    priceAccess: detail.priceAccess,
    grants: detail.grants.map((g) => ({
      id: g.id,
      approvedAt: g.approvedAt.toISOString(),
      expiresAt: g.expiresAt?.toISOString() ?? null,
      revokedAt: g.revokedAt?.toISOString() ?? null,
      grantedBy: g.grantedBy,
    })),
    requests: detail.requests.map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    })),
    activity: detail.activity.map((a) => ({
      id: a.id,
      actorType: a.actorType,
      actorId: a.actorId,
      action: a.action,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* input schemas                                                       */
/* ------------------------------------------------------------------ */

/** Grid/profile field patch. Phone is read-only (unique login identity). */
export const updateCustomerSchema = z
  .object({
    businessName: z.string().trim().min(2).max(120).optional(),
    contactName: z.string().trim().min(2).max(80).optional(),
    city: z
      .union([z.string().trim().min(2).max(80), z.literal("")])
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    gstNumber: z
      .union([gstinSchema, z.literal("")])
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    email: z
      .union([z.email(), z.literal("")])
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "No field to save.",
  });
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

const notesSchema = z.object({
  customerId: objectIdSchema,
  notes: z.string().trim().max(2000).nullable(),
});

/**
 * Manual add of a known buyer (F-A: admin onboards a customer directly into the
 * APPROVED state). Mirrors the public access-request fields but the admin also
 * chooses the grant validity: a preset (7/30/90) or an explicit day count, or
 * `null` for a never-expiring grant. Absent ⇒ the default preset (30 days).
 */
export const addCustomerSchema = z.object({
  businessName: z.string().trim().min(2, "Business name is too short").max(120),
  contactName: z.string().trim().min(2, "Contact name is too short").max(80),
  phone: indianPhoneSchema,
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
  gstNumber: emptyStringAsUndefined(gstinSchema),
  email: emptyStringAsUndefined(z.email("Enter a valid email address")),
  city: emptyStringAsUndefined(z.string().trim().min(2).max(80)),
  expiresInDays: z
    .union([z.literal(null), z.number().int().positive().max(3650)])
    .optional(),
});
export type AddCustomerInput = z.input<typeof addCustomerSchema>;

const resetPasswordSchema = z.object({
  customerId: objectIdSchema,
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

const listSchema = z
  .object({
    status: customerStatusSchema.optional(),
    search: z.string().trim().max(120).optional(),
    page: z.number().int().positive().default(1),
    take: z
      .number()
      .int()
      .positive()
      .max(PAGE_SIZES.max)
      .default(PAGE_SIZES.admin),
  })
  .prefault({});
export type ListCustomersInput = z.input<typeof listSchema>;

export interface ListCustomersResult {
  customers: CustomerRow[];
  total: number;
  page: number;
  pageCount: number;
}

/* ------------------------------------------------------------------ */
/* guard wrapper + revalidate                                          */
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
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P2002"
    ) {
      return { ok: false, error: "That value is already in use." };
    }
    console.error("[actions/customers] unexpected error:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

function revalidate(): void {
  revalidatePath("/admin/customers");
  revalidatePath("/admin/dashboard");
}

/* ------------------------------------------------------------------ */
/* list                                                                */
/* ------------------------------------------------------------------ */

export async function listCustomersAction(
  input: ListCustomersInput = {},
): Promise<ActionResult<ListCustomersResult>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_VIEW);

    const params = listSchema.parse(input);
    const take = params.take;
    const skip = (params.page - 1) * take;

    const [items, total] = await Promise.all([
      listCustomers({
        status: params.status,
        search: params.search,
        take,
        skip,
      }),
      countCustomers({ status: params.status, search: params.search }),
    ]);

    return {
      ok: true,
      customers: items.map(toRow),
      total,
      page: params.page,
      pageCount: Math.max(1, Math.ceil(total / take)),
    };
  });
}

/* ------------------------------------------------------------------ */
/* profile (drawer)                                                    */
/* ------------------------------------------------------------------ */

export async function getCustomerProfileAction(
  id: string,
): Promise<ActionResult<{ profile: CustomerProfile }>> {
  return guarded<{ profile: CustomerProfile }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_VIEW);

    const customerId = objectIdSchema.parse(id);
    const detail = await getCustomer(customerId);
    if (!detail) {
      return { ok: false, error: "Customer not found." };
    }
    return { ok: true, profile: toProfile(detail) };
  });
}

/* ------------------------------------------------------------------ */
/* update (grid autosave + profile field edits)                        */
/* ------------------------------------------------------------------ */

export async function updateCustomerAction(
  id: string,
  patch: UpdateCustomerInput,
): Promise<ActionResult<{ customer: CustomerRow }>> {
  return guarded<{ customer: CustomerRow }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_EDIT);

    const customerId = objectIdSchema.parse(id);
    const data = updateCustomerSchema.parse(patch);

    await prisma.customer.update({ where: { id: customerId }, data });

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "customer.update",
      entity: "Customer",
      entityId: customerId,
      diff: { changed: Object.keys(data) },
    });

    // Re-read through the service so the row carries live grant/expiry state.
    const detail = await getCustomer(customerId);
    if (!detail) return { ok: false, error: "Customer not found." };

    revalidate();
    // toProfile already resolves the live grant's expiry; reuse it for the row.
    const profile = toProfile(detail);
    const { priceAccess: _p, grants: _g, requests: _r, activity: _a, ...row } =
      profile;
    return { ok: true, customer: row };
  });
}

/* ------------------------------------------------------------------ */
/* private notes                                                       */
/* ------------------------------------------------------------------ */

export async function updateCustomerNotesAction(
  input: z.input<typeof notesSchema>,
): Promise<ActionResult<{ customerId: string }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_EDIT);

    const { customerId, notes } = notesSchema.parse(input);
    await updateCustomerNotes(customerId, notes);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "customer.notes",
      entity: "Customer",
      entityId: customerId,
    });

    revalidate();
    return { ok: true, customerId };
  });
}

/* ------------------------------------------------------------------ */
/* manual add (onboard a known buyer straight into APPROVED)           */
/* ------------------------------------------------------------------ */

/**
 * Onboard a known buyer directly into the APPROVED state with a live grant
 * (F-A "add customer manually"). Delegates to the customers service, which
 * hashes the password, creates the customer + an APPROVED request, and mints
 * the grant so `priceAccess` is immediately true. Absent validity ⇒ the
 * default preset (30 days).
 */
export async function addCustomerManuallyAction(
  input: AddCustomerInput,
): Promise<ActionResult<{ customerId: string }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_EDIT);

    const data = addCustomerSchema.parse(input);
    const expiresInDays =
      data.expiresInDays === undefined
        ? DEFAULT_ACCESS_EXPIRY_DAYS
        : data.expiresInDays;

    const { customer, grant } = await addCustomerManually({
      businessName: data.businessName,
      contactName: data.contactName,
      phone: data.phone,
      password: data.password,
      gstNumber: data.gstNumber,
      email: data.email,
      city: data.city,
      expiresInDays,
      grantedBy: viewer.adminId,
    });

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "customer.addManual",
      entity: "Customer",
      entityId: customer.id,
      diff: { grantId: grant.id, expiresAt: grant.expiresAt, expiresInDays },
    });

    revalidate();
    revalidatePath("/admin/requests");
    return { ok: true, customerId: customer.id };
  });
}

/* ------------------------------------------------------------------ */
/* status change (block / unblock / manual grid select)                */
/* ------------------------------------------------------------------ */

/**
 * Set a customer's status from the grid's status `select` or the profile
 * "block" action. BLOCKED routes through the access service (revokes grants +
 * sessions); leaving BLOCKED routes through `unblockCustomer` (→ REJECTED, a
 * neutral non-approved state). Approving/extending must go through the access
 * actions so a grant is minted — this action never auto-grants price access.
 */
export async function setCustomerStatusAction(
  id: string,
  status: unknown,
): Promise<ActionResult<{ customerId: string; status: CustomerStatus }>> {
  return guarded<{ customerId: string; status: CustomerStatus }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_BLOCK);

    const customerId = objectIdSchema.parse(id);
    const nextStatus = customerStatusSchema.parse(status);

    const current = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { status: true },
    });
    if (!current) return { ok: false, error: "Customer not found." };

    if (nextStatus === "BLOCKED") {
      await blockCustomer(customerId);
    } else if (current.status === "BLOCKED") {
      // Leaving BLOCKED: normalize via the service, then apply the target if it
      // isn't APPROVED (APPROVED requires a real grant — reject that here).
      if (nextStatus === "APPROVED") {
        return {
          ok: false,
          error: "Approve grants access — use Approve, not the status field.",
        };
      }
      await unblockCustomer(customerId);
      if (nextStatus !== "REJECTED") {
        await prisma.customer.update({
          where: { id: customerId },
          data: { status: nextStatus },
        });
      }
    } else {
      if (nextStatus === "APPROVED") {
        return {
          ok: false,
          error: "Approve grants access — use Approve, not the status field.",
        };
      }
      // Moving to REJECTED / EXPIRED cuts live access.
      if (nextStatus === "REJECTED" || nextStatus === "EXPIRED") {
        await prisma.accessGrant.updateMany({
          where: { customerId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await revokeAllForCustomer(customerId);
      }
      await prisma.customer.update({
        where: { id: customerId },
        data: { status: nextStatus },
      });
    }

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "customer.status",
      entity: "Customer",
      entityId: customerId,
      diff: { status: nextStatus },
    });

    revalidate();
    return { ok: true, customerId, status: nextStatus };
  });
}

/* ------------------------------------------------------------------ */
/* reset password                                                      */
/* ------------------------------------------------------------------ */

export async function resetCustomerPasswordAction(
  input: z.input<typeof resetPasswordSchema>,
): Promise<ActionResult<{ customerId: string }>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_EDIT);

    const { customerId, password } = resetPasswordSchema.parse(input);
    await resetCustomerPassword(customerId, password);
    // Force re-login everywhere with the new credentials.
    await revokeAllForCustomer(customerId);

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "customer.resetPassword",
      entity: "Customer",
      entityId: customerId,
    });

    revalidate();
    return { ok: true, customerId };
  });
}
