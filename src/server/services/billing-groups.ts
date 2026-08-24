import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { bucketizeLines } from "@/lib/billing-groups/engine";
import type {
  BillingGroupConfig,
  BucketableLine,
  BucketedCart,
} from "@/lib/billing-groups/types";
import {
  billingGroupMatcherSchema,
  billingGroupRuleSchema,
  type BillingGroupInput,
} from "@/lib/schemas/billing-group";

/**
 * Billing groups — persistence + the one place the rest of the server asks
 * "how does this cart bucket?".
 *
 * Layering (the tax-profile convention): intrinsic data validation lives here
 * (typed errors); authz, audit and revalidation live in the action.
 *
 * READ-FRESHNESS: `listActiveBillingGroupConfigs` reads the rows DIRECTLY on
 * every call — no React `cache()`, no TTL. Cart preview and order placement
 * must always see the rules as of *now* (the owner flips these on production),
 * and a stale cache could charge a discount the admin just switched off. The
 * read is one small indexed query per cart render; cheap.
 */

/* ------------------------------------------------------------------ */
/* Types / errors                                                      */
/* ------------------------------------------------------------------ */

export interface BillingGroupRecord extends BillingGroupConfig {
  createdAt: Date;
  updatedAt: Date;
}

export class BillingGroupCodeTakenError extends Error {
  constructor(code: string) {
    super(`The code "${code}" is already used by another billing group.`);
    this.name = "BillingGroupCodeTakenError";
  }
}

export class BillingGroupNotFoundError extends Error {
  constructor() {
    super("Billing group not found.");
    this.name = "BillingGroupNotFoundError";
  }
}

/* ------------------------------------------------------------------ */
/* Row ↔ config                                                        */
/* ------------------------------------------------------------------ */

const SELECT = {
  id: true,
  name: true,
  code: true,
  color: true,
  active: true,
  sortOrder: true,
  matcher: true,
  rules: true,
  separateBill: true,
  couponStacking: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BillingGroupSelect;

type Row = Prisma.BillingGroupGetPayload<{ select: typeof SELECT }>;

/**
 * Parse a row's JSON columns defensively. A malformed row (hand-edited, or a
 * future `kind` this build doesn't know) is returned INACTIVE rather than
 * thrown — a bad config row must never take the cart down.
 */
function rowToRecord(row: Row): BillingGroupRecord {
  const matcher = billingGroupMatcherSchema.safeParse(row.matcher);
  const rules = billingGroupRuleSchema.array().safeParse(row.rules);
  const valid = matcher.success && rules.success;
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    color: row.color,
    active: row.active && valid,
    sortOrder: row.sortOrder,
    matcher: matcher.success ? matcher.data : { kind: "brands", brandIds: [] },
    rules: rules.success ? rules.data : [],
    separateBill: row.separateBill,
    couponStacking: row.couponStacking,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toData(input: BillingGroupInput) {
  return {
    name: input.name,
    code: input.code,
    color: input.color,
    active: input.active,
    sortOrder: input.sortOrder,
    matcher: input.matcher as unknown as Prisma.InputJsonValue,
    rules: input.rules as unknown as Prisma.InputJsonValue,
    separateBill: input.separateBill,
    couponStacking: input.couponStacking,
    notes: input.notes,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Every group (admin list), in display order. */
export async function listBillingGroups(): Promise<BillingGroupRecord[]> {
  const rows = await prisma.billingGroup.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: SELECT,
  });
  return rows.map(rowToRecord);
}

export async function getBillingGroup(id: string): Promise<BillingGroupRecord | null> {
  const row = await prisma.billingGroup.findUnique({ where: { id }, select: SELECT });
  return row ? rowToRecord(row) : null;
}

/** ACTIVE, well-formed configs — the engine input. Always a fresh read. */
export async function listActiveBillingGroupConfigs(): Promise<BillingGroupConfig[]> {
  const rows = await prisma.billingGroup.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: SELECT,
  });
  return rows.map(rowToRecord).filter((g) => g.active);
}

/**
 * Bucket a set of priced lines under the CURRENT rules. The single entry point
 * for cart preview and placement, so both always agree.
 */
export async function bucketizeCartLines(lines: BucketableLine[]): Promise<BucketedCart> {
  if (lines.length === 0) return bucketizeLines([], []);
  const groups = await listActiveBillingGroupConfigs();
  return bucketizeLines(lines, groups);
}

/**
 * Impact signal for the admin form: how many customers currently have a cart
 * line from any of these brands (what a rule change would touch right now).
 */
export async function countLiveCartsForBrands(brandIds: string[]): Promise<number> {
  if (brandIds.length === 0) return 0;
  const rows = await prisma.cartItem.findMany({
    where: { product: { brandId: { in: brandIds } } },
    select: { customerId: true },
    distinct: ["customerId"],
  });
  return rows.length;
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function createBillingGroup(input: BillingGroupInput): Promise<BillingGroupRecord> {
  try {
    const row = await prisma.billingGroup.create({ data: toData(input), select: SELECT });
    return rowToRecord(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new BillingGroupCodeTakenError(input.code);
    throw error;
  }
}

export async function updateBillingGroup(
  id: string,
  input: BillingGroupInput,
): Promise<BillingGroupRecord> {
  try {
    const row = await prisma.billingGroup.update({
      where: { id },
      data: toData(input),
      select: SELECT,
    });
    return rowToRecord(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new BillingGroupCodeTakenError(input.code);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new BillingGroupNotFoundError();
    }
    throw error;
  }
}

/** The per-group kill switch. */
export async function setBillingGroupActive(
  id: string,
  active: boolean,
): Promise<BillingGroupRecord> {
  try {
    const row = await prisma.billingGroup.update({
      where: { id },
      data: { active },
      select: SELECT,
    });
    return rowToRecord(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new BillingGroupNotFoundError();
    }
    throw error;
  }
}

/**
 * Delete a group. Safe: placed orders carry their own frozen snapshot, and
 * live carts simply re-bucket on their next render (lines fall to General).
 */
export async function deleteBillingGroup(id: string): Promise<void> {
  try {
    await prisma.billingGroup.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new BillingGroupNotFoundError();
    }
    throw error;
  }
}
