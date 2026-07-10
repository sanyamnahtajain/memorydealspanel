import { prisma } from "@/server/db";

/**
 * Page-view tracking service.
 *
 * A `PageView` is an append-only analytics row that feeds the admin
 * dashboard's "Most viewed" aggregation (`prisma.pageView.groupBy`). It
 * carries only a `productId` and an optional `customerId` — never any price
 * or gated field — so recording a view can never influence the price gate.
 *
 * `recordProductView` is deliberately FIRE-AND-FORGET SAFE: it must never
 * throw into the caller. A product page must render (and, crucially, keep its
 * price-gate behaviour) whether or not the analytics write succeeds, so every
 * failure is swallowed and logged rather than propagated.
 */
export async function recordProductView(
  productId: string,
  customerId?: string | null,
): Promise<void> {
  try {
    await prisma.pageView.create({
      data: {
        productId,
        // Persist an explicit null for anon viewers so the row's shape is
        // consistent with the schema's optional relation.
        customerId: customerId ?? null,
      },
    });
  } catch (error) {
    // Analytics is best-effort. Never surface a failure to the page render.
    console.error("[pageviews] failed to record product view:", error);
  }
}
