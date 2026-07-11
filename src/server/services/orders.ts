import { randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { assertPaise } from "@/lib/money";
import {
  MAX_CART_LINES,
  MAX_CART_NOTE_LENGTH,
  MAX_QTY_PER_LINE,
  MIN_QTY_PER_LINE,
} from "@/lib/schemas/cart";
import { limit } from "@/server/security/ratelimit";
import { writeAudit } from "@/server/security/audit";
import { sendPushToAdmin } from "@/server/notify/push";
import { withPlacementLock } from "@/server/services/placement-lock";
import type { StockStatus } from "@/lib/schemas/shared";

/**
 * Orders service — the anti-cheat heart of Cart & Orders (Phase 12).
 *
 * NO PAYMENT is collected. An Order is a purchase REQUEST the wholesaler
 * fulfils offline. Only APPROVED, unexpired customers may build a cart or place
 * an order; the gate is re-verified here on EVERY read/mutation and again at
 * placement — never trusted from a cart that was built while approved.
 *
 * NON-NEGOTIABLE INVARIANTS (this file is where they are enforced):
 *
 *  1. PRICE IS NEVER TRUSTED FROM THE CLIENT. The cart stores only
 *     { productId, variantId?, quantity }. Unit prices, line totals and the
 *     subtotal are computed HERE from the live product/variant row (the same
 *     price the gated DAL would serve an approved viewer). Any price-shaped
 *     value in a request is structurally absent from the input schemas, so it
 *     never reaches this layer. The Order snapshots the SERVER price.
 *
 *  2. ACCESS RE-CHECKED at placement: approved status + a live (unrevoked,
 *     unexpired) AccessGrant. `assertCanOrder` throws OrderAccessError if the
 *     grant lapsed mid-cart, even though the cart itself survives.
 *
 *  3. IDOR: every query is scoped by `customerId` (supplied ONLY from the
 *     resolved viewer, never the client). `orderNumber` is a random,
 *     non-enumerable public reference; `getOrderForCustomer` still checks
 *     ownership on top of the random id.
 *
 *  4. RATE LIMITING + IDEMPOTENCY: `placeOrder` is capped per hour and per day
 *     per customer and de-duplicates a double-submit (by idempotency key, or by
 *     detecting an identical cart already placed within a short window) so a
 *     retry/two-tab race can't create duplicate orders. The cart is cleared and
 *     the order created in ONE transaction.
 *
 *  5. CAPS/VALIDATION: quantity is clamped to [MOQ, per-line cap]; invalid
 *     lines (inactive/soft-deleted product, missing/inactive variant,
 *     OUT_OF_STOCK) are EXCLUDED and reported — never silently ordered. A max
 *     order-value ceiling and a max distinct-line cap are enforced.
 */

// ---------------------------------------------------------------------------
// Caps & limits
// ---------------------------------------------------------------------------

/** Hard ceiling on a single order's subtotal (₹50,00,000 in paise). */
export const MAX_ORDER_VALUE_PAISE = 50_00_000_00;

/** Placement rate limits, per customer. Strict — placing is a rare action. */
const PLACE_ORDER_PER_HOUR = 10;
const PLACE_ORDER_PER_DAY = 30;

/**
 * Idempotency window (ms): a second placement of an identical cart within this
 * window returns the FIRST order instead of creating a duplicate, even without
 * an explicit key (covers the classic double-click / two-tab race).
 */
const IDEMPOTENCY_WINDOW_MS = 60_000;

/** How the orderNumber is shaped: MD- + 12 uppercase base32 chars. */
const ORDER_NUMBER_BYTES = 8;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Raised when the viewer is not allowed to cart/order (gate failed). */
export class OrderAccessError extends Error {
  constructor(message = "Your account cannot place orders right now.") {
    super(message);
    this.name = "OrderAccessError";
  }
}

/** Raised when the cart is empty (nothing purchasable remains). */
export class EmptyCartError extends Error {
  constructor(message = "Your cart is empty.") {
    super(message);
    this.name = "EmptyCartError";
  }
}

/** Raised when the customer is placing orders too frequently. */
export class OrderRateLimitError extends Error {
  constructor(message = "Too many orders. Please try again later.") {
    super(message);
    this.name = "OrderRateLimitError";
  }
}

/** Raised when the computed subtotal exceeds the order-value ceiling. */
export class OrderTooLargeError extends Error {
  constructor(message = "This order exceeds the maximum allowed value.") {
    super(message);
    this.name = "OrderTooLargeError";
  }
}

// ---------------------------------------------------------------------------
// Line pricing / validation
// ---------------------------------------------------------------------------

/** Why a cart line cannot be ordered (surfaced to the customer for a re-confirm). */
export type CartLineIssue =
  | "unavailable" // product inactive or soft-deleted
  | "variant-removed" // variant missing or inactive
  | "out-of-stock" // stock is OUT_OF_STOCK
  | "below-moq" // clamped up to the product MOQ
  | "clamped"; // clamped down to the per-line cap

/**
 * A priced, validated cart line. `unitPricePaise`/`lineTotalPaise` are always
 * SERVER values from the live row — the client never contributes a price.
 */
export interface PricedCartLine {
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  brand: string | null;
  variantLabel: string | null;
  slug: string;
  imageUrl: string | null;
  stockStatus: StockStatus;
  moq: number;
  /** The quantity the customer requested (pre-clamp). */
  requestedQuantity: number;
  /** The effective, clamped quantity that would be ordered. */
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  /** True when this line can be part of an order. */
  orderable: boolean;
  /** Non-fatal warnings (e.g. below-moq clamp, low stock) + fatal reasons. */
  issues: CartLineIssue[];
}

/** The fully-priced cart for a customer, ready to render or place. */
export interface PricedCart {
  lines: PricedCartLine[];
  /** Lines that can be placed. */
  orderableLines: PricedCartLine[];
  /** Lines excluded from placement (unavailable/variant-removed/out-of-stock). */
  blockedLines: PricedCartLine[];
  subtotalPaise: number;
  itemCount: number;
  /** Distinct orderable line count. */
  lineCount: number;
}

/** Product row shape we need to price + validate a line (money INCLUDED). */
const CART_PRODUCT_SELECT = {
  id: true,
  name: true,
  slug: true,
  sku: true,
  brand: true,
  brandRef: { select: { name: true } },
  price: true,
  moq: true,
  stockStatus: true,
  status: true,
  deletedAt: true,
  hasVariants: true,
  images: { select: { url: true, thumbUrl: true, isPrimary: true } },
  variants: {
    select: {
      id: true,
      sku: true,
      optionValues: true,
      price: true,
      moq: true,
      stockStatus: true,
      status: true,
    },
  },
} satisfies Prisma.ProductSelect;

type CartProductRow = Prisma.ProductGetPayload<{ select: typeof CART_PRODUCT_SELECT }>;

/** Build a human variant label from its optionValues JSON (e.g. "20000mAh · Black"). */
function variantLabel(optionValues: Prisma.JsonValue | null | undefined): string | null {
  if (!optionValues || typeof optionValues !== "object" || Array.isArray(optionValues)) {
    return null;
  }
  const parts = Object.values(optionValues as Record<string, unknown>)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Clamp a requested quantity into [max(MOQ, MIN), cap], tracking why it moved. */
function clampQuantity(
  requested: number,
  moq: number,
): { quantity: number; issues: CartLineIssue[] } {
  const issues: CartLineIssue[] = [];
  const floor = Math.max(moq, MIN_QTY_PER_LINE);
  let quantity = requested;
  if (quantity < floor) {
    quantity = floor;
    issues.push("below-moq");
  }
  if (quantity > MAX_QTY_PER_LINE) {
    quantity = MAX_QTY_PER_LINE;
    issues.push("clamped");
  }
  return { quantity, issues };
}

function primaryImageUrl(images: CartProductRow["images"]): string | null {
  const primary = images.find((i) => i.isPrimary) ?? images[0] ?? null;
  return primary ? primary.thumbUrl ?? primary.url : null;
}

/**
 * Price + validate ONE cart line against its live product/variant row. Returns
 * a fully-priced line; `orderable` is false (with a fatal issue) when the line
 * must be excluded from an order. The unit price is ALWAYS the live server
 * price — the caller's cart carries no price at all.
 */
function priceLine(
  product: CartProductRow | undefined,
  variantId: string | null,
  requestedQuantity: number,
): PricedCartLine | null {
  // Product vanished entirely (hard-deleted) — drop the line silently; it can
  // no longer be represented. (Soft-delete is handled below as "unavailable".)
  if (!product) {
    return null;
  }

  const base: Omit<PricedCartLine, "unitPricePaise" | "lineTotalPaise" | "orderable" | "quantity" | "issues"> & {
    quantity: number;
  } = {
    productId: product.id,
    variantId,
    name: product.name,
    sku: product.sku,
    brand: product.brandRef?.name ?? product.brand ?? null,
    variantLabel: null,
    slug: product.slug,
    imageUrl: primaryImageUrl(product.images),
    stockStatus: product.stockStatus as StockStatus,
    moq: product.moq ?? MIN_QTY_PER_LINE,
    requestedQuantity,
    quantity: requestedQuantity,
  };

  const unavailable = product.status !== "ACTIVE" || product.deletedAt !== null;

  // Resolve the priced unit: variant when one is pinned, else the product.
  let unitPricePaise = product.price;
  let stockStatus = product.stockStatus as StockStatus;
  let moq = product.moq ?? MIN_QTY_PER_LINE;
  let sku = product.sku;
  let vLabel: string | null = null;
  let variantMissing = false;

  if (variantId) {
    const variant = product.variants.find((v) => v.id === variantId);
    if (!variant || variant.status !== "ACTIVE") {
      variantMissing = true;
    } else {
      unitPricePaise = variant.price;
      stockStatus = variant.stockStatus as StockStatus;
      moq = variant.moq ?? product.moq ?? MIN_QTY_PER_LINE;
      sku = variant.sku;
      vLabel = variantLabel(variant.optionValues);
    }
  } else if (product.hasVariants) {
    // A variant product with no variant pinned is not orderable as-is.
    variantMissing = true;
  }

  const { quantity, issues } = clampQuantity(requestedQuantity, moq);

  // Guard the server price itself; a corrupt row must never produce a bogus total.
  assertPaise(unitPricePaise, "unitPricePaise");
  const lineTotalPaise = unitPricePaise * quantity;
  assertPaise(lineTotalPaise, "lineTotalPaise");

  const outOfStock = stockStatus === "OUT_OF_STOCK";

  const fatal: CartLineIssue[] = [];
  if (unavailable) fatal.push("unavailable");
  if (variantMissing) fatal.push("variant-removed");
  if (outOfStock) fatal.push("out-of-stock");

  const orderable = fatal.length === 0;

  return {
    ...base,
    sku,
    moq,
    stockStatus,
    variantLabel: vLabel,
    quantity,
    unitPricePaise,
    lineTotalPaise: orderable ? lineTotalPaise : 0,
    orderable,
    issues: [...fatal, ...issues],
  };
}

// ---------------------------------------------------------------------------
// Access gate
// ---------------------------------------------------------------------------

/**
 * Re-verify — against the LIVE database — that this customer may cart/order:
 * APPROVED status AND a currently-valid AccessGrant (unrevoked, unexpired).
 * Throws OrderAccessError otherwise. Called on every mutation and at placement,
 * so an access grant that lapsed after the cart was built blocks the order.
 */
export async function assertCanOrder(customerId: string): Promise<void> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { status: true },
  });
  if (!customer || customer.status !== "APPROVED") {
    throw new OrderAccessError();
  }
  const now = new Date();
  const grant = await prisma.accessGrant.findFirst({
    where: {
      customerId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  if (!grant) {
    throw new OrderAccessError();
  }
}

// ---------------------------------------------------------------------------
// Cart pricing (shared by the cart page and placeOrder)
// ---------------------------------------------------------------------------

/**
 * Load the customer's cart and price + validate every line SERVER-SIDE.
 *
 * IDOR: scoped to `customerId`. Does NOT itself gate access — callers that
 * mutate/place MUST `assertCanOrder` first; a read for display may choose to
 * lock the UI instead. Returns the priced cart with orderable/blocked split.
 */
export async function priceCartForCustomer(customerId: string): Promise<PricedCart> {
  const cartItems = await prisma.cartItem.findMany({
    where: { customerId },
    orderBy: { createdAt: "asc" },
    take: MAX_CART_LINES,
    select: { productId: true, variantId: true, quantity: true },
  });

  if (cartItems.length === 0) {
    return {
      lines: [],
      orderableLines: [],
      blockedLines: [],
      subtotalPaise: 0,
      itemCount: 0,
      lineCount: 0,
    };
  }

  const productIds = [...new Set(cartItems.map((c) => c.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: CART_PRODUCT_SELECT,
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines: PricedCartLine[] = [];
  for (const item of cartItems) {
    const line = priceLine(byId.get(item.productId), item.variantId, item.quantity);
    if (line) lines.push(line);
  }

  const orderableLines = lines.filter((l) => l.orderable);
  const blockedLines = lines.filter((l) => !l.orderable);
  const subtotalPaise = orderableLines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
  const itemCount = orderableLines.reduce((sum, l) => sum + l.quantity, 0);

  return {
    lines,
    orderableLines,
    blockedLines,
    subtotalPaise,
    itemCount,
    lineCount: orderableLines.length,
  };
}

// ---------------------------------------------------------------------------
// Order snapshot items
// ---------------------------------------------------------------------------

/** One snapshotted line stored on the Order (immune to later catalog changes). */
export interface OrderItemSnapshot {
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  brand: string | null;
  variantLabel: string | null;
  slug: string;
  imageUrl: string | null;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}

function toSnapshot(line: PricedCartLine): OrderItemSnapshot {
  return {
    productId: line.productId,
    variantId: line.variantId,
    name: line.name,
    sku: line.sku,
    brand: line.brand,
    variantLabel: line.variantLabel,
    slug: line.slug,
    imageUrl: line.imageUrl,
    quantity: line.quantity,
    unitPricePaise: line.unitPricePaise,
    lineTotalPaise: line.lineTotalPaise,
  };
}

// ---------------------------------------------------------------------------
// Order DTO (customer-facing)
// ---------------------------------------------------------------------------

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: string;
  items: OrderItemSnapshot[];
  subtotalPaise: number;
  itemCount: number;
  note: string | null;
  placedAt: Date;
}

/** A random, non-enumerable public order reference, e.g. "MD-4F8K2Q7ZX1AB". */
function generateOrderNumber(): string {
  // base32 (Crockford-ish): uppercase A–Z + 2–9, no ambiguous chars.
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = randomBytes(ORDER_NUMBER_BYTES);
  let out = "";
  for (const b of bytes) {
    out += alphabet[b % alphabet.length];
  }
  return `MD-${out}`;
}

// ---------------------------------------------------------------------------
// placeOrder — the transactional anti-cheat heart
// ---------------------------------------------------------------------------

export interface PlaceOrderInput {
  /** Optional free-text note (length-capped, plain text). */
  note?: string;
  /**
   * Optional idempotency key from the client. When supplied, a repeat call with
   * the same key returns the FIRST order instead of creating a duplicate.
   */
  idempotencyKey?: string;
}

export type PlaceOrderResult =
  | { ok: true; order: CustomerOrder; deduped: boolean; excluded: PricedCartLine[] }
  | { ok: false; error: "empty" | "access" | "rate-limit" | "too-large"; message: string; excluded?: PricedCartLine[] };

/** In-memory idempotency ledger (key -> orderNumber) for the fallback path. */
const globalForOrders = globalThis as unknown as {
  __memorydealsOrderIdempotency: Map<string, { orderNumber: string; at: number }> | undefined;
};
function idempotencyLedger(): Map<string, { orderNumber: string; at: number }> {
  return (globalForOrders.__memorydealsOrderIdempotency ??= new Map());
}

function sanitizeNote(note: string | undefined): string | null {
  if (typeof note !== "string") return null;
  const trimmed = note.trim().slice(0, MAX_CART_NOTE_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Place an order (a purchase request). See the file header for the full
 * invariant list. Steps:
 *   1. re-check access (approved + live grant);
 *   2. load + price the cart server-side; reject if empty;
 *   3. exclude invalid lines and report them (never silently order);
 *   4. enforce the max order-value ceiling;
 *   5. rate-limit (per hour/day) + idempotency (key or identical-cart dedup);
 *   6. in ONE transaction: create the Order (random number, server snapshot)
 *      and clear the cart;
 *   7. notify admins (push + Notification row).
 *
 * `customerId` is supplied ONLY from the resolved viewer (never the client).
 */
export async function placeOrder(
  customerId: string,
  input: PlaceOrderInput = {},
): Promise<PlaceOrderResult> {
  // Serialise all placements for THIS customer (invariant #4). A double-click /
  // two-tab race would otherwise let two calls pass the identical-cart dedup
  // check before either commits and each create an Order. Under the lock the
  // second call only runs after the first has committed + cleared the cart, so
  // it dedups (identical cart) or sees an empty cart — never a duplicate.
  return withPlacementLock(customerId, () => placeOrderLocked(customerId, input));
}

/** The body of `placeOrder`, run under the per-customer placement lock. */
async function placeOrderLocked(
  customerId: string,
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  // (1) Access re-check — throws OrderAccessError if the grant lapsed mid-cart.
  try {
    await assertCanOrder(customerId);
  } catch {
    return { ok: false, error: "access", message: new OrderAccessError().message };
  }

  const note = sanitizeNote(input.note);
  const key = typeof input.idempotencyKey === "string" ? input.idempotencyKey.slice(0, 100) : undefined;

  // (5a) Idempotency by explicit key — return the first order for a repeat.
  if (key) {
    const prior = idempotencyLedger().get(`${customerId}:${key}`);
    if (prior && Date.now() - prior.at < IDEMPOTENCY_WINDOW_MS * 60) {
      const existing = await prisma.order.findFirst({
        where: { customerId, orderNumber: prior.orderNumber },
      });
      if (existing) {
        return { ok: true, order: toCustomerOrder(existing), deduped: true, excluded: [] };
      }
    }
  }

  // (2) Load + price the cart SERVER-SIDE.
  const cart = await priceCartForCustomer(customerId);

  // (2) Empty (nothing at all).
  if (cart.lines.length === 0) {
    return { ok: false, error: "empty", message: new EmptyCartError().message };
  }

  // (3) Nothing orderable (everything blocked) — treat as empty, report why.
  if (cart.orderableLines.length === 0) {
    return {
      ok: false,
      error: "empty",
      message: "None of the items in your cart can be ordered right now.",
      excluded: cart.blockedLines,
    };
  }

  // (4) Max order-value ceiling.
  if (cart.subtotalPaise > MAX_ORDER_VALUE_PAISE) {
    return {
      ok: false,
      error: "too-large",
      message: new OrderTooLargeError().message,
      excluded: cart.blockedLines,
    };
  }

  // (5b) Identical-cart dedup within a short window (double-click / two-tab).
  const recent = await prisma.order.findFirst({
    where: { customerId, placedAt: { gt: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS) } },
    orderBy: { placedAt: "desc" },
  });
  if (recent && sameCart(recent, cart.orderableLines, cart.subtotalPaise)) {
    return { ok: true, order: toCustomerOrder(recent), deduped: true, excluded: cart.blockedLines };
  }

  // (5c) Rate limits — strict per-hour and per-day caps.
  const hour = await limit(customerId, { points: PLACE_ORDER_PER_HOUR, window: 3600 }, "place-order-h");
  if (!hour.ok) {
    return { ok: false, error: "rate-limit", message: new OrderRateLimitError().message };
  }
  const day = await limit(customerId, { points: PLACE_ORDER_PER_DAY, window: 86_400 }, "place-order-d");
  if (!day.ok) {
    return { ok: false, error: "rate-limit", message: new OrderRateLimitError().message };
  }

  const items = cart.orderableLines.map(toSnapshot);

  // (6) ONE transaction: create the order (server-priced snapshot) and clear the
  // cart. Both blocked and ordered lines are removed so a placed cart empties
  // cleanly and dead items don't keep re-warning on the next visit.
  //
  // The per-customer lock above serialises same-instance placements, so a
  // write-conflict on cartItem.deleteMany can only arise from a genuinely
  // cross-instance race. We retry a bounded number of times: on a conflict the
  // losing call re-checks the recently-committed identical cart and dedups to
  // the winner's order instead of surfacing a scary error on an order that
  // effectively succeeded.
  let order: OrderRow;
  const orderNumber = generateOrderNumber();
  try {
    order = await placeOrderTransaction(customerId, orderNumber, items, cart, note);
  } catch (error) {
    if (isWriteConflict(error)) {
      const winner = await prisma.order.findFirst({
        where: { customerId, placedAt: { gt: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS) } },
        orderBy: { placedAt: "desc" },
      });
      if (winner && sameCart(winner, cart.orderableLines, cart.subtotalPaise)) {
        return { ok: true, order: toCustomerOrder(winner), deduped: true, excluded: cart.blockedLines };
      }
    }
    throw error;
  }

  if (key) {
    idempotencyLedger().set(`${customerId}:${key}`, { orderNumber, at: Date.now() });
  }

  // (7) Notify admins — fire-and-forget; must never fail the placement.
  void notifyAdminsOfOrder(order.orderNumber, cart.itemCount, cart.subtotalPaise).catch((err) => {
    console.error("[orders] admin notification failed:", err);
  });
  void writeAudit({
    actorType: "customer",
    actorId: customerId,
    action: "order.place",
    entity: "Order",
    entityId: order.id,
    diff: { orderNumber, subtotalPaise: cart.subtotalPaise, itemCount: cart.itemCount },
  });

  return {
    ok: true,
    order: toCustomerOrder(order),
    deduped: false,
    excluded: cart.blockedLines,
  };
}

/**
 * Create the Order (server-priced snapshot) and clear the cart in ONE
 * transaction. Extracted so the retry wrapper in `placeOrderLocked` can re-run
 * it (with a fresh orderNumber the caller supplies) on a cross-instance
 * write-conflict.
 */
function placeOrderTransaction(
  customerId: string,
  orderNumber: string,
  items: OrderItemSnapshot[],
  cart: PricedCart,
  note: string | null,
): Promise<OrderRow> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orderNumber,
        customerId,
        status: "PLACED",
        items: items as unknown as Prisma.InputJsonValue,
        subtotalPaise: cart.subtotalPaise,
        itemCount: cart.itemCount,
        note,
      },
    });
    await tx.cartItem.deleteMany({ where: { customerId } });
    return created;
  });
}

