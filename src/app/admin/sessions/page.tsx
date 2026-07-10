import type { Metadata } from "next";

import { requireAdminPage } from "@/server/auth/require-admin-page";
import {
  listSessions,
  type SessionKind,
} from "@/server/services/sessions";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { SessionsTabs } from "@/components/admin/sessions";
import { toRow } from "@/components/admin/sessions/SessionsForUser";

export const metadata: Metadata = {
  title: "Sessions — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Live surface — revoking a session must reflect immediately.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

function parseKind(v: string | undefined): SessionKind {
  return v === "customer" ? "customer" : "admin";
}

function parsePage(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; page?: string }>;
}) {
  await requireAdminPage();
  const sp = await searchParams;

  const kind = parseKind(sp.kind);
  const page = parsePage(sp.page);

  // The current tab's paginated slice, plus per-tab active counts for badges.
  const [list, adminActive, customerActive] = await Promise.all([
    listSessions({ kind, page, pageSize: PAGE_SIZE }),
    listSessions({ kind: "admin", activeOnly: true, pageSize: 1 }),
    listSessions({ kind: "customer", activeOnly: true, pageSize: 1 }),
  ]);

  const rows = list.sessions.map(toRow);

  const description =
    `${adminActive.total} active admin ${adminActive.total === 1 ? "session" : "sessions"}` +
    ` · ${customerActive.total} active customer ${customerActive.total === 1 ? "session" : "sessions"}.` +
    " Sign out a device to force it to re-authenticate.";

  return (
    <AdminShell title="Sessions">
      <div className="space-y-6">
        <PageHeader title="Sessions" description={description} />
        <SessionsTabs
          kind={kind}
          rows={rows}
          page={list.page}
          pageCount={list.pageCount}
          total={list.total}
          pageSize={list.pageSize}
          adminActive={adminActive.total}
          customerActive={customerActive.total}
        />
      </div>
    </AdminShell>
  );
}
