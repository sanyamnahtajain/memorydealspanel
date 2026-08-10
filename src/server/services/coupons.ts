import { Prisma, type CouponKind } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";

/**
 * Coupon service — ported from the tradeOS design. Codes are stored UPPERCASE
 * and globally unique. Admin CRUD here does NOT gate permissions — the calling
 * action layer does (the same split as the other admin write services). The
 * money-critical paths are previewCoupon (pure read for the cart UI) and
 * redeemCoupon (called by placeOrder), whose discount arithmetic is
 * integer-exact paise.
 */

/** Why a coupon did not apply — mapped to friendly copy in the UI. */
export type CouponFailReason =
  | "NOT_FOUND"
  | "INACTIVE"
  | "NOT_STARTED"
  | "EXPIRED"
  | "MIN_ORDER"
  | "EXHAUSTED"
  | "PER_CUSTOMER_LIMIT"
  | "NOT_APPLICABLE";

/** Normalized coupon code: trimmed, UPPERCASE, 3-24 of A-Z 0-9 hyphen. */
export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,24}$/, "Code must be 3-24 characters (A-Z, 0-9, -).");

const couponCoreSchema = z.object({
  code: couponCodeSchema,
  kind: z.enum(["PERCENT", "FIXED"]),
  // PERCENT: basis points off the subtotal (500 = 5%).
  valueBps: z.number().int().min(1).max(10000).nullish(),
  // FIXED: integer paise off the subtotal.
  amountPaise: z.number().int().min(1).nullish(),
  minOrderPaise: z.number().int().min(0).default(0),
  startsAt: z.date().nullish(),
  expiresAt: z.date().nullish(),
  maxRedemptions: z.number().int().min(1).nullish(),
  perCustomerLimit: z.number().int().min(1).nullish(),
  // Product scoping: empty/absent = the whole cart.
  productIds: z.array(z.string().regex(/^[0-9a-f]{24}$/)).max(200).optional(),
  active: z.boolean().default(true),
});

/** Exactly ONE of valueBps/amountPaise, matching the kind. */
function refineKindValue(
  v: { kind: CouponKind; valueBps?: number | null; amountPaise?: number | null },
  ctx: z.RefinementCtx,
): void {
  if (v.kind === "PERCENT" && (v.valueBps == null || v.amountPaise != null)) {
    ctx.addIssue({ code: "custom", message: "Percent coupons take a percent value only." });
  }
  if (v.kind === "FIXED" && (v.amountPaise == null || v.valueBps != null)) {
    ctx.addIssue({ code: "custom", message: "Flat coupons take a rupee amount only." });
  }
}

export const createCouponSchema = couponCoreSchema.superRefine(refineKindValue);
export type CreateCouponInput = z.input<typeof createCouponSchema>;

/**
 * Partial update. `code` is intentionally NOT patchable — a live code is the
 * identity customers typed/shared; retire the coupon and mint a new code
 * instead. When kind/value fields appear they must arrive as a consistent pair.
 */
export const updateCouponSchema = couponCoreSchema
  .omit({ code: true })
  .partial()
  .superRefine((v, ctx) => {
    if (v.kind !== undefined || v.valueBps !== undefined || v.amountPaise !== undefined) {
      if (v.kind === undefined) {
        ctx.addIssue({ code: "custom", message: "Changing the value requires the kind." });
        return;
      }
      refineKindValue({ kind: v.kind, valueBps: v.valueBps, amountPaise: v.amountPaise }, ctx);
    }
  });
export type UpdateCouponInput = z.input<typeof updateCouponSchema>;

const COUPON_SELECT = {
  id: true,
  code: true,
  kind: true,
  valueBps: true,
  amountPaise: true,
  minOrderPaise: true,
  startsAt: true,
  expiresAt: true,
  maxRedemptions: true,
  redemptionCount: true,
  perCustomerLimit: true,
  productIds: true,
  active: true,
  deletedAt: true,
  createdAt: true,
} satisfies Prisma.CouponSelect;

export type CouponDTO = Prisma.CouponGetPayload<{ select: typeof COUPON_SELECT }>;

export type CouponWriteResult =
  | { ok: true; coupon: CouponDTO }
  | { ok: false; error: "INVALID_INPUT" | "CODE_TAKEN" | "NOT_FOUND"; message?: string };

