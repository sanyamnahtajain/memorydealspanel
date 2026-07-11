import { Prisma } from "@prisma/client";
import type { OrderStatus } from "@prisma/client";

import { prisma } from "@/server/db";
import { canTransition } from "@/components/storefront/orders/order-status";

/**
 * Order service layer — reads and status management over the `Order`
 * collection, plus the shared order-snapshot types used by BOTH the admin
 * queue and the customer order-history views.
 *
 * This is transport-agnostic. Authorization (admin permission / customer
 * ownership), validation, rate-limiting, audit and revalidation live in the
 * action layer:
 *   - admin  → `@/server/actions/admin-orders`
 *   - buyer  → `src/app/(storefront)/account/orders/actions.ts`
 *
 * ANTI-CHEAT NOTE: an `Order` is an immutable, server-computed snapshot. Every
 * line's `unitPricePaise` / `lineTotalPaise` was resolved at placement from the
 * viewer-gated DAL, so nothing here trusts (or re-reads) a live catalog price.
 * These reads only ever project the frozen snapshot.
 */

/* ----------------------------------------------------------------------- */
/* Order snapshot shape (Order.items JSON)                                 */
/* ----------------------------------------------------------------------- */

/**
 * One frozen line in an `Order.items` snapshot. Written at placement (C2) and
 * read verbatim here — later catalog edits never mutate a placed order.
 *
 * `productId` / `variantId` are retained ONLY so "reorder" can re-resolve the
 * item against the live, gated catalog (re-checking availability + the current
 * entitled price). They are never used to recompute this order's totals.
 */
export interface OrderItemSnapshot {
  productId: string;
  variantId: string | null;
  /** Product name at placement time. */
  name: string;
  sku: string;
  /** Brand label at placement time (free-text or master name), when known. */
  brand: string | null;
  /** Human variant label, e.g. "20000mAh · Black". Null for simple products. */
  variantLabel: string | null;
  /** Primary image thumbnail at placement, for the history views. */
  imageUrl: string | null;
  quantity: number;
  /** Entitled unit price (paise) frozen at placement. */
  unitPricePaise: number;
  /** quantity × unitPricePaise (paise), frozen at placement. */
  lineTotalPaise: number;
}

/**
 * Runtime coercion of the `Order.items` JSON blob into a typed, defensively
 * validated snapshot array. A malformed/legacy line is dropped rather than
 * throwing, so a single bad row never blanks an entire order view.
 */
export function parseOrderItems(raw: Prisma.JsonValue): OrderItemSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: OrderItemSnapshot[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const o = entry as Record<string, unknown>;
    const productId = typeof o.productId === "string" ? o.productId : null;
    const name = typeof o.name === "string" ? o.name : null;
    const sku = typeof o.sku === "string" ? o.sku : "";
    const quantity =
      typeof o.quantity === "number" && Number.isSafeInteger(o.quantity)
        ? o.quantity
        : null;
    const unitPricePaise =
      typeof o.unitPricePaise === "number" &&
      Number.isSafeInteger(o.unitPricePaise)
        ? o.unitPricePaise
        : null;
    if (productId === null || name === null || quantity === null || unitPricePaise === null) {
      continue;
    }
    const lineTotalPaise =
      typeof o.lineTotalPaise === "number" &&
      Number.isSafeInteger(o.lineTotalPaise)
        ? o.lineTotalPaise
        : unitPricePaise * quantity;
    out.push({
      productId,
      variantId: typeof o.variantId === "string" ? o.variantId : null,
      name,
      sku,
      brand: typeof o.brand === "string" ? o.brand : null,
      variantLabel: typeof o.variantLabel === "string" ? o.variantLabel : null,
      imageUrl: typeof o.imageUrl === "string" ? o.imageUrl : null,
      quantity,
      unitPricePaise,
      lineTotalPaise,
    });
  }
  return out;
}

/* ----------------------------------------------------------------------- */
/* Serialized read shapes                                                  */
/* ----------------------------------------------------------------------- */

/** Compact customer summary embedded in admin order rows/detail. */
export interface OrderCustomerSummary {
  id: string;
  businessName: string;
  contactName: string;
  phone: string;
  city: string | null;
}

/** Row shape for the admin orders queue and the customer history list. */
export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  itemCount: number;
  subtotalPaise: number;
  placedAt: Date;
  updatedAt: Date;
  /** Present only on admin reads. */
  customer?: OrderCustomerSummary;
}

/** Full order detail (snapshot + notes + customer for admin). */
export interface OrderDetail extends OrderListItem {
  items: OrderItemSnapshot[];
  note: string | null;
  adminNote: string | null;
}

const CUSTOMER_SUMMARY_SELECT = {
  id: true,
  businessName: true,
  contactName: true,
  phone: true,
  city: true,
} satisfies Prisma.CustomerSelect;

