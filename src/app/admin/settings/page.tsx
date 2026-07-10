import type { Metadata } from "next";
import {
  Building2,
  Database,
  Palette,
  UserCog,
} from "lucide-react";

import { APP_NAME } from "@/lib/constants";
import { prisma } from "@/server/db";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { ExportMenu } from "@/components/admin/ExportMenu";

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

  const admin = await prisma.admin.findUnique({
    where: { id: viewer.adminId },
    select: { name: true, email: true, createdAt: true },
  });

  return (
    <AdminShell title="Settings">
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="Your business profile, appearance, catalog exports, and account."
        />

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

          {/* Appearance — mounts the theme toggle. */}
          <SettingsSection
            icon={Palette}
            title="Appearance"
            description="Switch between dark, light, and system themes."
          >
            <ThemeToggle />
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