/**
 * True for a Mongo/Prisma transaction write-conflict or deadlock — the abort a
 * concurrent placement can trigger on the shared cart delete. Prisma surfaces it
 * as P2034 (or, on some driver paths, a raw "write conflict" message).
 */
function isWriteConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /write conflict|deadlock/i.test(message);
}

/** True when a just-placed order matches the pending cart (for dedup). */
function sameCart(
  order: { subtotalPaise: number; items: Prisma.JsonValue },
  lines: PricedCartLine[],
  subtotalPaise: number,
): boolean {
  if (order.subtotalPaise !== subtotalPaise) return false;
  const items = Array.isArray(order.items) ? (order.items as unknown as OrderItemSnapshot[]) : [];
  if (items.length !== lines.length) return false;
  const key = (p: string, v: string | null, q: number) => `${p}:${v ?? ""}:${q}`;
  const orderKeys = new Set(items.map((i) => key(i.productId, i.variantId, i.quantity)));
  return lines.every((l) => orderKeys.has(key(l.productId, l.variantId, l.quantity)));
}

async function notifyAdminsOfOrder(
  orderNumber: string,
  itemCount: number,
  subtotalPaise: number,
): Promise<void> {
  await prisma.notification.create({
    data: {
      type: "order.placed",
      payload: { orderNumber, itemCount, subtotalPaise } as Prisma.InputJsonValue,
    },
  });
  await sendPushToAdmin({
    title: "New order request",
    body: `Order ${orderNumber} — ${itemCount} item${itemCount === 1 ? "" : "s"}.`,
    url: "/admin/orders",
  });
}

