import { Prisma } from "@prisma/client";
import type { AccessGrant, AccessRequest, Customer } from "@prisma/client";
import type { CustomerStatus } from "@/lib/schemas/shared";
import { hashPassword } from "@/server/auth/password";
import { prisma } from "@/server/db";
import {
  approveRequest,
  computeCustomerPriceAccess,
  extendGrant,
  revokeGrant,
} from "./access";

/**
 * Customer service layer — reads and management operations over the Customer
 * collection and its access lifecycle.
 *
 * Mutating lifecycle transitions (approve / extend / revoke) are delegated to
 * `@/server/services/access` so the price-access invariant lives in one place;
 * this module adds the admin-facing list/detail reads, manual onboarding of a
 * known buyer, notes/password management, and the bulk operations.
 *
 * Transport-agnostic: authorization, validation and audit/revalidation belong
 * to `@/server/actions/customers`.
 */

/* ----------------------------------------------------------------------- */
/* Serialized shapes                                                       */
/* ----------------------------------------------------------------------- */

/** Row shape for the CustomerSheet list. */
export interface CustomerListItem {
  id: string;
  businessName: string;
  contactName: string;
  phone: string;
  email: string | null;
  gstNumber: string | null;
  city: string | null;
  status: CustomerStatus;
  notes: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  /** Live price-access derived from status + grants (matches resolveViewer). */
  priceAccess: boolean;
  /** Expiry of the current live grant, or null when unlimited / none. */
  expiresAt: Date | null;
}

const LIST_SELECT = {
  id: true,
  businessName: true,
  contactName: true,
  phone: true,
  email: true,
  gstNumber: true,
  city: true,
  status: true,
  notes: true,
  lastLoginAt: true,
  createdAt: true,
  accessGrants: {
    where: { revokedAt: null },
    orderBy: { approvedAt: "desc" },
    select: { expiresAt: true, revokedAt: true },
  },
} satisfies Prisma.CustomerSelect;

type CustomerListRow = Prisma.CustomerGetPayload<{ select: typeof LIST_SELECT }>;

/** The live grant's expiry (null when unlimited), or null when no live grant. */
function liveExpiry(
  grants: { expiresAt: Date | null; revokedAt: Date | null }[],
  now: Date,
): { live: boolean; expiresAt: Date | null } {
  for (const grant of grants) {
    if (grant.revokedAt !== null) continue;
    if (grant.expiresAt === null || grant.expiresAt.getTime() > now.getTime()) {
      return { live: true, expiresAt: grant.expiresAt };
    }
  }
  return { live: false, expiresAt: null };
}

function toListItem(row: CustomerListRow, now: Date): CustomerListItem {
  const { live, expiresAt } = liveExpiry(row.accessGrants, now);
  return {
    id: row.id,
    businessName: row.businessName,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email ?? null,
    gstNumber: row.gstNumber ?? null,
    city: row.city ?? null,
    status: row.status,
    notes: row.notes ?? null,
    lastLoginAt: row.lastLoginAt ?? null,
    createdAt: row.createdAt,
    priceAccess: row.status === "APPROVED" && live,
    expiresAt,
  };
}

/* ----------------------------------------------------------------------- */
/* List                                                                    */
/* ----------------------------------------------------------------------- */

export interface ListCustomersFilter {
  /** Restrict to a single status. */
  status?: CustomerStatus;
  /** Case-insensitive match against businessName / contactName / phone. */
  search?: string;
  /** Max rows to return (defaults to no limit). */
  take?: number;
  /** Rows to skip (simple offset pagination). */
  skip?: number;
}

/**
 * List customers for the admin CustomerSheet, newest first. Filters by status
 * and a free-text search over business name, contact name and phone.
 */