const LIST_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  itemCount: true,
  subtotalPaise: true,
  placedAt: true,
  updatedAt: true,
} satisfies Prisma.OrderSelect;

const ADMIN_LIST_SELECT = {
  ...LIST_SELECT,
  customer: { select: CUSTOMER_SUMMARY_SELECT },
} satisfies Prisma.OrderSelect;

type AdminListRow = Prisma.OrderGetPayload<{ select: typeof ADMIN_LIST_SELECT }>;

function toCustomerSummary(
  c: AdminListRow["customer"],
): OrderCustomerSummary {
  return {
    id: c.id,
    businessName: c.businessName,
    contactName: c.contactName,
    phone: c.phone,
    city: c.city ?? null,
  };
}

function toAdminListItem(row: AdminListRow): OrderListItem {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    itemCount: row.itemCount,
    subtotalPaise: row.subtotalPaise,
    placedAt: row.placedAt,
    updatedAt: row.updatedAt,
    customer: toCustomerSummary(row.customer),
  };
}

/* ----------------------------------------------------------------------- */
/* Admin: list / count / detail                                            */
/* ----------------------------------------------------------------------- */

export interface ListOrdersFilter {
  /** Restrict to a single status. */
  status?: OrderStatus;
  /** Case-insensitive match on business/contact name, phone, or orderNumber. */
  customer?: string;
  /** Max rows to return. */
  take?: number;
  /** Rows to skip (offset pagination). */
  skip?: number;
}

