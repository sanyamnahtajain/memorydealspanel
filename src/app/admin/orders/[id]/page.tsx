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
    items: detail.items,
    note: detail.note,
    adminNote: detail.adminNote,
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
