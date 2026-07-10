import { EmptyState } from "@/components/common";
import { FadeUp } from "@/components/motion/primitives";
import { getRecentAuditForModule } from "@/server/services/audit-query";
import {
  AuditCardShell,
  AuditTimeline,
  AuditLogPreviewSkeleton,
} from "./AuditLogPreview";

/**
 * RecentActivityPanel — a module-level "Recent activity" card showing the
 * latest audit events across an entire entity type (e.g. every recent change
 * to any Product). Server Component: drop
 *   <RecentActivityPanel entity="Product" />
 * onto a module landing page and it self-loads (admin-only via the underlying
 * service). Shares the visual language of {@link AuditLogPreview}.
 */

interface RecentActivityPanelProps {
  entity: string;
  /** Card heading. @default "Recent activity" */
  title?: string;
  /** Max entries to show. @default 8 */
  limit?: number;
}

export async function RecentActivityPanel({
  entity,
  title = "Recent activity",
  limit = 8,
}: RecentActivityPanelProps) {
  const entries = await getRecentAuditForModule(entity, limit);
  // Captured once at request time; `new Date()` keeps this render-pure per lint.
  const now = new Date().getTime();
  const viewAllHref = `/admin/audit?entity=${encodeURIComponent(entity)}`;

  return (
    <AuditCardShell title={title} viewAllHref={viewAllHref}>
      {entries.length === 0 ? (
        <EmptyState
          illustration="no-results"
          title="No activity yet"
          description="Recent changes across this section will show up here."
          className="py-6"
        />
      ) : (
        <FadeUp>
          <AuditTimeline entries={entries} now={now} />
        </FadeUp>
      )}
    </AuditCardShell>
  );
}

/** Loading placeholder for the module panel. Re-exports the shared skeleton. */
export function RecentActivityPanelSkeleton({ rows = 6 }: { rows?: number }) {
  return <AuditLogPreviewSkeleton rows={rows} />;
}