/** Build the admin WHERE clause shared by list + count so they stay in sync. */
function buildAdminWhere(
  filter: Pick<ListOrdersFilter, "status" | "customer">,
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  if (filter.status) {
    where.status = filter.status;
  }
  const q = filter.customer?.trim();
  if (q) {
    where.OR = [
      { orderNumber: { contains: q, mode: "insensitive" } },
      {
        customer: {
          is: {
            OR: [
              { businessName: { contains: q, mode: "insensitive" } },
              { contactName: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }
  return where;
}

/** List orders for the admin queue, newest first, with customer summaries. */
export async function listOrders(
  filter: ListOrdersFilter = {},
): Promise<OrderListItem[]> {
  const rows = await prisma.order.findMany({
    where: buildAdminWhere(filter),
    select: ADMIN_LIST_SELECT,
    orderBy: { placedAt: "desc" },
    take: filter.take,
    skip: filter.skip,
  });
  return rows.map(toAdminListItem);
}

/** Count orders matching the same filter (for pagination). */
export async function countOrders(
  filter: Pick<ListOrdersFilter, "status" | "customer"> = {},
): Promise<number> {
  return prisma.order.count({ where: buildAdminWhere(filter) });
}

/** Aggregate order counts per status (for the queue header + new-badge). */
export async function orderStatusCounts(): Promise<Record<OrderStatus, number>> {
  const grouped = await prisma.order.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const counts: Record<OrderStatus, number> = {
    PLACED: 0,
    CONFIRMED: 0,
    PROCESSING: 0,
    FULFILLED: 0,
    CANCELLED: 0,
  };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
  }
  return counts;
}

/** New-orders badge count (freshly PLACED, awaiting the wholesaler). */
export async function newOrderCount(): Promise<number> {
  return prisma.order.count({ where: { status: "PLACED" } });
}

/**
 * Full order detail for the admin drawer. Reads the frozen snapshot + both
 * notes + the customer summary. Admin-only (authorization at the action layer).
 */
export async function getOrder(id: string): Promise<OrderDetail | null> {
  const row = await prisma.order.findUnique({
    where: { id },
    select: {
      ...ADMIN_LIST_SELECT,
      items: true,
      note: true,
      adminNote: true,
    },
  });
  if (!row) return null;
  return {
    ...toAdminListItem(row),
    items: parseOrderItems(row.items),
    note: row.note ?? null,
    adminNote: row.adminNote ?? null,
  };
}

/* ----------------------------------------------------------------------- */
/* Admin: status transitions + notes                                       */
/* ----------------------------------------------------------------------- */

/**
 * The transition table lives in the client-safe `order-status` module (so the
 * custom admin status control can import it too); the service re-exports it and
 * enforces it authoritatively here.
 */
export {
  ORDER_STATUS_TRANSITIONS,
  canTransition,
} from "@/components/storefront/orders/order-status";

/**
 * Apply an admin status change, guarded by the transition table so an order
 * can't be moved backwards or out of a terminal state. Returns the previous
 * status (for audit) + the customer id (for the notification), or `null` when
 * the order doesn't exist or the transition is illegal.
 */
export async function setOrderStatus(
  id: string,
  next: OrderStatus,
): Promise<
  | { ok: true; from: OrderStatus; customerId: string; orderNumber: string }
  | { ok: false; reason: "not-found" | "illegal" }
> {
  const current = await prisma.order.findUnique({
    where: { id },
    select: { status: true, customerId: true, orderNumber: true },
  });
  if (!current) return { ok: false, reason: "not-found" };
  if (!canTransition(current.status, next)) {
    return { ok: false, reason: "illegal" };
  }
  await prisma.order.update({ where: { id }, data: { status: next } });
  return {
    ok: true,
    from: current.status,
    customerId: current.customerId,
    orderNumber: current.orderNumber,
  };
}

/** Set (or clear, with null) the private admin note on an order. */
export async function setAdminNote(
  id: string,
  note: string | null,
): Promise<boolean> {
  const trimmed = note && note.trim() !== "" ? note.trim() : null;
  const result = await prisma.order.updateMany({
    where: { id },
    data: { adminNote: trimmed },
  });
  return result.count > 0;
}

/* ----------------------------------------------------------------------- */
/* Admin: abuse view (orders-per-customer)                                 */
/* ----------------------------------------------------------------------- */

export interface CustomerOrderVolume {
  customer: OrderCustomerSummary;
  /** Total orders ever placed by this customer. */
  totalOrders: number;
  /** Orders placed in the trailing 24h (velocity signal). */
  last24h: number;
  /** Sum of subtotals across all their orders (paise). */
  totalValuePaise: number;
  /** Most recent placement. */
  lastPlacedAt: Date;
}

/**
 * Abuse / velocity view: the busiest customers by order volume, with a
 * trailing-24h count to surface rapid repeat placement. Ordered by 24h
 * velocity then lifetime volume so suspicious spikes float to the top.
 */
export async function orderVolumeByCustomer(
  limit = 20,
): Promise<CustomerOrderVolume[]> {
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const grouped = await prisma.order.groupBy({
    by: ["customerId"],
    _count: { _all: true },
    _sum: { subtotalPaise: true },
    _max: { placedAt: true },
    orderBy: { _count: { customerId: "desc" } },
    take: Math.max(1, Math.min(100, limit)),
  });
  if (grouped.length === 0) return [];

  const customerIds = grouped.map((g) => g.customerId);
  const [customers, recent] = await Promise.all([
    prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: CUSTOMER_SUMMARY_SELECT,
    }),
    prisma.order.groupBy({
      by: ["customerId"],
      where: { customerId: { in: customerIds }, placedAt: { gte: dayAgo } },
      _count: { _all: true },
    }),
  ]);

  const byId = new Map(customers.map((c) => [c.id, c]));
  const recentById = new Map(recent.map((r) => [r.customerId, r._count._all]));

  const rows: CustomerOrderVolume[] = [];
  for (const g of grouped) {
    const c = byId.get(g.customerId);
    if (!c) continue; // customer deleted — skip
    rows.push({
      customer: toCustomerSummary(c),
      totalOrders: g._count._all,
      last24h: recentById.get(g.customerId) ?? 0,
      totalValuePaise: g._sum.subtotalPaise ?? 0,
      lastPlacedAt: g._max.placedAt ?? new Date(0),
    });
  }
  rows.sort(
    (a, b) => b.last24h - a.last24h || b.totalOrders - a.totalOrders,
  );
  return rows;
}

/* ----------------------------------------------------------------------- */
/* Customer-scoped reads (order history — IDOR-safe)                       */
/* ----------------------------------------------------------------------- */

/**
 * List a SINGLE customer's orders, newest first. The `customerId` MUST come
 * from the resolved viewer session (never the URL) — this is the IDOR gate.
 */
export async function listCustomerOrders(
  customerId: string,
  options: { take?: number; skip?: number } = {},
): Promise<OrderListItem[]> {
  const rows = await prisma.order.findMany({
    where: { customerId },
    select: LIST_SELECT,
    orderBy: { placedAt: "desc" },
    take: options.take,
    skip: options.skip,
  });
  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    itemCount: row.itemCount,
    subtotalPaise: row.subtotalPaise,
    placedAt: row.placedAt,
    updatedAt: row.updatedAt,
  }));
}

/** Count a single customer's orders (pagination). */
export async function countCustomerOrders(customerId: string): Promise<number> {
  return prisma.order.count({ where: { customerId } });
}

/**
 * Fetch one order by its public `orderNumber`, SCOPED to the owning customer.
 * Ownership is enforced in the WHERE clause (customerId + orderNumber), so a
 * customer can never read another customer's order even by guessing a number.
 * Returns the frozen snapshot + the buyer-visible note (never `adminNote`).
 */
export async function getCustomerOrderByNumber(
  customerId: string,
  orderNumber: string,
): Promise<Omit<OrderDetail, "customer" | "adminNote"> | null> {
  const row = await prisma.order.findFirst({
    where: { customerId, orderNumber },
    select: {
      ...LIST_SELECT,
      items: true,
      note: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    itemCount: row.itemCount,
    subtotalPaise: row.subtotalPaise,
    placedAt: row.placedAt,
    updatedAt: row.updatedAt,
    items: parseOrderItems(row.items),
    note: row.note ?? null,
  };
}
