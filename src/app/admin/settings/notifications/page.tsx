import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Megaphone } from "lucide-react";

import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getNotifyTopicStates } from "@/server/services/notify-prefs";
import { countSubscriptions } from "@/server/notify/push";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { NotificationSettingsPanel } from "@/components/notify/NotificationSettingsPanel";

export const metadata: Metadata = {
  title: "Notifications — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Admin › Settings › Notifications — the staff side of the alert system.
 *
 * Guarded by `requireAdminPage`, NOT by `settings.manage`: these are the
 * signed-in person's OWN switches (which alerts reach their phone), so every
 * staff member must be able to reach them. Writing to other people's phones is
 * a different job with a different gate — see /admin/notifications.
 *
 * The topic states and the device counts are read on the server so the panel
 * renders filled in on first paint; everything after that is client-side.
 */
/** One at-a-glance reach number. Not a control — just context for a send. */
function DeviceCount({
  label,
  count,
  hint,
}: {
  label: string;
  count: number;
  hint: string;
}) {
  return (
    <div className="min-w-[10rem] flex-1 rounded-xl border border-border bg-card p-4">
      <p className="text-2xl font-semibold tabular-nums">{count}</p>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export default async function AdminNotificationSettingsPage() {
  const viewer = await requireAdminPage();

  const [topics, deviceCounts] = await Promise.all([
    getNotifyTopicStates({ kind: "admin", id: viewer.adminId }),
    countSubscriptions(),
  ]);

  return (
    <AdminShell title="Notifications">
      <div className="space-y-6">
        <PageHeader
          title="Notifications"
          description="Choose which alerts reach you, and turn this device on so they can ring."
          backHref="/admin/settings"
          backLabel="Settings"
        />

        <div className="max-w-2xl space-y-6">
          {/* The SAME panel the storefront account screen uses. It carries
              the full device story — including the iPhone "add to the home
              screen first" case, which staff hit constantly and the old
              admin-only toggle could not express. */}
          <div className="rounded-2xl border border-border bg-card p-5 text-card-foreground sm:p-6">
            <NotificationSettingsPanel topics={topics} variant="admin" />
          </div>

          <div className="flex flex-wrap gap-3">
            <DeviceCount
              label="Staff devices"
              count={deviceCounts.admin}
              hint="Phones and computers that can receive staff alerts."
            />
            <DeviceCount
              label="Customer devices"
              count={deviceCounts.customer}
              hint="Customers who turned alerts on."
            />
          </div>

          <Link
            href="/admin/notifications"
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground transition-colors hover:bg-muted/50"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Megaphone className="size-4.5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                Send a message
              </span>
              <span className="block text-sm text-muted-foreground">
                Write your own notification and send it to customers or staff.
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </div>
      </div>
    </AdminShell>
  );
}
