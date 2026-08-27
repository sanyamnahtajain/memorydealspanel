"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { OrderStatus } from "@prisma/client";

import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import { notifyCustomer } from "@/server/notify/push";
import { ORDER_STATUS_LABEL } from "@/components/storefront/orders/order-status";
import { objectIdSchema } from "@/lib/schemas/shared";
import { PAGE_SIZES } from "@/lib/constants";
import {
  countOrders,
  getOrder,
  listOrders,
  orderStatusCounts,
  orderVolumeByCustomer,
  setAdminNote,
  setOrderStatus,
  setOrderTracking,
  type OrderDetail,
  type OrderListItem,
  type CustomerOrderVolume,
} from "@/server/services/admin-orders";
import type { OrderAccessExtension } from "@/server/services/admin-orders";
import { retractOrderAccessExtension } from "@/server/services/admin-orders";
import type { DeliveryDisclosure } from "@/lib/delivery";
import {
  trackingInputSchema,
  trackingPushBody,
  type OrderTracking,
} from "@/lib/tracking";
import {
  toOrderBillingView,
  type OrderBillingView,
} from "@/components/orders/billing/types";

/**
 * Admin order actions — the admin queue's mutating + read surface.
 *
 * Thin transport wrappers over `@/server/services/admin-orders`:
 *   assertAdmin → assertPermission → zod → service → audit/notify → revalidate.
 * Never throws to the client; failures return a typed `{ ok:false, error }`.
 *
 * AUTHZ: orders are gated on `CUSTOMERS_VIEW` for reads and `CUSTOMERS_EDIT`
 * for mutations (there is no dedicated orders permission in the catalog yet;
 * reusing the customers capabilities keeps the queue owner-only + role-config-
 * urable without a schema change). Every mutation is audited.
 */

export type ActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const ACTOR = "admin" as const;

/* ------------------------------------------------------------------ */
/* client DTOs (JSON-serializable — Dates → ISO strings)               */
/* ------------------------------------------------------------------ */

export interface OrderCustomerDTO {
  id: string;
  businessName: string;
  contactName: string;
  phone: string;
  city: string | null;
}

export interface OrderRowDTO {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  itemCount: number;
  subtotalPaise: number;
  placedAt: string;
  updatedAt: string;
  /** ISO timestamp of the transition into FULFILLED; null until then. */
  fulfilledAt: string | null;
  customer: OrderCustomerDTO | null;
}

export interface OrderLineTaxDTO {
  hsnCode: string | null;
  gstRateBps: number;
  taxInclusive: boolean;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  grossPaise: number;
}

export interface OrderLineDTO {
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
  /** Frozen per-line GST breakup; null for a pre-GST order. */
  tax: OrderLineTaxDTO | null;
  /** Frozen per-model split for allocation lines, when present. */
  breakdown: { modelName: string; qty: number }[] | null;
  /** Frozen customer requirement note, when present. */
  note: string | null;
  /** Frozen customer requirement photos, when present. */
  attachments: { url: string }[] | null;
}

