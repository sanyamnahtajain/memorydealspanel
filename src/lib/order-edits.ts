import { z } from "zod";
import type { OrderStatus } from "@prisma/client";

import { objectIdSchema } from "@/lib/schemas/shared";

/**
 * Order editing — the client-safe rules and shapes.
 *
 * WHO MAY EDIT, AND WHEN:
 *  - A CUSTOMER may edit their own order only while it is PLACED — the same
 *    window in which they may cancel it. Once the wholesaler has confirmed,
 *    the order is a commitment on both sides and changes go through the shop.
 *  - An ADMIN may edit while the order is PLACED, CONFIRMED or PROCESSING.
 *    From DISPATCHED on, the parcel exists; a paper change to a physical
 *    shipment is how stock and money stop agreeing. CANCELLED and FULFILLED
 *    are terminal.
 *
 * WHAT AN EDIT IS: the full desired set of lines (quantity per line; a line
 * left out is removed; a line the order did not have is added), an optional
 * new customer note, and an optional reason recorded on the revision. The
 * server prices it — the client never sends money.
 *
 * Everything money-related lives in src/server/services/order-edits.ts.
 */

export const ADMIN_EDITABLE_STATUSES: readonly OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
];

export function canCustomerEditOrder(status: OrderStatus): boolean {
  return status === "PLACED";
}

export function canAdminEditOrder(status: OrderStatus): boolean {
  return ADMIN_EDITABLE_STATUSES.includes(status);
}

