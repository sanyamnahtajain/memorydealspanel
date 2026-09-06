import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  Building2,
  Database,
  KeyRound,
  Layers,
  Sparkles,
  Truck,
  Palette,
  ShoppingCart,
  Wrench,
  UserCog,
} from "lucide-react";

import { APP_NAME } from "@/lib/constants";
import { prisma } from "@/server/db";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { ExportMenu } from "@/components/admin/ExportMenu";
import { PreferencesPanel } from "@/components/preferences/PreferencesPanel";
import { CartNoticeForm } from "@/components/admin/settings/CartNoticeForm";
import { MaintenanceForm } from "@/components/admin/settings/MaintenanceForm";
import { getMaintenance } from "@/server/services/maintenance";
import { StoreSettingsForm } from "@/components/admin/settings/StoreSettingsForm";
import { DeliverySettingsForm } from "@/components/admin/settings/DeliverySettingsForm";
import { parseDeliveryRules } from "@/lib/delivery";
import { getStoreSettings } from "@/server/services/store-settings";

export const metadata: Metadata = {
  title: "Settings — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Admin surface — always live so profile edits reflect immediately.
export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export default async function AdminSettingsPage() {
  const viewer = await requireAdminPage();

  const [admin, storeSettings] = await Promise.all([
    prisma.admin.findUnique({
      where: { id: viewer.adminId },
      select: { name: true, email: true, createdAt: true },
    }),
    getStoreSettings(),
  ]);
  const maintenance = await getMaintenance();

  return (
    <AdminShell title="Settings">
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="Your business profile, appearance, catalog exports, and account."
        />

        {/* Appearance & preferences — theme, density, default view, page size,
            and reduce-motion. Applies instantly and persists per browser. */}
        <SettingsSection
          icon={Palette}
          title="Appearance & preferences"
          description="Theme, layout density, default view, and motion — applied instantly and remembered on this device."
        >
          <PreferencesPanel />
        </SettingsSection>

        {/* Ordering — the configurable minimum order value. */}
        {/* First on the page on purpose: it is the only switch here that is
            visible to every customer the moment it lands. */}
        <SettingsSection
          icon={Wrench}
          title="Maintenance"
          description="Take the storefront offline while you work. This console stays available."
        >
          <MaintenanceForm
            initialEnabled={maintenance.enabled}
            initialMessage={maintenance.message ?? null}
            initialUntil={maintenance.until ?? null}
          />
        </SettingsSection>

        <SettingsSection
          icon={ShoppingCart}
          title="Ordering"
          description="Rules applied to every customer order."
        >
          <StoreSettingsForm
            initialMinOrderValuePaise={storeSettings.minOrderValuePaise}
          />
          <div className="mt-6 border-t border-border pt-6">
            <CartNoticeForm initial={storeSettings.cartNotice} />
          </div>
        </SettingsSection>

        {/* Delivery — the minimum-charge disclosure (owner request). */}
        <SettingsSection
          icon={Truck}
          title="Delivery"
          description="The minimum delivery charge customers are told about on the cart, orders and bills."
        >
          <DeliverySettingsForm initial={parseDeliveryRules(storeSettings.deliveryRules)} />
        </SettingsSection>

        {/* Shop code — the entry gate for new customers (see lib/entry-gate). */}
        <SettingsSection
          icon={KeyRound}
          title="Shop code"
          description="The code new customers must enter before they can ask for prices."
        >
          <Link
            href="/admin/settings/entry-gate"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Manage the shop code
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </SettingsSection>

        {/* Notifications — which alerts reach staff phones, plus the composer. */}
        <SettingsSection
          icon={BellRing}
          title="Notifications"
          description="Choose which alerts ring on your phone, turn this device on, and send your own message to customers or staff."
        >
          <Link
            href="/admin/settings/notifications"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Manage notifications
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </SettingsSection>

        {/* Billing groups — brand buckets with tiered discounts. */}
        <SettingsSection
          icon={Layers}
          title="Billing groups"
          description="Split carts into brand buckets, each with its own tiered discount and separate bill page."
        >
          <Link
            href="/admin/settings/billing-groups"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Manage billing groups
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </SettingsSection>

        {/* Slaby branding — "Built with Slaby" badges, all owner-toggleable. */}
        <SettingsSection
          icon={Sparkles}
          title="Slaby branding"
          description="Show “Built with Slaby” on the storefront — badges, the order-success credit, and the occasional promo card, each toggleable."
        >
          <Link
            href="/admin/settings/branding"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Manage Slaby branding
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </SettingsSection>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Business profile — read-only for now. */}
          <SettingsSection
            icon={Building2}
            title="Business profile"
            description="How this workspace is identified."
          >
            <dl className="grid gap-3 sm:grid-cols-2">
              <Field label="Store name" value={APP_NAME} />
              <Field label="Catalog type" value="B2B gated-price catalog" />
              <Field
                label="Administrator"
                value={admin?.name ?? "—"}
              />
              <Field
                label="Member since"
                value={
                  admin?.createdAt ? dateFmt.format(admin.createdAt) : "—"
                }
              />
            </dl>
          </SettingsSection>

          {/* Data — catalog export. */}
          <SettingsSection
            icon={Database}
            title="Data"
            description="Export the full catalog for offline use or backups."
          >
            <ExportMenu label="Download catalog" />
          </SettingsSection>

          {/* Account — signed-in identity + sign out. */}
          <SettingsSection
            icon={UserCog}
            title="Account"
            description="You're signed in as an administrator."
          >
            <div className="flex flex-col gap-4">
              <dl className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" value={admin?.name ?? "—"} />
                <Field label="Email" value={admin?.email ?? "—"} />
              </dl>
              <div>
                <SignOutButton variant="button" />
              </div>
            </div>
          </SettingsSection>
        </div>
      </div>
    </AdminShell>
  );
}

function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-0.5">
          <h2 className="font-heading text-base font-semibold tracking-tight">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="truncate text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}
