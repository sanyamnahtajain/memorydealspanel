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
}
