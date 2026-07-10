import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  AlarmClock,
  Boxes,
  ClipboardList,
  FolderTree,
  UserCheck,
  Users,
} from "lucide-react";

import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import {
  ActivityFeed,
  DashboardPanel,
  MiniList,
  PanelSkeleton,
  StatGrid,
  StatGridSkeleton,
  humanizeAudit,
  type StatItem,
} from "@/components/admin/dashboard";

export const metadata: Metadata = {
  title: "Dashboard — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Counts and feeds are live and per-request; never cache the admin dashboard.
export const dynamic = "force-dynamic";

const numberFmt = new Intl.NumberFormat("en-IN");
const fmt = (n: number) => numberFmt.format(n);

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_WINDOW_DAYS = 7;
const MOST_VIEWED_WINDOW_DAYS = 30;

/**
 * Admin dashboard (server component).
 *
 * Authoritative gate: `resolveViewer` resolves a DB-backed viewer and
 * `isAdmin` decides. Middleware bounces sessionless traffic, but a customer
 * session can still reach here — so this re-check is the real lock; non-admins
 * are redirected to the admin login. Only after that do we render the KPI,
 * activity and most-viewed sections, each of which streams in under its own
 * Suspense boundary with a matching skeleton.
 */
export default async function AdminDashboardPage() {
  const viewer = await resolveViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }

  // Cheap, unstreamed: powers the Requests nav badge in the shell.
  const pendingRequestCount = await prisma.accessRequest.count({
    where: { status: "PENDING" },
  });

  return (
    <AdminShell
      title="Dashboard"
      badges={{ "/admin/requests": pendingRequestCount }}
    >
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description="Catalog, customers and activity at a glance."
        />

        <Suspense fallback={<StatGridSkeleton count={6} columns={3} />}>
          <KpiSection />
        </Suspense>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Suspense fallback={<PanelSkeleton rows={6} />}>
            <ActivitySection />
          </Suspense>
          <Suspense fallback={<PanelSkeleton rows={5} />}>
            <MostViewedSection />
          </Suspense>
        </div>
      </div>
    </AdminShell>
  );
}

/* ------------------------------------------------------------------ */
/* KPI cards                                                           */
/* ------------------------------------------------------------------ */

async function KpiSection() {
  const now = new Date();
  const expiringBefore = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * DAY_MS);

  const [
    activeProducts,
    inactiveProducts,
    categoryCount,
    approvedCustomers,
    pendingCustomers,
    pendingRequests,
    expiringSoon,
  ] = await Promise.all([
    prisma.product.count({ where: { deletedAt: null, status: "ACTIVE" } }),
    prisma.product.count({ where: { deletedAt: null, status: "INACTIVE" } }),
    prisma.category.count(),
    prisma.customer.count({ where: { status: "APPROVED" } }),
    prisma.customer.count({ where: { status: "PENDING" } }),
    prisma.accessRequest.count({ where: { status: "PENDING" } }),
    prisma.accessGrant.count({
      where: {
        revokedAt: null,
        expiresAt: { gt: now, lte: expiringBefore },
      },
    }),
  ]);

  const totalProducts = activeProducts + inactiveProducts;

  const items: StatItem[] = [
    {
      key: "products",
      label: "Products",
      value: fmt(totalProducts),
      icon: <Boxes aria-hidden />,
      deltaLabel: `${fmt(activeProducts)} active · ${fmt(inactiveProducts)} inactive`,
    },
    {
      key: "categories",
      label: "Categories",
      value: fmt(categoryCount),
      icon: <FolderTree aria-hidden />,
    },
    {
      key: "approved-customers",
      label: "Approved customers",
      value: fmt(approvedCustomers),
      icon: <UserCheck aria-hidden />,
    },
    {
      key: "pending-customers",
      label: "Pending customers",
      value: fmt(pendingCustomers),
      icon: <Users aria-hidden />,
    },
    {
      key: "pending-requests",
      label: "Access requests",
      value: fmt(pendingRequests),
      icon: <ClipboardList aria-hidden />,
    },
    {
      key: "expiring",
      label: `Expiring in ${EXPIRING_WINDOW_DAYS}d`,
      value: fmt(expiringSoon),
      icon: <AlarmClock aria-hidden />,
    },
  ];

  return <StatGrid items={items} columns={3} />;
}

/* ------------------------------------------------------------------ */
/* Recent activity                                                     */
/* ------------------------------------------------------------------ */

async function ActivitySection() {
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      actorType: true,
      actorId: true,
      action: true,
      entity: true,
      entityId: true,
      createdAt: true,
    },
  });

  const items = rows.map(humanizeAudit);

  // Captured once at request time; `new Date()` keeps this render-pure per lint.
  const now = new Date().getTime();

  return (
    <DashboardPanel
      title="Recent activity"
      description="Latest admin and system actions."
    >
      <ActivityFeed items={items} now={now} />
    </DashboardPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Most viewed products (last 30d)                                     */
/* ------------------------------------------------------------------ */

async function MostViewedSection() {
  const since = new Date(new Date().getTime() - MOST_VIEWED_WINDOW_DAYS * DAY_MS);

  // Aggregate page views per product in the window, then hydrate the top 5.
  const grouped = await prisma.pageView.groupBy({
    by: ["productId"],
    where: { createdAt: { gte: since } },
    _count: { productId: true },
    orderBy: { _count: { productId: "desc" } },
    take: 5,
  });

  const productIds = grouped.map((g) => g.productId);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          name: true,
          sku: true,
          images: true,
        },
      })
    : [];

  const byId = new Map(products.map((p) => [p.id, p]));

  const items = grouped
    .map((g) => {
      const product = byId.get(g.productId);
      if (!product) return null;
      const primary =
        product.images.find((img) => img.isPrimary) ?? product.images[0];
      return {
        id: product.id,
        title: product.name,
        subtitle: product.sku,
        metric: fmt(g._count.productId),
        metricLabel: g._count.productId === 1 ? "view" : "views",
        imageUrl: primary?.thumbUrl ?? primary?.url ?? null,
        href: `/admin/products/${product.id}`,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <DashboardPanel
      title="Most viewed"
      description={`Top products over the last ${MOST_VIEWED_WINDOW_DAYS} days.`}
      action={{ label: "All products", href: "/admin/products" }}
    >
      <MiniList
        items={items}
        emptyTitle="No views yet"
        emptyDescription="Product views from the storefront will rank here."
      />
    </DashboardPanel>
  );
}