/** One HSN summary row for the invoice-style tax table. */
export interface OrderHsnRowDTO {
  hsnCode: string | null;
  gstRateBps: number;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

/** The frozen order-level GST snapshot, serialized for the admin view. */
export interface OrderTaxDTO {
  supplyType: "INTRA" | "INTER" | null;
  sellerStateCode: string | null;
  sellerGstin: string | null;
  placeOfSupplyStateCode: string | null;
  totalTaxablePaise: number;
  totalCgstPaise: number;
  totalSgstPaise: number;
  totalIgstPaise: number;
  totalTaxPaise: number;
  roundOffPaise: number;
  grandTotalPaise: number;
  hsnSummary: OrderHsnRowDTO[];
}

export interface OrderDetailDTO extends OrderRowDTO {
  /** Coupon frozen at placement, when one applied. */
  couponCode: string | null;
  /** Order-level discount (paise); 0 when none. */
  discountPaise: number;
  items: OrderLineDTO[];
  note: string | null;
  adminNote: string | null;
  /** Frozen order-level GST snapshot, or null for a pre-GST order. */
  tax: OrderTaxDTO | null;
  /** Frozen billing buckets + bucket discounts, or null for a pre-feature order. */
  billing: OrderBillingView | null;
  /** Frozen delivery disclosure shown to the buyer at placement, or null. */
  delivery: DeliveryDisclosure | null;
  /** The delivery CHARGE frozen at placement (paise); 0 when none. */
  deliveryChargePaise: number;
  /** The +N-days access grant this order triggered (anti-abuse view), or null. */
  accessExtension: OrderAccessExtension | null;
  /** Courier tracking saved on this order, or null when not attached yet. */
  tracking: OrderTracking | null;
}

function toRowDTO(item: OrderListItem): OrderRowDTO {
  return {
    id: item.id,
    orderNumber: item.orderNumber,
    status: item.status,
    itemCount: item.itemCount,
    subtotalPaise: item.subtotalPaise,
    placedAt: item.placedAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    fulfilledAt: item.fulfilledAt ? item.fulfilledAt.toISOString() : null,
    customer: item.customer
      ? {
          id: item.customer.id,
          businessName: item.customer.businessName,
          contactName: item.customer.contactName,
          phone: item.customer.phone,
          city: item.customer.city,
        }
      : null,
  };
}

function toDetailDTO(detail: OrderDetail): OrderDetailDTO {
  return {
    ...toRowDTO(detail),
    couponCode: detail.couponCode,
    discountPaise: detail.discountPaise,
    items: detail.items.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      name: line.name,
      sku: line.sku,
      brand: line.brand,
      variantLabel: line.variantLabel,
      imageUrl: line.imageUrl,
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
      lineTotalPaise: line.lineTotalPaise,
      breakdown: line.breakdown ?? null,
      note: line.note ?? null,
      attachments: line.attachments ?? null,
      tax: line.tax
        ? {
            hsnCode: line.tax.hsnCode,
            gstRateBps: line.tax.gstRateBps,
            taxInclusive: line.tax.treatment === "TAX_INCLUSIVE",
            taxablePaise: line.tax.taxablePaise,
            taxPaise: line.tax.taxPaise,
            cgstPaise: line.tax.cgstPaise,
            sgstPaise: line.tax.sgstPaise,
            igstPaise: line.tax.igstPaise,
            grossPaise: line.tax.grossPaise,
          }
        : null,
    })),
    note: detail.note,
    adminNote: detail.adminNote,
    tax: detail.tax
      ? {
          supplyType: detail.tax.supplyType,
          sellerStateCode: detail.tax.sellerStateCode,
          sellerGstin: detail.tax.sellerGstin,
          placeOfSupplyStateCode: detail.tax.placeOfSupplyStateCode,
          totalTaxablePaise: detail.tax.totalTaxablePaise,
          totalCgstPaise: detail.tax.totalCgstPaise,
          totalSgstPaise: detail.tax.totalSgstPaise,
          totalIgstPaise: detail.tax.totalIgstPaise,
          totalTaxPaise: detail.tax.totalTaxPaise,
          roundOffPaise: detail.tax.roundOffPaise,
          grandTotalPaise: detail.tax.grandTotalPaise,
          hsnSummary: detail.tax.hsnSummary.map((r) => ({
            hsnCode: r.hsnCode,
            gstRateBps: r.gstRateBps,
            taxablePaise: r.taxablePaise,
            taxPaise: r.taxPaise,
            cgstPaise: r.cgstPaise,
            sgstPaise: r.sgstPaise,
            igstPaise: r.igstPaise,
          })),
        }
      : null,
    billing: toOrderBillingView(detail.billing, detail.orderNumber),
    delivery: detail.delivery,
    deliveryChargePaise: detail.deliveryChargePaise,
    accessExtension: detail.accessExtension,
    tracking: detail.tracking,
  };
}

/* ------------------------------------------------------------------ */
/* input schemas                                                       */
/* ------------------------------------------------------------------ */

const orderStatusSchema = z.enum([
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "FULFILLED",
  "CANCELLED",
]);

const listSchema = z
  .object({
    status: orderStatusSchema.optional(),
    customer: z.string().trim().max(120).optional(),
    page: z.number().int().positive().default(1),
    take: z
      .number()
      .int()
      .positive()
      .max(PAGE_SIZES.max)
      .default(PAGE_SIZES.admin),
  })
  .prefault({});
export type ListOrdersInput = z.input<typeof listSchema>;

const setStatusSchema = z.object({
  id: objectIdSchema,
  status: orderStatusSchema,
});

const adminNoteSchema = z.object({
  id: objectIdSchema,
  note: z.string().trim().max(2000).nullable(),
});

