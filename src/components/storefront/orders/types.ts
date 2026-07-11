import type { OrderStatus } from "@prisma/client";

/**
 * Client-safe order DTOs for the customer history views. Dates are ISO
 * strings. Price fields are present ONLY when the server decided the viewer
 * may see prices (`priced: true`); when gated, `subtotalPaise` and every
 * line's price fields are `null` and no amount ever crosses into the client.
 */

export interface OrderHistoryRow {
  orderNumber: string;
  status: OrderStatus;
  itemCount: number;
  /** null when the viewer is price-gated. */
  subtotalPaise: number | null;
  placedAt: string;
}

/**
 * Frozen per-line GST breakup, present ONLY when the order carried GST AND the
 * viewer may see prices (a gated viewer never receives any amount). `null`
 * otherwise — the line then renders exactly as pre-GST.
 */
export interface OrderHistoryLineTax {
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

export interface OrderHistoryLine {
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  brand: string | null;
  variantLabel: string | null;
  imageUrl: string | null;
  quantity: number;
  /** null when the viewer is price-gated. */
  unitPricePaise: number | null;
  /** null when the viewer is price-gated. */
  lineTotalPaise: number | null;
  /** Frozen per-line GST; null when off / gated. */
  tax: OrderHistoryLineTax | null;
}

/** One HSN summary row for the customer proforma tax table. */
export interface OrderHistoryHsnRow {
  hsnCode: string | null;
  gstRateBps: number;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

/**
 * The frozen order-level GST snapshot for the customer proforma. Present only
 * when the order carried GST AND the viewer is priced; `null` otherwise.
 */
export interface OrderHistoryTax {
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
  hsnSummary: OrderHistoryHsnRow[];
}

export interface OrderHistoryDetail {
  orderNumber: string;
  status: OrderStatus;
  itemCount: number;
  subtotalPaise: number | null;
  placedAt: string;
  updatedAt: string;
  note: string | null;
  items: OrderHistoryLine[];
  /** Whether the viewer may currently see prices (drives the gate UI). */
  priced: boolean;
  /** Frozen order-level GST snapshot, or null when off / gated. */
  tax: OrderHistoryTax | null;
}