/** Why an order cannot be edited right now, in the words shown to people. */
export function orderNotEditableReason(
  status: OrderStatus,
  actor: "admin" | "customer",
): string | null {
  const allowed = actor === "admin" ? canAdminEditOrder(status) : canCustomerEditOrder(status);
  if (allowed) return null;
  if (status === "CANCELLED") return "This order was cancelled.";
  if (status === "FULFILLED") return "This order is complete.";
  if (status === "DISPATCHED") return "This order has been dispatched.";
  return actor === "customer"
    ? "This order is being processed — contact the shop to change it."
    : "This order can no longer be edited.";
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

/** Hard cap on lines per order edit — matches the cart's own ceiling. */
export const MAX_EDIT_LINES = 60;
export const MAX_EDIT_REASON = 300;
export const MAX_EDIT_NOTE = 500;
/** Per-model slices on an allocation line. */
export const MAX_BREAKDOWN_ROWS = 60;

export const orderEditBreakdownSchema = z
  .array(
    z.object({
      modelName: z.string().trim().min(1).max(80),
      qty: z.number().int().positive().max(1_000_000),
    }),
  )
  .max(MAX_BREAKDOWN_ROWS);

export const orderEditLineSchema = z.object({
  productId: objectIdSchema,
  variantId: objectIdSchema.nullable(),
  quantity: z.number().int().positive().max(1_000_000),
  /** Required for allocation lines; ignored for others. Sums to `quantity`. */
  breakdown: orderEditBreakdownSchema.nullable().optional(),
});

export const orderEditInputSchema = z.object({
  /** The version the editor was looking at — a stale one is refused. */
  expectedVersion: z.number().int().min(1),
  lines: z.array(orderEditLineSchema).min(1).max(MAX_EDIT_LINES),
  /** Customer note on the whole order. `undefined` = leave unchanged. */
  note: z.string().max(MAX_EDIT_NOTE).nullable().optional(),
  /** Why — stored on the revision, shown in history. */
  reason: z.string().trim().max(MAX_EDIT_REASON).nullable().optional(),
});

export type OrderEditLineInput = z.infer<typeof orderEditLineSchema>;
export type OrderEditInput = z.infer<typeof orderEditInputSchema>;

/** Stable key for a line — the same one the billing snapshot uses. */
export function editLineKey(productId: string, variantId: string | null | undefined): string {
  return `${productId}:${variantId ?? ""}`;
}

/* ------------------------------------------------------------------ */
/* What changed                                                        */
/* ------------------------------------------------------------------ */

/** One human-readable difference between two versions of an order. */
export type OrderChange =
  | {
      kind: "quantity";
      key: string;
      name: string;
      variantLabel: string | null;
      from: number;
      to: number;
    }
  | { kind: "removed"; key: string; name: string; variantLabel: string | null; quantity: number }
  | { kind: "added"; key: string; name: string; variantLabel: string | null; quantity: number }
  | { kind: "breakdown"; key: string; name: string; variantLabel: string | null }
  | { kind: "note"; from: string | null; to: string | null };

/** The minimum a line needs to be diffed. */
export interface DiffableLine {
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  quantity: number;
  breakdown?: { modelName: string; qty: number }[] | null;
}

function sameBreakdown(
  a: { modelName: string; qty: number }[] | null | undefined,
  b: { modelName: string; qty: number }[] | null | undefined,
): boolean {
  const norm = (list: { modelName: string; qty: number }[] | null | undefined) =>
    (list ?? [])
      .map((e) => `${e.modelName.trim().toLowerCase()}=${e.qty}`)
      .sort()
      .join("|");
  return norm(a) === norm(b);
}

/**
 * Line-by-line diff, in the order: quantity changes and breakdown changes on
 * lines that stayed, then removals, then additions — the order a person
 * reading "what changed" expects.
 */
export function diffOrderLines(
  before: readonly DiffableLine[],
  after: readonly DiffableLine[],
): OrderChange[] {
  const byKeyBefore = new Map(before.map((l) => [editLineKey(l.productId, l.variantId), l]));
  const byKeyAfter = new Map(after.map((l) => [editLineKey(l.productId, l.variantId), l]));
  const changes: OrderChange[] = [];

  for (const [key, prev] of byKeyBefore) {
    const next = byKeyAfter.get(key);
    if (!next) continue;
    if (next.quantity !== prev.quantity) {
      changes.push({
        kind: "quantity",
        key,
        name: prev.name,
        variantLabel: prev.variantLabel,
        from: prev.quantity,
        to: next.quantity,
      });
    } else if (!sameBreakdown(prev.breakdown, next.breakdown)) {
      changes.push({ kind: "breakdown", key, name: prev.name, variantLabel: prev.variantLabel });
    }
  }
  for (const [key, prev] of byKeyBefore) {
    if (!byKeyAfter.has(key)) {
      changes.push({
        kind: "removed",
        key,
        name: prev.name,
        variantLabel: prev.variantLabel,
        quantity: prev.quantity,
      });
    }
  }
  for (const [key, next] of byKeyAfter) {
    if (!byKeyBefore.has(key)) {
      changes.push({
        kind: "added",
        key,
        name: next.name,
        variantLabel: next.variantLabel,
        quantity: next.quantity,
      });
    }
  }
  return changes;
}

/** One line of "what changed", for toasts, history and the PDF. */
export function describeOrderChange(change: OrderChange): string {
  const label = (name: string, variantLabel: string | null) =>
    variantLabel ? `${name} — ${variantLabel}` : name;
  switch (change.kind) {
    case "quantity":
      return `${label(change.name, change.variantLabel)}: ${change.from} → ${change.to}`;
    case "removed":
      return `Removed ${label(change.name, change.variantLabel)} (${change.quantity})`;
    case "added":
      return `Added ${label(change.name, change.variantLabel)} (${change.quantity})`;
    case "breakdown":
      return `${label(change.name, change.variantLabel)}: per-model split changed`;
    case "note":
      return change.to ? "Order note updated" : "Order note removed";
  }
}

/* ------------------------------------------------------------------ */
/* Totals, as frozen on a revision                                     */
/* ------------------------------------------------------------------ */

/** The money summary stored on each revision (before and after). */
export interface OrderTotalsSnapshot {
  subtotalPaise: number;
  itemCount: number;
  lineCount: number;
  /** Coupon discount off the goods. */
  discountPaise: number;
  /** Billing-group discount off the goods. */
  groupDiscountPaise: number;
  /** Total GST; 0 when GST was off. */
  taxPaise: number;
  deliveryChargePaise: number;
  /** What the buyer pays. */
  payablePaise: number;
}

/** Reads a stored totals blob defensively (a revision row is data). */
export function parseOrderTotalsSnapshot(value: unknown): OrderTotalsSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const int = (k: string) =>
    typeof o[k] === "number" && Number.isSafeInteger(o[k]) ? (o[k] as number) : 0;
  return {
    subtotalPaise: int("subtotalPaise"),
    itemCount: int("itemCount"),
    lineCount: int("lineCount"),
    discountPaise: int("discountPaise"),
    groupDiscountPaise: int("groupDiscountPaise"),
    taxPaise: int("taxPaise"),
    deliveryChargePaise: int("deliveryChargePaise"),
    payablePaise: int("payablePaise"),
  };
}