function isP2002(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Create a coupon (code globally unique — a duplicate is CODE_TAKEN). */
export async function createCoupon(input: CreateCouponInput): Promise<CouponWriteResult> {
  const parsed = createCouponSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "INVALID_INPUT",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const v = parsed.data;
  try {
    const coupon = await prisma.coupon.create({
      // EXPLICIT nulls — on Mongo an absent field ≠ null and every filter
      // below matches on null.
      data: {
        code: v.code,
        kind: v.kind,
        valueBps: v.kind === "PERCENT" ? (v.valueBps ?? null) : null,
        amountPaise: v.kind === "FIXED" ? (v.amountPaise ?? null) : null,
        minOrderPaise: v.minOrderPaise,
        startsAt: v.startsAt ?? null,
        expiresAt: v.expiresAt ?? null,
        maxRedemptions: v.maxRedemptions ?? null,
        perCustomerLimit: v.perCustomerLimit ?? null,
        productIds: v.productIds ?? [],
        active: v.active,
        deletedAt: null,
      },
      select: COUPON_SELECT,
    });
    return { ok: true, coupon };
  } catch (err) {
    if (isP2002(err)) return { ok: false, error: "CODE_TAKEN" };
    throw err;
  }
}

/** Patch a coupon's tunables (never the code). */
export async function updateCoupon(
  id: string,
  patch: UpdateCouponInput,
): Promise<CouponWriteResult> {
  const parsed = updateCouponSchema.safeParse(patch);
  if (!parsed.success) {
    return {
      ok: false,
      error: "INVALID_INPUT",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const v = parsed.data;

  const data: Prisma.CouponUncheckedUpdateInput = {};
  if (v.kind !== undefined) {
    data.kind = v.kind;
    data.valueBps = v.kind === "PERCENT" ? (v.valueBps ?? null) : null;
    data.amountPaise = v.kind === "FIXED" ? (v.amountPaise ?? null) : null;
  }
  if (v.minOrderPaise !== undefined) data.minOrderPaise = v.minOrderPaise;
  if (v.startsAt !== undefined) data.startsAt = v.startsAt ?? null;
  if (v.expiresAt !== undefined) data.expiresAt = v.expiresAt ?? null;
  if (v.maxRedemptions !== undefined) data.maxRedemptions = v.maxRedemptions ?? null;
  if (v.perCustomerLimit !== undefined) data.perCustomerLimit = v.perCustomerLimit ?? null;
  if (v.productIds !== undefined) data.productIds = v.productIds;
  if (v.active !== undefined) data.active = v.active;

  const existing = await prisma.coupon.findFirst({ where: { id }, select: { id: true } });
  if (!existing) return { ok: false, error: "NOT_FOUND" };
  const coupon = await prisma.coupon.update({
    where: { id: existing.id },
    data,
    select: COUPON_SELECT,
  });
  return { ok: true, coupon };
}

/** Soft-delete a coupon (sets deletedAt; redemption + listing exclude it). */
export async function softDeleteCoupon(
  id: string,
): Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" }> {
  const res = await prisma.coupon.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), active: false },
  });
  if (res.count === 0) return { ok: false, error: "NOT_FOUND" };
  return { ok: true };
}

/** Hard cap on any coupon list read. */
const MAX_TAKE = 100;

/** Live (non-deleted) coupons, newest first. */
export async function listCoupons(opts: { skip?: number; take?: number } = {}): Promise<CouponDTO[]> {
  return prisma.coupon.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    skip: Math.max(0, opts.skip ?? 0),
    take: Math.min(MAX_TAKE, Math.max(1, opts.take ?? 50)),
    select: COUPON_SELECT,
  });
}

/* ── Redemption math (integer-exact) ───────────────────────────────────── */

/** A cart line as the coupon engine sees it — id + priced total only. */
export interface CouponCartLine {
  productId: string;
  lineTotalPaise: number;
}

/**
 * The subtotal a coupon may discount: the WHOLE cart when the coupon is
 * unscoped, else only the lines whose product is in the coupon's list (e.g.
 * "AMBRANE10" on six specific products — 20 cart lines, 6 eligible).
 */
export function eligibleSubtotalPaise(
  coupon: { productIds: string[] },
  lines: readonly CouponCartLine[],
): number {
  if (coupon.productIds.length === 0) {
    return lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
  }
  const scope = new Set(coupon.productIds);
  return lines.reduce(
    (sum, l) => (scope.has(l.productId) ? sum + l.lineTotalPaise : sum),
    0,
  );
}