const setTrackingSchema = z.object({
  id: objectIdSchema,
  tracking: trackingInputSchema,
});

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
    console.error("[actions/admin-orders] unexpected error:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

function revalidate(): void {
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
}

/* ------------------------------------------------------------------ */
/* list (queue)                                                        */
/* ------------------------------------------------------------------ */

export interface ListOrdersResult {
  orders: OrderRowDTO[];
  counts: Record<OrderStatus, number>;
  newCount: number;
  total: number;
  page: number;
  pageCount: number;
}

export async function listOrdersAction(
  input: ListOrdersInput = {},
): Promise<ActionResult<ListOrdersResult>> {
  return guarded(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_VIEW);

    const params = listSchema.parse(input);
    const take = params.take;
    const skip = (params.page - 1) * take;

    const [items, total, counts] = await Promise.all([
      listOrders({
        status: params.status,
        customer: params.customer,
        take,
        skip,
      }),
      countOrders({ status: params.status, customer: params.customer }),
      orderStatusCounts(),
    ]);

    return {
      ok: true,
      orders: items.map(toRowDTO),
      counts,
      newCount: counts.PLACED,
      total,
      page: params.page,
      pageCount: Math.max(1, Math.ceil(total / take)),
    };
  });
}

/* ------------------------------------------------------------------ */
/* detail                                                              */
/* ------------------------------------------------------------------ */

export async function getOrderAction(
  id: string,
): Promise<ActionResult<{ order: OrderDetailDTO }>> {
  return guarded<{ order: OrderDetailDTO }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_VIEW);

    const orderId = objectIdSchema.parse(id);
    const detail = await getOrder(orderId);
    if (!detail) {
      return { ok: false, error: "Order not found." };
    }

    // Reading a specific order (with buyer contact + full snapshot) is an
    // explicit, audited admin access — mirrors the customer-drawer audit.
    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "order.view",
      entity: "Order",
      entityId: orderId,
    });

    return { ok: true, order: toDetailDTO(detail) };
  });
}

/* ------------------------------------------------------------------ */
/* status change (custom control, never native select)                */
/* ------------------------------------------------------------------ */

export async function setOrderStatusAction(
  input: z.input<typeof setStatusSchema>,
): Promise<ActionResult<{ id: string; status: OrderStatus }>> {
  return guarded<{ id: string; status: OrderStatus }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_EDIT);

    const { id, status } = setStatusSchema.parse(input);
    const result = await setOrderStatus(id, status);
    if (!result.ok) {
      return {
        ok: false,
        error:
          result.reason === "not-found"
            ? "Order not found."
            : "That status change isn't allowed from the current state.",
      };
    }

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "order.status",
      entity: "Order",
      entityId: id,
      diff: { from: result.from, to: status },
    });

    // Notify the customer of the transition (in-app Notification feed). The
    // buyer sees the change on their order-history page.
    await prisma.notification
      .create({
        data: {
          type: "order.status",
          payload: {
            orderId: id,
            orderNumber: result.orderNumber,
            customerId: result.customerId,
            from: result.from,
            to: status,
          },
        },
      })
      .catch((error) => {
        console.error("[actions/admin-orders] notify failed:", error);
      });

    // …and push it to their phone, so the buyer learns about the change
    // without opening the app. Fire-and-forget: the status is already
    // committed and a push must never fail the admin's action. Labels come
    // from ORDER_STATUS_LABEL so the notification, the chip and the timeline
    // all say the same word.
    void notifyCustomer(result.customerId, "order.status", {
      title: `Order ${result.orderNumber}`,
      body: `Your order is now ${ORDER_STATUS_LABEL[status]}.`,
      url: `/account/orders/${result.orderNumber}`,
      // One tag per order: three status changes replace each other rather
      // than stacking three cards on the buyer's lock screen.
      tag: `order.status:${result.orderNumber}`,
    }).catch((error) => {
      console.error("[actions/admin-orders] status push failed:", error);
    });

    revalidate();
    return { ok: true, id, status };
  });
}

/* ------------------------------------------------------------------ */
/* admin note                                                          */
/* ------------------------------------------------------------------ */

export async function setOrderAdminNoteAction(
  input: z.input<typeof adminNoteSchema>,
): Promise<ActionResult<{ id: string }>> {
  return guarded<{ id: string }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_EDIT);

    const { id, note } = adminNoteSchema.parse(input);
    const updated = await setAdminNote(id, note);
    if (!updated) {
      return { ok: false, error: "Order not found." };
    }

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "order.adminNote",
      entity: "Order",
      entityId: id,
    });

    revalidate();
    return { ok: true, id };
  });
}

