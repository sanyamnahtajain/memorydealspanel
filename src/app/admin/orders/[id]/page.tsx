import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireAdminPage } from "@/server/auth/require-admin-page";
import { assertPermission } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import { getOrder } from "@/server/services/admin-orders";
import { objectIdSchema } from "@/lib/schemas/shared";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { OrderDetailPanel } from "@/components/admin/orders/OrderDetailPanel";
import type { OrderDetailDTO } from "@/server/actions/admin-orders";

export const metadata: Metadata = {
  title: "Order — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireAdminPage();
  await assertPermission(viewer, PERMISSIONS.CUSTOMERS_VIEW);

  const { id } = await params;
  const parsed = objectIdSchema.safeParse(id);
  if (!parsed.success) {
    notFound();
  }

  const detail = await getOrder(parsed.data);
  if (!detail) {
    notFound();
  }

  // Opening an order (with buyer contact + full snapshot) is an explicit,
  // audited admin access.
  await writeAudit({
    actorType: "admin",
    actorId: viewer.adminId,
    action: "order.view",
    entity: "Order",
    entityId: detail.id,
  });

  const order: OrderDetailDTO = {
    id: detail.id,
    orderNumber: detail.orderNumber,
    status: detail.status,
    itemCount: detail.itemCount,
    subtotalPaise: detail.subtotalPaise,
    placedAt: detail.placedAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
    customer: detail.customer
      ? {
          id: detail.customer.id,
          businessName: detail.customer.businessName,
          contactName: detail.customer.contactName,
          phone: detail.customer.phone,
          city: detail.customer.city,
        }
      : null,
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
  };

  return (
    <AdminShell title={`Order #${order.orderNumber}`}>
      <div className="space-y-6">
        <PageHeader
          title={`Order #${order.orderNumber}`}
          backHref="/admin/orders"
          backLabel="Orders"
        />
        <OrderDetailPanel order={order} />
      </div>
    </AdminShell>
  );
}
