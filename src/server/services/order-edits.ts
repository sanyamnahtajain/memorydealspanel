import type { OrderStatus, Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { formatPaise } from "@/lib/money";
import { resolveEffectiveAllocation } from "@/lib/allocation";
import { lineKey } from "@/lib/billing-groups/snapshot";
import { toOrderBillingSnapshot, type OrderBillingSnapshot } from "@/lib/billing-groups/snapshot";
import { allocateDiscount } from "@/lib/discount";
import type { DeliveryDisclosure } from "@/lib/delivery";
import {
  canAdminEditOrder,
  canCustomerEditOrder,
  diffOrderLines,
  editLineKey,
  orderNotEditableReason,
  type OrderChange,
  type OrderEditInput,
  type OrderEditLineInput,
  type OrderTotalsSnapshot,
  parseOrderChanges,
  parseOrderTotalsSnapshot,
} from "@/lib/order-edits";
import type {
  OrderEditPreviewDTO,
  OrderEditProductPick,
  OrderRevisionDTO,
  OrderTotalsView,
} from "@/lib/order-edits";
import { bucketizeCartLines } from "@/server/services/billing-groups";
import { requoteRedeemedCoupon } from "@/server/services/coupons";
import { getDeliveryTerms, getMinOrderValuePaise } from "@/server/services/store-settings";
import {
  parseOrderItems,
  type OrderItemSnapshot as StoredOrderItem,
} from "@/server/services/admin-orders";
import {
  CART_PRODUCT_SELECT,
  MAX_ORDER_VALUE_PAISE,
  applyGroupDiscountToLines,
  computeOrderTax,
  couponLinesFor,
  loadTaxContext,
  priceLine,
  resolvePlaceOfSupply,
  toSnapshot,
  variantLabel,
  type CartProductRow,
  type OrderItemSnapshot,
  type OrderTaxSnapshot,
  type PricedCartLine,
} from "@/server/services/orders";

/**
 * Order editing — the money engine.
 *
 * AN EDIT IS A RE-PRICE OF THE ORDER'S FROZEN LINES, not a new order:
 *
 *  - A line the order already has keeps its FROZEN unit price and its frozen
 *    GST rate/treatment. The deal the customer was given at placement is the
 *    deal; changing a quantity must not silently re-price the line at today's
 *    rate. Only its quantity (and, for allocation lines, its per-model split)
 *    can change.
 *  - A line ADDED by the edit is priced from the catalogue NOW, exactly as the
 *    cart would price it (same `priceLine`, same availability rules).
 *  - Everything DERIVED is recomputed with the placement pipeline over the new
 *    set of lines, so an edited order reconciles to the paisa the way a fresh
 *    one does: billing-group buckets and their tiered discount (current rules
 *    — the tier depends on the new bucket totals), the coupon's discount
 *    (re-quoted arithmetically, never re-validated — see requoteRedeemedCoupon),
 *    GST on the discounted values (frozen rates, current supply context), and
 *    the delivery charge from the CURRENT rules over the new goods value (the
 *    band is defined by order value, and the order value changed).
 *
 * WHAT NEVER CHANGES: the order number, placedAt, the coupon code, the
 * customer, the status, and the access-extension record.
 *
 * CONCURRENCY: every edit names the version it was made against; the write is
 * a conditional updateMany on (id, version, editable status) and a miss is a
 * conflict, never an overwrite. History goes to OrderRevision, append-only.
 *
 * Nothing in here throws for a business reason — every refusal is a typed
 * failure with words fit to show a person. Only infrastructure errors throw.
 */

export type OrderEditActor =
  | { kind: "admin"; adminId: string }
  | { kind: "customer"; customerId: string };

export type OrderEditFailure = {
  ok: false;
  error:
    | "not-found"
    | "forbidden"
    | "status"
    | "conflict"
    | "empty"
    | "invalid"
    | "too-large"
    | "below-minimum"
    | "unchanged";
  message: string;
  /** Per-line messages keyed by editLineKey, when the problem is a line. */
  lineErrors?: Record<string, string>;
};

/** How a line may be adjusted — for the editor's steppers. */
export interface OrderEditLineConstraints {
  moq: number;
  packMultiple: number | null;
  maxQty: number | null;
  /** The product (or variant) is orderable today. False ⇒ can only reduce/remove. */
  available: boolean;
  /** This line carries a per-model split that must sum to its quantity. */
  allocation: boolean;
}

/** A priced line in the previewed order (server money — never client input). */
export interface OrderEditPreviewLine {
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  brand: string | null;
  variantLabel: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  breakdown: { modelName: string; qty: number }[] | null;
  note: string | null;
  /** True when the edit added this line (priced at today's rate). */
  added: boolean;
  constraints: OrderEditLineConstraints;
}

export interface OrderEditPreview {
  ok: true;
  orderNumber: string;
  version: number;
  status: OrderStatus;
  lines: OrderEditPreviewLine[];
  before: OrderTotalsSnapshot;
  after: OrderTotalsSnapshot;
  changes: OrderChange[];
  /** Non-fatal notes: "Delivery charge changed from ₹250 to ₹350", etc. */
  warnings: string[];
  billing: OrderBillingSnapshot | null;
  tax: OrderTaxSnapshot | null;
  delivery: DeliveryDisclosure | null;
}

export interface OrderEditApplied {
  ok: true;
  orderId: string;
  orderNumber: string;
  customerId: string;
  version: number;
  changes: OrderChange[];
  before: OrderTotalsSnapshot;
  after: OrderTotalsSnapshot;
}

export interface OrderRevisionRecord {
  id: string;
  version: number;
  actorType: "admin" | "customer";
  actorId: string;
  reason: string | null;
  changes: OrderChange[];
  before: OrderTotalsSnapshot | null;
  after: OrderTotalsSnapshot | null;
  createdAt: Date;
}

/* ------------------------------------------------------------------ */
/* Reading the order                                                   */
/* ------------------------------------------------------------------ */

const EDIT_SELECT = {
  id: true,
  orderNumber: true,
  customerId: true,
  status: true,
  version: true,
  items: true,
  note: true,
  subtotalPaise: true,
  itemCount: true,
  couponCode: true,
  discountPaise: true,
  groupDiscountPaise: true,
  totalTaxPaise: true,
  grandTotalPaise: true,
  deliveryChargePaise: true,
} satisfies Prisma.OrderSelect;

type EditableOrderRow = Prisma.OrderGetPayload<{ select: typeof EDIT_SELECT }>;

/** A stored line as read back from `Order.items` (brandId/slug not persisted). */
type StoredLine = StoredOrderItem & { brandId?: string; slug?: string };

/** Absent (pre-feature) and null both mean "as placed". */
export function orderVersionOf(version: number | null | undefined): number {
  return version ?? 1;
}

function totalsOfRow(row: EditableOrderRow, items: StoredLine[]): OrderTotalsSnapshot {
  const goods = row.grandTotalPaise ?? row.subtotalPaise;
  const delivery = row.deliveryChargePaise ?? 0;
  return {
    subtotalPaise: row.subtotalPaise,
    itemCount: row.itemCount,
    lineCount: items.length,
    discountPaise: row.discountPaise ?? 0,
    groupDiscountPaise: row.groupDiscountPaise ?? 0,
    taxPaise: row.totalTaxPaise ?? 0,
    deliveryChargePaise: delivery,
    payablePaise: goods + delivery,
  };
}

function actorMayEdit(status: OrderStatus, actor: OrderEditActor): boolean {
  return actor.kind === "admin" ? canAdminEditOrder(status) : canCustomerEditOrder(status);
}

/* ------------------------------------------------------------------ */
/* Re-pricing                                                          */
/* ------------------------------------------------------------------ */

interface Repriced {
  lines: PricedCartLine[];
  items: OrderItemSnapshot[];
  previewLines: OrderEditPreviewLine[];
  subtotalPaise: number;
  itemCount: number;
  discountPaise: number;
  groupDiscountPaise: number;
  billing: OrderBillingSnapshot | null;
  tax: OrderTaxSnapshot | null;
  deliveryDisclosure: DeliveryDisclosure | null;
  deliveryChargePaise: number;
  totals: OrderTotalsSnapshot;
}

type LineError = { key: string; message: string };

/** Validate + build one EXISTING line at its frozen price. */
function buildExistingLine(
  prev: StoredLine,
  input: OrderEditLineInput,
  product: CartProductRow | undefined,
  actor: OrderEditActor,
): { line: PricedCartLine; constraints: OrderEditLineConstraints } | LineError {
  const key = editLineKey(prev.productId, prev.variantId);
  const variant =
    product && prev.variantId
      ? product.variants.find((v) => v.id === prev.variantId) ?? null
      : null;
  const moq = variant?.moq ?? product?.moq ?? 1;
  const packMultiple = variant?.packMultiple ?? product?.packMultiple ?? null;
  const maxQty = variant?.maxQty ?? product?.maxQty ?? null;
  const available =
    !!product &&
    product.status === "ACTIVE" &&
    product.deletedAt === null &&
    (prev.variantId ? !!variant && variant.status === "ACTIVE" : true) &&
    (variant?.stockStatus ?? product.stockStatus) !== "OUT_OF_STOCK";
  const allocation = !!prev.breakdown && prev.breakdown.length > 0;
  const constraints: OrderEditLineConstraints = { moq, packMultiple, maxQty, available, allocation };

  const quantity = input.quantity;
  const label = prev.variantLabel ? `${prev.name} — ${prev.variantLabel}` : prev.name;

  // Customers stay inside the product's ordering rules; staff may override
  // them (the shop can agree to sell five of a pack of ten). Everyone may
  // REDUCE a line whose product is no longer available — increasing it would
  // sell stock that isn't there.
  if (actor.kind === "customer") {
    if (quantity < moq) return { key, message: `${label}: minimum quantity is ${moq}.` };
    if (packMultiple && packMultiple > 1 && quantity % packMultiple !== 0) {
      return { key, message: `${label}: order in multiples of ${packMultiple}.` };
    }
    if (maxQty !== null && quantity > maxQty) {
      return { key, message: `${label}: at most ${maxQty} per order.` };
    }
  }
  if (!available && quantity > prev.quantity) {
    return { key, message: `${label} is no longer available — you can only reduce or remove it.` };
  }

  // Allocation lines: the split IS what gets packed. It must be present and
  // sum exactly; the server never redistributes on anyone's behalf.
  let breakdown: { modelName: string; qty: number }[] | null = null;
  if (allocation) {
    const provided = input.breakdown ?? null;
    if (provided === null || provided === undefined) {
      if (quantity !== prev.quantity) {
        return { key, message: `${label}: update the per-model split to match the new quantity.` };
      }
      breakdown = prev.breakdown ?? null;
    } else {
      const cleaned = provided
        .map((e) => ({ modelName: e.modelName.trim(), qty: e.qty }))
        .filter((e) => e.modelName !== "" && e.qty > 0);
      const sum = cleaned.reduce((s, e) => s + e.qty, 0);
      if (cleaned.length === 0 || sum !== quantity) {
        return { key, message: `${label}: the per-model split adds up to ${sum}, not ${quantity}.` };
      }
      breakdown = cleaned;
    }
  }

  const line: PricedCartLine = {
    productId: prev.productId,
    variantId: prev.variantId,
    name: prev.name,
    sku: prev.sku,
    brand: prev.brand,
    brandId: product?.brandId ?? prev.brandId ?? null,
    categoryId: product?.categoryId ?? null,
    variantLabel: prev.variantLabel,
    slug: prev.slug ?? product?.slug ?? "",
    imageUrl: prev.imageUrl,
    stockStatus: (variant?.stockStatus ?? product?.stockStatus ?? "IN_STOCK") as PricedCartLine["stockStatus"],
    moq,
    requestedQuantity: quantity,
    quantity,
    // FROZEN money: the price the customer was given stays the price.
    unitPricePaise: prev.unitPricePaise,
    lineTotalPaise: prev.unitPricePaise * quantity,
    orderable: true,
    issues: [],
    breakdown,
    note: prev.note ?? null,
    attachments: prev.attachments ?? [],
    // FROZEN rate/treatment; the paise breakup is recomputed on the new total.
    effectiveTax: prev.tax
      ? { hsnCode: prev.tax.hsnCode, gstRateBps: prev.tax.gstRateBps, treatment: prev.tax.treatment }
      : null,
  };
  return { line, constraints };
}

/** Price one NEW line from the catalogue, exactly as the cart would. */
function buildAddedLine(
  input: OrderEditLineInput,
  product: CartProductRow | undefined,
  ctx: Awaited<ReturnType<typeof loadTaxContext>>,
  actor: OrderEditActor,
): { line: PricedCartLine; constraints: OrderEditLineConstraints } | LineError {
  const key = editLineKey(input.productId, input.variantId);
  if (!product) return { key, message: "That product no longer exists." };

  // A per-model split typed for a new line arrives as frozen names; priceLine
  // understands them as "custom" slices (the same shape a typed model uses in
  // the cart), so the sum-check and the snapshot come out identical.
  const storedBreakdown = input.breakdown
    ? input.breakdown.map((e) => ({ custom: true as const, name: e.modelName, qty: e.qty }))
    : null;
  const priced = priceLine(product, input.variantId, input.quantity, ctx, storedBreakdown);
  if (!priced) return { key, message: "That product no longer exists." };

  const label = priced.variantLabel ? `${priced.name} — ${priced.variantLabel}` : priced.name;
  if (!priced.orderable) {
    const why = priced.issues.includes("out-of-stock")
      ? "is out of stock"
      : priced.issues.includes("variant-removed")
        ? "needs a variant to be chosen"
        : priced.issues.includes("breakdown-mismatch")
          ? "needs a per-model split that adds up to its quantity"
          : "is not available right now";
    return { key, message: `${label} ${why}.` };
  }

  const variant = input.variantId
    ? product.variants.find((v) => v.id === input.variantId) ?? null
    : null;
  const constraints: OrderEditLineConstraints = {
    moq: priced.moq,
    packMultiple: variant?.packMultiple ?? product.packMultiple ?? null,
    maxQty: variant?.maxQty ?? product.maxQty ?? null,
    available: true,
    allocation: !!priced.breakdown && priced.breakdown.length > 0,
  };

  // The cart CLAMPS (a nudge in a shopping flow); an edit is an explicit
  // instruction, so a customer's off-rule quantity is refused with the rule,
  // and staff get exactly the quantity they typed.
  if (priced.quantity !== input.quantity) {
    if (actor.kind === "customer") {
      const rule = priced.issues.includes("below-moq")
        ? `minimum quantity is ${constraints.moq}`
        : priced.issues.includes("pack-rounded")
          ? `order in multiples of ${constraints.packMultiple}`
          : `at most ${constraints.maxQty} per order`;
      return { key, message: `${label}: ${rule}.` };
    }
    priced.quantity = input.quantity;
    priced.lineTotalPaise = priced.unitPricePaise * input.quantity;
    priced.issues = [];
  }
  return { line: priced, constraints };
}

async function reprice(
  row: EditableOrderRow,
  existing: StoredLine[],
  input: OrderEditInput,
  actor: OrderEditActor,
): Promise<Repriced | OrderEditFailure> {
  // One desired line per key — a duplicate would double-count silently.
  const seen = new Set<string>();
  for (const l of input.lines) {
    const key = editLineKey(l.productId, l.variantId);
    if (seen.has(key)) {
      return { ok: false, error: "invalid", message: "The same product appears twice." };
    }
    seen.add(key);
  }

  const prevByKey = new Map(existing.map((l) => [editLineKey(l.productId, l.variantId), l]));
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const [products, ctx, placeOfSupply] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds } }, select: CART_PRODUCT_SELECT }),
    loadTaxContext(),
    resolvePlaceOfSupply(row.customerId),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));

  const lines: PricedCartLine[] = [];
  const constraintsByKey = new Map<string, OrderEditLineConstraints>();
  const addedKeys = new Set<string>();
  const lineErrors: Record<string, string> = {};

  for (const desired of input.lines) {
    const key = editLineKey(desired.productId, desired.variantId);
    const prev = prevByKey.get(key);
    const built = prev
      ? buildExistingLine(prev, desired, productById.get(desired.productId), actor)
      : buildAddedLine(desired, productById.get(desired.productId), ctx, actor);
    if ("message" in built) {
      lineErrors[built.key] = built.message;
      continue;
    }
    if (!prev) addedKeys.add(key);
    lines.push(built.line);
    constraintsByKey.set(key, built.constraints);
  }
  if (Object.keys(lineErrors).length > 0) {
    return {
      ok: false,
      error: "invalid",
      message: Object.values(lineErrors)[0]!,
      lineErrors,
    };
  }
  if (lines.length === 0) {
    return {
      ok: false,
      error: "empty",
      message: "An order needs at least one item — cancel it instead if nothing is wanted.",
    };
  }

  const subtotalPaise = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);
  if (subtotalPaise > MAX_ORDER_VALUE_PAISE) {
    return {
      ok: false,
      error: "too-large",
      message: `An order can be at most ${formatPaise(MAX_ORDER_VALUE_PAISE)} of goods.`,
    };
  }

  // ---- The placement pipeline, over the new lines. -----------------------
  const billing = await bucketizeCartLines(
    lines.map((l) => ({
      key: lineKey(l.productId, l.variantId),
      brandId: l.brandId,
      categoryId: l.categoryId,
      lineTotalPaise: l.lineTotalPaise,
    })),
  );
  const groupDiscountPaise = billing.groupDiscountPaise;
  const billingSnapshot = toOrderBillingSnapshot(billing);

  const couponLines = couponLinesFor(lines, billing);
  let discountPaise = 0;
  let couponScope: string[] = [];
  if (row.couponCode) {
    const quote = await requoteRedeemedCoupon(row.couponCode, couponLines);
    discountPaise = quote.discountPaise;
    couponScope = quote.scopeProductIds;
  }

  const gatedSubtotalPaise = subtotalPaise - groupDiscountPaise - discountPaise;
  if (actor.kind === "customer") {
    // The shop's floor applies to a customer's edit as it did to their
    // placement — an edit must not be a way under it. Staff may go below.
    const minOrderValuePaise = await getMinOrderValuePaise();
    if (minOrderValuePaise !== null && gatedSubtotalPaise < minOrderValuePaise) {
      return {
        ok: false,
        error: "below-minimum",
        message: `Orders need at least ${formatPaise(minOrderValuePaise)} of goods — this change would leave ${formatPaise(gatedSubtotalPaise)}.`,
      };
    }
  }

  const groupedLines = applyGroupDiscountToLines(lines, billing);
  const scopeSet = couponScope.length > 0 ? new Set(couponScope) : null;
  const discountAlloc =
    discountPaise > 0
      ? allocateDiscount(
          couponLines.map((cl) =>
            scopeSet === null || scopeSet.has(cl.productId) ? cl.lineTotalPaise : 0,
          ),
          discountPaise,
        )
      : null;
  const taxLines = discountAlloc
    ? groupedLines.map((l, i) => ({ ...l, lineTotalPaise: l.lineTotalPaise - discountAlloc[i] }))
    : groupedLines;
  const computed = computeOrderTax(taxLines, ctx, placeOfSupply);

  const { disclosure: deliveryDisclosure, chargePaise: deliveryChargePaise } =
    await getDeliveryTerms(gatedSubtotalPaise);

  const items = lines.map((line, i) => toSnapshot(line, computed?.perLine[i]));
  const tax = computed?.order ?? null;
  const totalDiscountPaise = discountPaise + groupDiscountPaise;
  const goodsPaise = tax ? tax.grandTotalPaise : subtotalPaise - totalDiscountPaise;

  const totals: OrderTotalsSnapshot = {
    subtotalPaise,
    itemCount,
    lineCount: items.length,
    discountPaise,
    groupDiscountPaise,
    taxPaise: tax?.totalTaxPaise ?? 0,
    deliveryChargePaise,
    payablePaise: goodsPaise + deliveryChargePaise,
  };

  const previewLines: OrderEditPreviewLine[] = items.map((it) => {
    const key = editLineKey(it.productId, it.variantId);
    return {
      key,
      productId: it.productId,
      variantId: it.variantId,
      name: it.name,
      sku: it.sku,
      brand: it.brand,
      variantLabel: it.variantLabel,
      imageUrl: it.imageUrl,
      quantity: it.quantity,
      unitPricePaise: it.unitPricePaise,
      lineTotalPaise: it.lineTotalPaise,
      breakdown: it.breakdown ?? null,
      note: it.note ?? null,
      added: addedKeys.has(key),
      constraints: constraintsByKey.get(key)!,
    };
  });

  return {
    lines,
    items,
    previewLines,
    subtotalPaise,
    itemCount,
    discountPaise,
    groupDiscountPaise,
    billing: billingSnapshot,
    tax,
    deliveryDisclosure,
    deliveryChargePaise,
    totals,
  };
}

