import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";

/**
 * "Who bought this product?" — the follow-up read behind the admin product
 * page's Buyers panel, the orders queue's product filter and the broadcast
 * composer's "bought a product" audience.
 *
 * Order lines are a frozen JSON snapshot (`Order.items`), and Prisma cannot
 * filter inside JSON on MongoDB, so the match runs as a raw Mongo filter on
 * `items.productId` — index-free but bounded: a product appears in a few
 * hundred orders at most. Everything else is plain Prisma. Pure aggregation
 * is exported for tests.
 */

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** The slice of a raw order document this module reads. */
export interface RawOrderDoc {
  _id?: { $oid?: string } | string;
  customerId?: { $oid?: string } | string;
  orderNumber?: string;
  status?: string;
  placedAt?: { $date?: string | { $numberLong?: string } } | string;
  items?: unknown;
}

export interface BuyerAggregate {
  customerId: string;
  orders: number;
  units: number;
  lastOrderAt: Date;
  lastOrderNumber: string;
}

export interface ProductBuyer extends BuyerAggregate {
  businessName: string;
  contactName: string;
  phone: string;
  city: string | null;
  status: string;
}

export interface ProductBuyersResult {
  /** Distinct buyers, newest purchase first. */
  buyers: ProductBuyer[];
  /** Non-cancelled orders that contained the product. */
  orders: number;
  /** Units of the product across those orders. */
  units: number;
}

function oid(value: RawOrderDoc["_id"]): string | null {
  if (typeof value === "string") return OBJECT_ID.test(value) ? value : null;
  const id = value?.$oid;
  return typeof id === "string" && OBJECT_ID.test(id) ? id : null;
}

function date(value: RawOrderDoc["placedAt"]): Date | null {
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const raw = value?.$date;
  if (typeof raw === "string") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const ms = raw?.$numberLong;
  return typeof ms === "string" ? new Date(Number(ms)) : null;
}

/** Units of `productId` in one order's frozen lines. */
export function unitsOfProduct(items: unknown, productId: string): number {
  if (!Array.isArray(items)) return 0;
  let units = 0;
  for (const line of items) {
    if (!line || typeof line !== "object") continue;
    const l = line as { productId?: unknown; quantity?: unknown };
    if (l.productId === productId && typeof l.quantity === "number") units += l.quantity;
  }
  return units;
}

/** Pure: fold raw order docs into one row per customer, newest purchase first. */
export function aggregateBuyers(docs: RawOrderDoc[], productId: string): {
  buyers: BuyerAggregate[];
  orders: number;
  units: number;
} {
  const byCustomer = new Map<string, BuyerAggregate>();
  let orders = 0;
  let units = 0;
  for (const doc of docs) {
    if (doc.status === "CANCELLED") continue;
    const customerId = oid(doc.customerId);
    const placedAt = date(doc.placedAt);
    if (!customerId || !placedAt) continue;
    const lineUnits = unitsOfProduct(doc.items, productId);
    orders += 1;
    units += lineUnits;
    const slot = byCustomer.get(customerId);
    if (!slot) {
      byCustomer.set(customerId, {
        customerId,
        orders: 1,
        units: lineUnits,
        lastOrderAt: placedAt,
        lastOrderNumber: typeof doc.orderNumber === "string" ? doc.orderNumber : "",
      });
    } else {
      slot.orders += 1;
      slot.units += lineUnits;
      if (placedAt > slot.lastOrderAt) {
        slot.lastOrderAt = placedAt;
        slot.lastOrderNumber = typeof doc.orderNumber === "string" ? doc.orderNumber : slot.lastOrderNumber;
      }
    }
  }
  const buyers = [...byCustomer.values()].sort((a, b) => b.lastOrderAt.getTime() - a.lastOrderAt.getTime());
  return { buyers, orders, units };
}

async function rawOrdersForProduct(productId: string, includeCancelled: boolean): Promise<RawOrderDoc[]> {
  if (!OBJECT_ID.test(productId)) return [];
  const filter: Prisma.InputJsonObject = includeCancelled
    ? { "items.productId": productId }
    : { "items.productId": productId, status: { $ne: "CANCELLED" } };
  const docs = (await prisma.order.findRaw({
    filter,
    options: { projection: { _id: 1, customerId: 1, orderNumber: 1, status: 1, placedAt: 1, items: 1 } },
  })) as unknown;
  return Array.isArray(docs) ? (docs as RawOrderDoc[]) : [];
}

/** Ids of every order whose lines include the product (cancelled included — the queue shows them). */
export async function orderIdsContainingProduct(productId: string): Promise<string[]> {
  const docs = await rawOrdersForProduct(productId, true);
  return docs.map((d) => oid(d._id)).filter((id): id is string => id !== null);
}

/** Customer ids who bought the product (non-cancelled), for the broadcast audience. */
export async function buyerCustomerIds(productId: string): Promise<string[]> {
  const docs = await rawOrdersForProduct(productId, false);
  return aggregateBuyers(docs, productId).buyers.map((b) => b.customerId);
}

/** The Buyers panel: who, how much, when last — with contact details. */
export async function productBuyers(productId: string, take = 50): Promise<ProductBuyersResult> {
  const docs = await rawOrdersForProduct(productId, false);
  const agg = aggregateBuyers(docs, productId);
  const top = agg.buyers.slice(0, take);
  if (top.length === 0) return { buyers: [], orders: agg.orders, units: agg.units };
  const customers = await prisma.customer.findMany({
    where: { id: { in: top.map((b) => b.customerId) } },
    select: { id: true, businessName: true, contactName: true, phone: true, city: true, status: true },
  });
  const byId = new Map(customers.map((c) => [c.id, c]));
  const buyers: ProductBuyer[] = [];
  for (const b of top) {
    const c = byId.get(b.customerId);
    if (!c) continue; // customer deleted since — nothing to follow up with
    buyers.push({ ...b, businessName: c.businessName, contactName: c.contactName, phone: c.phone, city: c.city ?? null, status: c.status });
  }
  return { buyers, orders: agg.orders, units: agg.units };
}