export async function listCustomers(
  filter: ListCustomersFilter = {},
): Promise<CustomerListItem[]> {
  const where: Prisma.CustomerWhereInput = {};
  if (filter.status) {
    where.status = filter.status;
  }
  const search = filter.search?.trim();
  if (search) {
    where.OR = [
      { businessName: { contains: search, mode: "insensitive" } },
      { contactName: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.customer.findMany({
    where,
    select: LIST_SELECT,
    orderBy: { createdAt: "desc" },
    take: filter.take,
    skip: filter.skip,
  });

  const now = new Date();
  return rows.map((row) => toListItem(row, now));
}

/** Count customers matching the same filter (for pagination). */
export async function countCustomers(
  filter: Pick<ListCustomersFilter, "status" | "search"> = {},
): Promise<number> {
  const where: Prisma.CustomerWhereInput = {};
  if (filter.status) {
    where.status = filter.status;
  }
  const search = filter.search?.trim();
  if (search) {
    where.OR = [
      { businessName: { contains: search, mode: "insensitive" } },
      { contactName: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
    ];
  }
  return prisma.customer.count({ where });
}

/** Aggregate customer counts per status (for the requests/customers header). */
export async function customerStatusCounts(): Promise<
  Record<CustomerStatus, number>
> {
  const grouped = await prisma.customer.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const counts: Record<CustomerStatus, number> = {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
    EXPIRED: 0,
    BLOCKED: 0,
  };
  for (const group of grouped) {
    counts[group.status] = group._count._all;
  }
  return counts;
}

/* ----------------------------------------------------------------------- */
/* Detail                                                                  */
/* ----------------------------------------------------------------------- */

export interface CustomerDetail {
  id: string;
  businessName: string;
  contactName: string;
  phone: string;
  email: string | null;
  gstNumber: string | null;
  city: string | null;
  status: CustomerStatus;
  notes: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  priceAccess: boolean;
  grants: AccessGrant[];
  requests: AccessRequest[];
  /** Recent audit entries touching this customer (activity feed). */
  activity: {
    id: string;
    actorType: string;
    actorId: string;
    action: string;
    createdAt: Date;
  }[];
}

/**
 * Full customer detail for the drawer: profile + all grants (newest first) +
 * all requests (newest first) + a recent activity feed drawn from the audit
 * log. `priceAccess` is computed the same way `resolveViewer` computes it.
 */
export async function getCustomer(id: string): Promise<CustomerDetail | null> {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      accessGrants: { orderBy: { approvedAt: "desc" } },
      requests: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!customer) return null;

  const [priceAccess, activity] = await Promise.all([
    computeCustomerPriceAccess(id),
    prisma.auditLog.findMany({
      where: { entity: "Customer", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        actorType: true,
        actorId: true,
        action: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    id: customer.id,
    businessName: customer.businessName,
    contactName: customer.contactName,
    phone: customer.phone,
    email: customer.email ?? null,
    gstNumber: customer.gstNumber ?? null,
    city: customer.city ?? null,
    status: customer.status,
    notes: customer.notes ?? null,
    lastLoginAt: customer.lastLoginAt ?? null,
    createdAt: customer.createdAt,
    priceAccess,
    grants: customer.accessGrants,
    requests: customer.requests,
    activity,
  };
}

/* ----------------------------------------------------------------------- */
/* Manual onboarding of a known buyer                                      */
/* ----------------------------------------------------------------------- */

export interface AddCustomerData {
  businessName: string;
  contactName: string;
  /** Canonical +91XXXXXXXXXX (validated/normalized by the caller). */
  phone: string;
  /** Plaintext; hashed here. */
  password: string;
  email?: string | null;
  gstNumber?: string | null;
  city?: string | null;
  /**
   * Validity of the auto-created grant, in days, or null for unlimited.
   * Defaults to null (unlimited) when omitted — the caller normally passes a
   * preset.
   */
  expiresInDays?: number | null;
  /** Admin id, recorded on the grant + used for the APPROVED transition. */
  grantedBy: string;
}

export interface AddCustomerResult {
  customer: Customer;
  grant: AccessGrant;
}

/**
 * Manually onboard a known buyer straight into the APPROVED state (F-A: "add
 * customer manually"). Creates the Customer, an already-APPROVED AccessRequest
 * (so the audit/history reads consistently), then approves them via the access
 * service to mint a grant and flip status. `priceAccess` is true afterwards.
 *
 * Rejects if the phone is already registered (phone is `@unique`).
 */
export async function addCustomerManually(
  data: AddCustomerData,
): Promise<AddCustomerResult> {
  const existing = await prisma.customer.findUnique({
    where: { phone: data.phone },
    select: { id: true },
  });
  if (existing) {
    throw new Error("A customer with this phone number already exists.");
  }

  const passwordHash = await hashPassword(data.password);
  const customer = await prisma.customer.create({
    data: {
      businessName: data.businessName,
      contactName: data.contactName,
      phone: data.phone,
      passwordHash,
      email: data.email ?? null,
      gstNumber: data.gstNumber ?? null,
      city: data.city ?? null,
      status: "PENDING",
      requests: { create: { status: "PENDING" } },
    },
    select: { id: true },
  });

  const { customer: approved, grant } = await approveRequest(customer.id, {
    expiresInDays: data.expiresInDays ?? null,
    grantedBy: data.grantedBy,
  });

  return {
    customer: approved,
    grant: grant as unknown as AccessGrant,
  };
}

/* ----------------------------------------------------------------------- */
/* Notes / password                                                        */
/* ----------------------------------------------------------------------- */

/** Set (or clear, with null) the admin notes on a customer. */
export async function updateCustomerNotes(
  id: string,
  notes: string | null,
): Promise<Customer> {
  return prisma.customer.update({
    where: { id },
    data: { notes: notes && notes.trim() !== "" ? notes.trim() : null },
  });
}

/**
 * Reset a customer's password (admin-initiated). Hashes the new plaintext and
 * revokes nothing — the customer's existing sessions keep working until they
 * expire, but the next login uses the new password.
 */
export async function resetCustomerPassword(
  id: string,
  newPassword: string,
): Promise<Customer> {
  const passwordHash = await hashPassword(newPassword);
  return prisma.customer.update({
    where: { id },
    data: { passwordHash },
  });
}

/* ----------------------------------------------------------------------- */
/* Bulk operations                                                         */
/* ----------------------------------------------------------------------- */

export interface BulkResult {
  /** Ids successfully processed. */
  succeeded: string[];
  /** Ids that failed, with the reason. */
  failed: { id: string; error: string }[];
}

async function runBulk(
  ids: string[],
  op: (id: string) => Promise<unknown>,
): Promise<BulkResult> {
  const unique = [...new Set(ids)];
  const result: BulkResult = { succeeded: [], failed: [] };
  for (const id of unique) {
    try {
      await op(id);
      result.succeeded.push(id);
    } catch (error) {
      result.failed.push({
        id,
        error: error instanceof Error ? error.message : "Operation failed.",
      });
    }
  }
  return result;
}

/** Approve many pending customers with one validity, minting a grant each. */
export async function bulkApprove(
  ids: string[],
  options: { expiresInDays?: number | null; grantedBy: string },
): Promise<BulkResult> {
  return runBulk(ids, (id) =>
    approveRequest(id, {
      expiresInDays: options.expiresInDays ?? null,
      grantedBy: options.grantedBy,
    }),
  );
}

/** Extend/renew many customers' access by the same number of days. */
export async function bulkExtend(
  ids: string[],
  days: number,
  grantedBy: string,
): Promise<BulkResult> {
  return runBulk(ids, (id) => extendGrant(id, days, grantedBy));
}

/** Revoke access for many customers (revokes grants + sessions, EXPIRED). */
export async function bulkRevoke(ids: string[]): Promise<BulkResult> {
  return runBulk(ids, (id) => revokeGrant(id));
}