/**
 * The discount a coupon takes off its eligible subtotal, capped there (an
 * order can never go negative): PERCENT → floor(eligible × bps / 10000);
 * FIXED → the flat amount.
 */
function computeDiscountPaise(
  coupon: { kind: CouponKind; valueBps: number | null; amountPaise: number | null },
  eligiblePaise: number,
): number {
  const raw =
    coupon.kind === "PERCENT"
      ? Math.floor((eligiblePaise * (coupon.valueBps ?? 0)) / 10000)
      : (coupon.amountPaise ?? 0);
  return Math.min(eligiblePaise, raw);
}

/** Static eligibility checks shared by preview + redeem (no exhaustion claim). */
function checkCoupon(
  row: CouponDTO,
  eligiblePaise: number,
  now: Date,
): CouponFailReason | null {
  if (!row.active) return "INACTIVE";
  if (row.startsAt && now < row.startsAt) return "NOT_STARTED";
  if (row.expiresAt && now >= row.expiresAt) return "EXPIRED";
  // A scoped coupon with nothing eligible in the cart is its own message —
  // clearer than a generic minimum failure.
  if (row.productIds.length > 0 && eligiblePaise === 0) return "NOT_APPLICABLE";
  // The minimum applies to the ELIGIBLE subtotal (a scoped code's floor is
  // about the products it covers, not the rest of the cart).
  if (eligiblePaise < row.minOrderPaise) return "MIN_ORDER";
  if (row.maxRedemptions != null && row.redemptionCount >= row.maxRedemptions) {
    return "EXHAUSTED";
  }
  return null;
}

export type CouponQuoteResult =
  | {
      ok: true;
      code: string;
      discountPaise: number;
      /** Product ids the coupon is scoped to (empty = whole cart). */
      scopeProductIds: string[];
    }
  | { ok: false; reason: CouponFailReason };

/**
 * PURE READ for the cart UI: would this code apply to this subtotal, and for
 * how much? Never mutates anything — the atomic claim happens only in
 * {@link redeemCoupon} at placement, so placement is the authority.
 */
export async function previewCoupon(
  code: string,
  lines: readonly CouponCartLine[],
): Promise<CouponQuoteResult> {
  const parsed = couponCodeSchema.safeParse(code);
  if (!parsed.success) return { ok: false, reason: "NOT_FOUND" };
  const row = await prisma.coupon.findFirst({
    where: { code: parsed.data, deletedAt: null },
    select: COUPON_SELECT,
  });
  if (!row) return { ok: false, reason: "NOT_FOUND" };
  const eligible = eligibleSubtotalPaise(row, lines);
  const fail = checkCoupon(row, eligible, new Date());
  if (fail) return { ok: false, reason: fail };
  return {
    ok: true,
    code: row.code,
    discountPaise: computeDiscountPaise(row, eligible),
    scopeProductIds: row.productIds,
  };
}

/**
 * Redeem a coupon for an order being placed: the static checks, the
 * per-customer limit (counted from prior orders carrying the code), then the
 * ATOMIC exhaustion claim — a conditional `updateMany` that increments
 * redemptionCount ONLY while it is still below maxRedemptions, so two
 * concurrent redemptions of a 1-left coupon can never both win (count 0 ⇒
 * the claim lost ⇒ EXHAUSTED).
 *
 * The redemption is claimed BEFORE the order is created and is NOT rolled
 * back if placement later fails: a rare redemptionCount OVERCOUNT means a
 * coupon retires early — fail-closed for money, the safe direction. Never
 * the reverse (an order carrying an unclaimed discount).
 */
export async function redeemCoupon(
  code: string,
  lines: readonly CouponCartLine[],
  customerId: string,
): Promise<CouponQuoteResult> {
  const parsed = couponCodeSchema.safeParse(code);
  if (!parsed.success) return { ok: false, reason: "NOT_FOUND" };
  const row = await prisma.coupon.findFirst({
    where: { code: parsed.data, deletedAt: null },
    select: COUPON_SELECT,
  });
  if (!row) return { ok: false, reason: "NOT_FOUND" };
  const eligible = eligibleSubtotalPaise(row, lines);
  const fail = checkCoupon(row, eligible, new Date());
  if (fail) return { ok: false, reason: fail };

  if (row.perCustomerLimit != null) {
    const used = await prisma.order.count({
      where: { customerId, couponCode: row.code },
    });
    if (used >= row.perCustomerLimit) return { ok: false, reason: "PER_CUSTOMER_LIMIT" };
  }

  // ATOMIC exhaustion claim — re-asserts liveness AND headroom in the same
  // document-atomic write.
  const claimed = await prisma.coupon.updateMany({
    where: {
      id: row.id,
      active: true,
      deletedAt: null,
      ...(row.maxRedemptions != null
        ? { redemptionCount: { lt: row.maxRedemptions } }
        : {}),
    },
    data: { redemptionCount: { increment: 1 } },
  });
  if (claimed.count === 0) return { ok: false, reason: "EXHAUSTED" };

  return {
    ok: true,
    code: row.code,
    discountPaise: computeDiscountPaise(row, eligible),
    scopeProductIds: row.productIds,
  };
}