/** Reads stored changes defensively; unknown kinds are dropped. */
export function parseOrderChanges(value: unknown): OrderChange[] {
  if (!Array.isArray(value)) return [];
  const out: OrderChange[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const str = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : null);
    const num = (k: string) => (typeof c[k] === "number" ? (c[k] as number) : null);
    const name = str("name") ?? "";
    const key = str("key") ?? "";
    const variantLabel = str("variantLabel");
    switch (c.kind) {
      case "quantity": {
        const from = num("from"), to = num("to");
        if (from !== null && to !== null) out.push({ kind: "quantity", key, name, variantLabel, from, to });
        break;
      }
      case "removed":
      case "added": {
        const quantity = num("quantity");
        if (quantity !== null) out.push({ kind: c.kind, key, name, variantLabel, quantity });
        break;
      }
      case "breakdown":
        out.push({ kind: "breakdown", key, name, variantLabel });
        break;
      case "note":
        out.push({ kind: "note", from: str("from"), to: str("to") });
        break;
      default:
        break;
    }
  }
  return out;
}

/** "Revised twice" / "Revised" — for headers and the PDF. */
export function revisionLabel(version: number | null | undefined): string | null {
  const v = version ?? 1;
  if (v <= 1) return null;
  const times = v - 1;
  return times === 1 ? "Revised once" : `Revised ${times} times`;
}

/* ------------------------------------------------------------------ */
/* Client DTOs                                                         */
/* ------------------------------------------------------------------ */

/**
 * Money on these is `number | null`: null when the viewer is price-gated. The
 * server decides; the client only renders what it is handed.
 */
export interface OrderTotalsView {
  itemCount: number;
  lineCount: number;
  subtotalPaise: number | null;
  discountPaise: number | null;
  groupDiscountPaise: number | null;
  taxPaise: number | null;
  deliveryChargePaise: number | null;
  payablePaise: number | null;
}

export interface OrderEditLineConstraintsView {
  moq: number;
  packMultiple: number | null;
  maxQty: number | null;
  available: boolean;
  allocation: boolean;
}

export interface OrderEditPreviewLineView {
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  brand: string | null;
  variantLabel: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPricePaise: number | null;
  lineTotalPaise: number | null;
  breakdown: { modelName: string; qty: number }[] | null;
  note: string | null;
  added: boolean;
  constraints: OrderEditLineConstraintsView;
}

export interface OrderEditPreviewDTO {
  version: number;
  lines: OrderEditPreviewLineView[];
  before: OrderTotalsView;
  after: OrderTotalsView;
  changes: OrderChange[];
  warnings: string[];
}

/** A product the editor may add — public fields only, never a price. */
export interface OrderEditProductPick {
  id: string;
  name: string;
  sku: string;
  brand: string | null;
  thumbUrl: string | null;
  /** Empty for a simple product; the editor must pick one otherwise. */
  variants: { id: string; label: string; sku: string }[];
  /** True when quantities must come with a per-model split. */
  allocation: boolean;
  /** Public ordering rules (not prices) so the editor can start at a valid quantity. */
  moq: number;
  packMultiple: number | null;
}

export interface OrderRevisionDTO {
  id: string;
  version: number;
  actorType: "admin" | "customer";
  actorId: string;
  reason: string | null;
  changes: OrderChange[];
  before: OrderTotalsView | null;
  after: OrderTotalsView | null;
  createdAt: string;
}

/** Short "what changed" for a notification body: two changes, then "+N more". */
export function summariseOrderChanges(changes: readonly OrderChange[]): string {
  const shown = changes.slice(0, 2).map(describeOrderChange);
  const rest = changes.length - shown.length;
  return rest > 0 ? `${shown.join("; ")} (+${rest} more)` : shown.join("; ");
}