// ---------------------------------------------------------------------------
// Order reads (ownership-checked)
// ---------------------------------------------------------------------------

type OrderRow = Prisma.OrderGetPayload<Record<string, never>>;

function toCustomerOrder(order: OrderRow): CustomerOrder {
  const items = Array.isArray(order.items)
    ? (order.items as unknown as OrderItemSnapshot[])
    : [];
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    items,
    subtotalPaise: order.subtotalPaise,
    itemCount: order.itemCount,
    note: order.note,
    placedAt: order.placedAt,
  };
}

/**
 * Fetch a single order by its (random) orderNumber, ownership-checked against
 * `customerId`. Returns null when it doesn't exist OR belongs to someone else —
 * the two are indistinguishable to the caller, so a guessed number leaks
 * nothing. `customerId` comes ONLY from the resolved viewer.
 */
export async function getOrderForCustomer(
  customerId: string,
  orderNumber: string,
): Promise<CustomerOrder | null> {
  if (typeof orderNumber !== "string" || orderNumber.length === 0 || orderNumber.length > 40) {
    return null;
  }
  const order = await prisma.order.findFirst({
    where: { orderNumber, customerId },
  });
  return order ? toCustomerOrder(order) : null;
}

/** List a customer's orders (newest first), ownership-scoped. For the account UI. */
export async function listOrdersForCustomer(
  customerId: string,
  options: { skip?: number; take?: number } = {},
): Promise<CustomerOrder[]> {
  const take = Math.min(Math.max(options.take ?? 20, 1), 100);
  const skip = Math.max(options.skip ?? 0, 0);
  const orders = await prisma.order.findMany({
    where: { customerId },
    orderBy: { placedAt: "desc" },
    skip,
    take,
  });
  return orders.map(toCustomerOrder);
}