function noteChange(prev: string | null, input: OrderEditInput): OrderChange | null {
  if (input.note === undefined) return null;
  const next = input.note === null || input.note.trim() === "" ? null : input.note.trim();
  if ((prev ?? null) === next) return null;
  return { kind: "note", from: prev ?? null, to: next };
}

function warningsFor(before: OrderTotalsSnapshot, after: OrderTotalsSnapshot): string[] {
  const out: string[] = [];
  if (before.deliveryChargePaise !== after.deliveryChargePaise) {
    out.push(
      `Delivery charge changes from ${formatPaise(before.deliveryChargePaise)} to ${formatPaise(after.deliveryChargePaise)} with the new order value.`,
    );
  }
  if (before.groupDiscountPaise !== after.groupDiscountPaise) {
    out.push(
      `Group discount changes from ${formatPaise(before.groupDiscountPaise)} to ${formatPaise(after.groupDiscountPaise)}.`,
    );
  }
  if (before.discountPaise !== after.discountPaise) {
    out.push(
      `Coupon discount changes from ${formatPaise(before.discountPaise)} to ${formatPaise(after.discountPaise)}.`,
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Public: preview / apply / history                                   */
/* ------------------------------------------------------------------ */

async function loadForEdit(
  orderId: string,
  actor: OrderEditActor,
): Promise<{ row: EditableOrderRow; items: StoredLine[] } | OrderEditFailure> {
  const row = await prisma.order.findFirst({
    where: {
      id: orderId,
      // Ownership is part of the QUERY, so a customer can never even learn
      // that someone else's order exists.
      ...(actor.kind === "customer" ? { customerId: actor.customerId } : {}),
    },
    select: EDIT_SELECT,
  });
  if (!row) return { ok: false, error: "not-found", message: "Order not found." };
  if (!actorMayEdit(row.status, actor)) {
    return {
      ok: false,
      error: "status",
      message: orderNotEditableReason(row.status, actor.kind) ?? "This order can no longer be edited.",
    };
  }
  return { row, items: parseOrderItems(row.items) as StoredLine[] };
}

/** Price an edit without saving it — what the editor shows live. */
export async function previewOrderEdit(
  orderId: string,
  actor: OrderEditActor,
  input: OrderEditInput,
): Promise<OrderEditPreview | OrderEditFailure> {
  const loaded = await loadForEdit(orderId, actor);
  if ("ok" in loaded) return loaded;
  const { row, items } = loaded;

  if (orderVersionOf(row.version) !== input.expectedVersion) {
    return {
      ok: false,
      error: "conflict",
      message: "This order was changed by someone else. Reload to see the latest version.",
    };
  }

  const repriced = await reprice(row, items, input, actor);
  if ("ok" in repriced) return repriced;

  const before = totalsOfRow(row, items);
  const changes = diffOrderLines(items, repriced.items);
  const note = noteChange(row.note ?? null, input);
  if (note) changes.push(note);

  return {
    ok: true,
    orderNumber: row.orderNumber,
    version: orderVersionOf(row.version),
    status: row.status,
    lines: repriced.previewLines,
    before,
    after: repriced.totals,
    changes,
    warnings: warningsFor(before, repriced.totals),
    billing: repriced.billing,
    tax: repriced.tax,
    delivery: repriced.deliveryDisclosure,
  };
}

/**
 * Apply an edit: conditional write on (id, version, editable status) plus the
 * revision row, in one transaction. A miss is a CONFLICT (the version moved
 * or the status did) — never a silent overwrite.
 */
export async function applyOrderEdit(
  orderId: string,
  actor: OrderEditActor,
  input: OrderEditInput,
): Promise<OrderEditApplied | OrderEditFailure> {
  const loaded = await loadForEdit(orderId, actor);
  if ("ok" in loaded) return loaded;
  const { row, items } = loaded;

  const currentVersion = orderVersionOf(row.version);
  if (currentVersion !== input.expectedVersion) {
    return {
      ok: false,
      error: "conflict",
      message: "This order was changed by someone else. Reload to see the latest version.",
    };
  }

  const repriced = await reprice(row, items, input, actor);
  if ("ok" in repriced) return repriced;

  const before = totalsOfRow(row, items);
  const changes = diffOrderLines(items, repriced.items);
  const note = noteChange(row.note ?? null, input);
  if (note) changes.push(note);
  if (changes.length === 0) {
    return { ok: false, error: "unchanged", message: "Nothing has changed." };
  }

  const nextVersion = currentVersion + 1;
  const tax = repriced.tax;
  const totalDiscountPaise = repriced.discountPaise + repriced.groupDiscountPaise;
  const editableStatuses: OrderStatus[] =
    actor.kind === "admin" ? ["PLACED", "CONFIRMED", "PROCESSING"] : ["PLACED"];

  // Mirrors placeOrderTransaction's column discipline exactly, but as an
  // UPDATE: a value that placement would have OMITTED is written back as
  // null here, because the previous edit (or the placement) may have set it.
  const data: Prisma.OrderUncheckedUpdateManyInput = {
    items: repriced.items as unknown as Prisma.InputJsonValue,
    subtotalPaise: repriced.subtotalPaise,
    itemCount: repriced.itemCount,
    ...(input.note !== undefined
      ? { note: input.note === null || input.note.trim() === "" ? null : input.note.trim() }
      : {}),
    discountPaise: repriced.discountPaise > 0 ? repriced.discountPaise : null,
    groupDiscountPaise: repriced.groupDiscountPaise > 0 ? repriced.groupDiscountPaise : null,
    billingGroups: repriced.billing
      ? (repriced.billing as unknown as Prisma.InputJsonValue)
      : null,
    deliveryDisclosure: repriced.deliveryDisclosure
      ? (repriced.deliveryDisclosure as unknown as Prisma.InputJsonValue)
      : null,
    deliveryChargePaise: repriced.deliveryChargePaise > 0 ? repriced.deliveryChargePaise : null,
    version: nextVersion,
    editedAt: new Date(),
    ...(tax
      ? {
          taxApplied: true,
          supplyType: tax.supplyType,
          sellerStateCode: tax.sellerStateCode,
          sellerGstin: tax.sellerGstin,
          placeOfSupplyStateCode: tax.placeOfSupplyStateCode,
          totalTaxablePaise: tax.totalTaxablePaise,
          totalCgstPaise: tax.supplyType === "INTRA" ? tax.totalCgstPaise : null,
          totalSgstPaise: tax.supplyType === "INTRA" ? tax.totalSgstPaise : null,
          totalIgstPaise: tax.supplyType === "INTER" ? tax.totalIgstPaise : null,
          totalTaxPaise: tax.totalTaxPaise,
          roundOffPaise: tax.roundOffPaise,
          grandTotalPaise: tax.grandTotalPaise,
          hsnSummary: tax.hsnSummary as unknown as Prisma.InputJsonValue,
        }
      : {
          taxApplied: false,
          supplyType: null,
          totalTaxablePaise: null,
          totalCgstPaise: null,
          totalSgstPaise: null,
          totalIgstPaise: null,
          totalTaxPaise: null,
          roundOffPaise: null,
          hsnSummary: null,
          // Pre-GST: the goods total is the subtotal unless a discount applies.
          grandTotalPaise:
            totalDiscountPaise > 0 ? repriced.subtotalPaise - totalDiscountPaise : null,
        }),
  };

  // The version predicate must match the row's ACTUAL shape: a pre-feature
  // order has no `version` field at all, which on MongoDB matches neither
  // `1` nor `null`.
  const versionWhere: Prisma.OrderWhereInput =
    currentVersion === 1
      ? { OR: [{ version: 1 }, { version: null }, { version: { isSet: false } }] }
      : { version: currentVersion };

  try {
    await withTransientRetry(() =>
      prisma.$transaction(async (tx) => {
        const result = await tx.order.updateMany({
          where: { id: row.id, status: { in: editableStatuses }, ...versionWhere },
          data,
        });
        if (result.count !== 1) throw new EditConflict();
        await tx.orderRevision.create({
          data: {
            orderId: row.id,
            version: nextVersion,
            actorType: actor.kind,
            actorId: actor.kind === "admin" ? actor.adminId : actor.customerId,
            reason: input.reason && input.reason.trim() !== "" ? input.reason.trim() : null,
            changes: changes as unknown as Prisma.InputJsonValue,
            before: before as unknown as Prisma.InputJsonValue,
            after: repriced.totals as unknown as Prisma.InputJsonValue,
          },
        });
      }),
    );
  } catch (error) {
    if (error instanceof EditConflict) {
      return {
        ok: false,
        error: "conflict",
        message: "This order was changed by someone else. Reload to see the latest version.",
      };
    }
    throw error;
  }

  return {
    ok: true,
    orderId: row.id,
    orderNumber: row.orderNumber,
    customerId: row.customerId,
    version: nextVersion,
    changes,
    before,
    after: repriced.totals,
  };
}

class EditConflict extends Error {
  constructor() {
    super("order edit conflict");
  }
}

/** Prisma's code for "Transaction failed due to a write conflict or a deadlock". */
const TRANSIENT_TX_CODE = "P2034";
const TRANSIENT_TX_ATTEMPTS = 4;

function isTransientTxError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === TRANSIENT_TX_CODE
  );
}

/**
 * MongoDB aborts a multi-document transaction when ANY other write touches one
 * of its documents mid-flight — including a perfectly legitimate one, such as
 * placement's own post-commit access-extension write landing on the order a
 * moment before staff edit it. The driver's guidance is to retry; the
 * transaction is all-or-nothing, so a retry can never double-apply. A version
 * conflict (EditConflict) is NOT transient and is never retried.
 */
async function withTransientRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isTransientTxError(error) || attempt >= TRANSIENT_TX_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.random() * 50));
    }
  }
}

