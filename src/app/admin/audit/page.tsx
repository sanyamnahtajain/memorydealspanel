import type { Metadata } from "next";
import Link from "next/link";
import { XIcon, HistoryIcon } from "lucide-react";

import { requireAdminPage } from "@/server/auth/require-admin-page";
import { listAudit } from "@/server/services/audit-query";
import { humanizeAction, relativeTime } from "@/lib/audit-format";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader, EmptyState } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Pager } from "@/components/common/Pager";

export const metadata: Metadata = {
  title: "Audit log — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function parsePage(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; entityId?: string; page?: string }>;
}) {
  await requireAdminPage();
  const sp = await searchParams;

  const { entries, total, page, pageCount, pageSize } = await listAudit({
    entity: sp.entity,
    entityId: sp.entityId,
    page: parsePage(sp.page),
  });

  const filtered = Boolean(sp.entity || sp.entityId);

  return (
    <AdminShell title="Audit log">
      <div className="space-y-6">
        <PageHeader
          title="Audit log"
          description="Every change made in the admin panel — who, what, and when."
        />

        {filtered ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Filtered by</span>
            {sp.entity ? <Badge variant="secondary">{sp.entity}</Badge> : null}
            {sp.entityId ? (
              <Badge variant="outline" className="font-mono text-xs">
                {sp.entityId}
              </Badge>
            ) : null}
            <Link
              href="/admin/audit"
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <XIcon className="size-3.5" aria-hidden />
              Clear
            </Link>
          </div>
        ) : null}

        {entries.length === 0 ? (
          <EmptyState
            illustration="no-results"
            title="No audit entries"
            description={
              filtered
                ? "No changes recorded for this filter yet."
                : "Admin actions will appear here as they happen."
            }
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Action</th>
                    <th className="px-3 py-2 text-left font-medium">Change</th>
                    <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">
                      Actor
                    </th>
                    <th className="hidden px-3 py-2 text-left font-medium md:table-cell">
                      Entity
                    </th>
                    <th className="px-3 py-2 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5 font-medium">
                          <HistoryIcon
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          {humanizeAction(e.action)}
                        </span>
                        <span className="text-xs text-muted-foreground sm:hidden">
                          {e.actorName}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {e.diffSummary || "—"}
                      </td>
                      <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">
                        {e.actorName}
                      </td>
                      <td className="hidden px-3 py-2 md:table-cell">
                        <Link
                          href={`/admin/audit?entity=${encodeURIComponent(e.entity)}&entityId=${encodeURIComponent(e.entityId)}`}
                          className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          {e.entity}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
                        {relativeTime(e.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageCount={pageCount} pageSize={pageSize} total={total} />
          </>
        )}
      </div>
    </AdminShell>
  );
}
