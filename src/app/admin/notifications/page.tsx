import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Settings2 } from "lucide-react";

import { PERMISSIONS } from "@/lib/permissions";
import { requirePermissionPage } from "@/server/auth/permissions";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { BroadcastComposer } from "@/components/admin/notifications/BroadcastComposer";
import { prisma } from "@/server/db";
import { objectIdSchema } from "@/lib/schemas/shared";

export const metadata: Metadata = {
  title: "Send a message — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Admin › Send a message — the custom-notification composer.
 *
 * Gated on `settings.manage`: writing to every customer's phone is a shop-wide
 * act, so it sits with the owner-level settings rather than with the
 * day-to-day customer permissions. (Your OWN alert switches live at
 * /admin/settings/notifications and need no special permission.)
 *
 * The page itself is a thin server shell — the composer is a client component
 * because every part of it (audience, live count, preview) reacts to typing.
 */
export default async function AdminSendNotificationPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  await requirePermissionPage(PERMISSIONS.SETTINGS_MANAGE);

  // Arriving from a product's Buyers panel ("Notify buyers"): start the
  // composer on that product's audience. Unknown or malformed id → plain composer.
  const productParam = objectIdSchema.safeParse((await searchParams).product);
  const picked = productParam.success
    ? await prisma.product.findFirst({
        where: { id: productParam.data, deletedAt: null },
        select: { id: true, name: true, sku: true, images: true },
      })
    : null;
  const initialProduct = picked
    ? {
        id: picked.id,
        name: picked.name,
        sku: picked.sku,
        imageUrl: (picked.images.find((i) => i.isPrimary) ?? picked.images[0])?.thumbUrl ?? (picked.images[0]?.url ?? null),
      }
    : null;

  return (
    <AdminShell title="Send a message">
      <div className="space-y-6">
        <PageHeader
          title="Send a message"
          description="Write your own notification and send it to customers or to staff."
          actions={
            <Link
              href="/admin/settings/notifications"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              <Settings2 className="size-4" aria-hidden />
              Notification settings
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          }
        />

        <BroadcastComposer initialProduct={initialProduct} />
      </div>
    </AdminShell>
  );
}