/** The edit history of an order, newest first. */
export async function listOrderRevisions(orderId: string): Promise<OrderRevisionRecord[]> {
  const rows = await prisma.orderRevision.findMany({
    where: { orderId },
    orderBy: { version: "desc" },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    actorType: r.actorType === "admin" ? "admin" : "customer",
    actorId: r.actorId,
    reason: r.reason ?? null,
    changes: parseOrderChanges(r.changes),
    before: parseOrderTotalsSnapshot(r.before),
    after: parseOrderTotalsSnapshot(r.after),
    createdAt: r.createdAt,
  }));
}

/* ------------------------------------------------------------------ */
/* Client projections (price-gated)                                    */
/* ------------------------------------------------------------------ */

function gate<T>(value: T, priced: boolean): T | null {
  return priced ? value : null;
}

export function toOrderTotalsView(t: OrderTotalsSnapshot, priced: boolean): OrderTotalsView {
  return {
    itemCount: t.itemCount,
    lineCount: t.lineCount,
    subtotalPaise: gate(t.subtotalPaise, priced),
    discountPaise: gate(t.discountPaise, priced),
    groupDiscountPaise: gate(t.groupDiscountPaise, priced),
    taxPaise: gate(t.taxPaise, priced),
    deliveryChargePaise: gate(t.deliveryChargePaise, priced),
    payablePaise: gate(t.payablePaise, priced),
  };
}