/* ── Cart suggestions ──────────────────────────────────────────────────── */

/** One suggestable coupon, quoted against the customer's live cart. */
export interface CouponSuggestion {
  code: string;
  kind: CouponKind;
  valueBps: number | null;
  amountPaise: number | null;
  minOrderPaise: number;
  /** True when the coupon is limited to specific products. */
  scoped: boolean;
  /** Whether the code would apply to the current cart right now. */
  applicable: boolean;
  /** The discount it would take (paise); 0 when not applicable. */
  discountPaise: number;
  /** Why it doesn't apply, when it doesn't. */
  reason: CouponFailReason | null;
}

/** Reasons that are actionable for the buyer — worth SHOWING greyed out.
 * Codes that are expired/exhausted/not-started are never advertised. */
const SUGGESTABLE_FAILS: ReadonlySet<CouponFailReason> = new Set([
  "MIN_ORDER",
  "NOT_APPLICABLE",
  "PER_CUSTOMER_LIMIT",
]);

/**
 * The coupons worth showing on the cart, each quoted against the live lines:
 * applicable ones first (biggest saving first), then almost-applicable ones
 * with the reason (e.g. "add more to reach the minimum"). Bounded reads; the
 * per-customer usage check is ONE grouped query, never per-coupon.
 */
export async function suggestCoupons(
  lines: readonly CouponCartLine[],
  customerId: string,
): Promise<CouponSuggestion[]> {
  const rows = await prisma.coupon.findMany({
    where: { deletedAt: null, active: true },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: COUPON_SELECT,
  });
  if (rows.length === 0) return [];

  const limitedCodes = rows
    .filter((r) => r.perCustomerLimit != null)
    .map((r) => r.code);
  const usage = new Map<string, number>();
  if (limitedCodes.length > 0) {
    const grouped = await prisma.order.groupBy({
      by: ["couponCode"],
      where: { customerId, couponCode: { in: limitedCodes } },
      _count: { _all: true },
    });
    for (const g of grouped) {
      if (g.couponCode) usage.set(g.couponCode, g._count._all);
    }
  }

  const now = new Date();
  const out: CouponSuggestion[] = [];
  for (const row of rows) {
    const eligible = eligibleSubtotalPaise(row, lines);
    let reason = checkCoupon(row, eligible, now);
    if (
      reason === null &&
      row.perCustomerLimit != null &&
      (usage.get(row.code) ?? 0) >= row.perCustomerLimit
    ) {
      reason = "PER_CUSTOMER_LIMIT";
    }
    if (reason !== null && !SUGGESTABLE_FAILS.has(reason)) continue;
    out.push({
      code: row.code,
      kind: row.kind,
      valueBps: row.valueBps,
      amountPaise: row.amountPaise,
      minOrderPaise: row.minOrderPaise,
      scoped: row.productIds.length > 0,
      applicable: reason === null,
      discountPaise: reason === null ? computeDiscountPaise(row, eligible) : 0,
      reason,
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.applicable) - Number(a.applicable) ||
      b.discountPaise - a.discountPaise,
  );
}

/** Friendly copy for each fail reason (single source for cart + placement). */
export const COUPON_FAIL_COPY: Record<CouponFailReason, string> = {
  NOT_FOUND: "That code isn't valid.",
  INACTIVE: "This code is no longer active.",
  NOT_STARTED: "This code isn't active yet.",
  EXPIRED: "This code has expired.",
  MIN_ORDER: "Your order doesn't meet this code's minimum value.",
  EXHAUSTED: "This code has been fully redeemed.",
  PER_CUSTOMER_LIMIT: "You've already used this code the maximum number of times.",
  NOT_APPLICABLE: "This code doesn't apply to any items in your cart.",
};
