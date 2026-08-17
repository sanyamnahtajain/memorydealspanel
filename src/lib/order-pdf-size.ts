/**
 * Paper size for a downloaded order/estimate PDF (owner request — the download
 * asks A4 or A5). Client-safe: this module has NO server imports, so the admin
 * download control and the API route can both share these values without
 * pulling `order-pdf.ts` (and its prisma import) into the client bundle.
 */
export const ORDER_PDF_SIZES = ["A4", "A5"] as const;

export type OrderPdfSize = (typeof ORDER_PDF_SIZES)[number];

export const DEFAULT_ORDER_PDF_SIZE: OrderPdfSize = "A4";

/** Labels for the size picker (kept beside the values they name). */
export const ORDER_PDF_SIZE_LABELS: Record<OrderPdfSize, string> = {
  A4: "A4 sheet",
  A5: "A5 sheet",
};

/** Narrow an untrusted `?size=` query value to a supported size, else A4. */
export function parseOrderPdfSize(value: string | null | undefined): OrderPdfSize {
  return value != null && (ORDER_PDF_SIZES as readonly string[]).includes(value)
    ? (value as OrderPdfSize)
    : DEFAULT_ORDER_PDF_SIZE;
}