/**
 * The preview as the client may see it. `priced=false` strips every amount —
 * the price gate applies to an edit exactly as to the order it edits.
 */
export function toOrderEditPreviewDTO(p: OrderEditPreview, priced: boolean): OrderEditPreviewDTO {
  return {
    version: p.version,
    lines: p.lines.map((l) => ({
      key: l.key,
      productId: l.productId,
      variantId: l.variantId,
      name: l.name,
      sku: l.sku,
      brand: l.brand,
      variantLabel: l.variantLabel,
      imageUrl: l.imageUrl,
      quantity: l.quantity,
      unitPricePaise: gate(l.unitPricePaise, priced),
      lineTotalPaise: gate(l.lineTotalPaise, priced),
      breakdown: l.breakdown,
      note: l.note,
      added: l.added,
      constraints: l.constraints,
    })),
    before: toOrderTotalsView(p.before, priced),
    after: toOrderTotalsView(p.after, priced),
    changes: p.changes,
    warnings: priced ? p.warnings : [],
  };
}

export function toOrderRevisionDTO(r: OrderRevisionRecord, priced: boolean): OrderRevisionDTO {
  return {
    id: r.id,
    version: r.version,
    actorType: r.actorType,
    actorId: r.actorId,
    reason: r.reason,
    changes: r.changes,
    before: r.before ? toOrderTotalsView(r.before, priced) : null,
    after: r.after ? toOrderTotalsView(r.after, priced) : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Product search for the "add a line" picker                          */
/* ------------------------------------------------------------------ */

const PICK_LIMIT = 8;

/**
 * Orderable products matching a query — PUBLIC fields only (no price; the
 * engine prices the line once it is added, under the viewer's gate).
 */
export async function searchProductsForOrderEdit(query: string): Promise<OrderEditProductPick[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await prisma.product.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      stockStatus: { not: "OUT_OF_STOCK" },
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
        { brand: { contains: q, mode: "insensitive" } },
      ],
    },
    take: PICK_LIMIT,
    orderBy: { name: "asc" },
    select: CART_PRODUCT_SELECT,
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    brand: p.brandRef?.name ?? p.brand ?? null,
    thumbUrl: (p.images.find((i) => i.isPrimary) ?? p.images[0])?.thumbUrl ?? p.images[0]?.url ?? null,
    variants: p.hasVariants
      ? p.variants
          .filter((v) => v.status === "ACTIVE" && v.stockStatus !== "OUT_OF_STOCK")
          .map((v) => ({ id: v.id, label: variantLabel(v.optionValues) ?? v.sku, sku: v.sku }))
      : [],
    allocation: resolveEffectiveAllocation(p.allocation, p.category?.defaultAllocation) !== null,
    moq: p.moq ?? 1,
    packMultiple: p.packMultiple ?? null,
  }));
}