/* ------------------------------------------------------------------ */
/* courier tracking                                                    */
/* ------------------------------------------------------------------ */

/**
 * Attach (or edit) the courier tracking record on an order. The FIRST save
 * with usable tracking also pushes "Your order is on the way" to the buyer;
 * later edits update the record silently.
 */
export async function setOrderTrackingAction(
  input: z.input<typeof setTrackingSchema>,
): Promise<ActionResult<{ id: string; tracking: OrderTracking }>> {
  return guarded<{ id: string; tracking: OrderTracking }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_EDIT);

    const { id, tracking } = setTrackingSchema.parse(input);
    const result = await setOrderTracking(id, tracking);
    if (!result.ok) {
      return { ok: false, error: "Order not found." };
    }

    const saved: OrderTracking = {
      courierName: tracking.courierName ?? null,
      trackingId: tracking.trackingId ?? null,
      url: tracking.url ?? null,
    };

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "order.tracking",
      entity: "Order",
      entityId: id,
      diff: {
        courierName: saved.courierName,
        trackingId: saved.trackingId,
        url: saved.url,
      },
    });

    // First tracking on this order → tell the buyer their parcel shipped.
    // Fire-and-forget: the record is already committed and a push failure
    // must never fail the admin's save (same pattern as the status push).
    if (result.firstTime) {
      void notifyCustomer(result.customerId, "order.status", {
        title: "Your order is on the way",
        body: trackingPushBody(saved),
        url: `/account/orders/${result.orderNumber}`,
        tag: `order.tracking:${result.orderNumber}`,
      }).catch((error) => {
        console.error("[actions/admin-orders] tracking push failed:", error);
      });
    }

    revalidate();
    return { ok: true, id, tracking: saved };
  });
}

/* ------------------------------------------------------------------ */
/* abuse view (orders-per-customer velocity)                           */
/* ------------------------------------------------------------------ */

export interface CustomerVolumeDTO {
  customer: OrderCustomerDTO;
  totalOrders: number;
  last24h: number;
  totalValuePaise: number;
  lastPlacedAt: string;
}

function toVolumeDTO(v: CustomerOrderVolume): CustomerVolumeDTO {
  return {
    customer: {
      id: v.customer.id,
      businessName: v.customer.businessName,
      contactName: v.customer.contactName,
      phone: v.customer.phone,
      city: v.customer.city,
    },
    totalOrders: v.totalOrders,
    last24h: v.last24h,
    totalValuePaise: v.totalValuePaise,
    lastPlacedAt: v.lastPlacedAt.toISOString(),
  };
}

export async function orderAbuseViewAction(
  limit = 20,
): Promise<ActionResult<{ rows: CustomerVolumeDTO[] }>> {
  return guarded<{ rows: CustomerVolumeDTO[] }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_VIEW);

    const rows = await orderVolumeByCustomer(limit);
    return { ok: true, rows: rows.map(toVolumeDTO) };
  });
}

/**
 * Roll back the +N-days access extension an order granted (anti-abuse, owner
 * request): available from the order page — typically after cancelling a junk
 * order placed only to farm access time.
 */
const retractSchema = z.object({ id: objectIdSchema });

export async function retractAccessExtensionAction(
  input: z.input<typeof retractSchema>,
): Promise<ActionResult<{ done: boolean }>> {
  return guarded<{ done: boolean }>(async () => {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.CUSTOMERS_APPROVE);

    const { id } = retractSchema.parse(input);
    const result = await retractOrderAccessExtension(id);
    if (!result.ok) {
      switch (result.reason) {
        case "NOT_FOUND":
          return { ok: false, error: "Order not found." };
        case "NO_EXTENSION":
          return { ok: false, error: "This order didn't grant extra access." };
        case "ALREADY_RETRACTED":
          return { ok: false, error: "The extra days were already removed." };
        default:
          return {
            ok: false,
            error: "The customer has no finite access period right now.",
          };
      }
    }

    await writeAudit({
      actorType: ACTOR,
      actorId: viewer.adminId,
      action: "access.retractExtension",
      entity: "Order",
      entityId: id,
      diff: { expiresAt: result.expiresAt?.toISOString() ?? null },
    });
    revalidatePath("/admin/orders");
    revalidatePath("/admin/customers");
    return { ok: true, done: true };
  });
}
