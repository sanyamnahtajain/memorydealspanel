import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState, Tooltip } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import { FadeUp } from "@/components/motion/primitives";
import { humanizeAction, relativeTime } from "@/lib/audit-format";
import {
  getRecentAuditForEntity,
  type AuditPreviewEntry,
} from "@/server/services/audit-query";

/**
 * AuditLogPreview — a compact, drop-in change-history timeline for a single
 * entity instance. Server Component: renders
 *   <AuditLogPreview entity="Product" entityId={product.id} />
 * anywhere in the admin and it self-loads the last few audit events (admin-only
 * — the underlying service asserts the viewer is an admin).
 *
 * Sections: a header (subtle history icon + tooltip + "View all" link) and a
 * vertical timeline of actor / humanized action / diff summary / relative time.
 * Empty state when nothing is recorded. Use {@link AuditLogPreviewSkeleton} as
 * the Suspense fallback when wrapping this in `<Suspense>`.
 */

const ACTOR_TINTS: Record<string, string> = {
  admin: "bg-primary/10 text-primary",
  system: "bg-accent text-accent-foreground",
  customer: "bg-success/10 text-success",
};

/** First letter of the actor's resolved name, for the avatar chip. */
function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

/* ------------------------------------------------------------------ */
/* Shared presentational timeline (used by RecentActivityPanel too)    */
/* ------------------------------------------------------------------ */

interface AuditTimelineProps {
  entries: AuditPreviewEntry[];
  /** Request-stable "now" for deterministic relative labels. */
  now: number;
  className?: string;
}

/**
 * Pure presentational list of audit entries. Kept export-only for reuse by the
 * module panel; both surfaces share one visual language.
 */
export function AuditTimeline({ entries, now, className }: AuditTimelineProps) {
  return (
    <ol data-slot="audit-timeline" className={cn("flex flex-col", className)}>
      {entries.map((entry, index) => (
        <li
          key={entry.id}
          className={cn(
            "flex items-start gap-3 py-2.5",
            index > 0 && "border-t border-border/60",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
              ACTOR_TINTS[entry.actorType] ?? ACTOR_TINTS.system,
            )}
          >
            {initial(entry.actorName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-foreground">
              <span className="font-medium">{entry.actorName}</span>{" "}
              <span className="text-muted-foreground">
                {humanizeAction(entry.action).toLowerCase()}
              </span>
            </p>
            {entry.diffSummary ? (
              <p className="truncate font-tabular text-xs text-muted-foreground">
                {entry.diffSummary}
              </p>
            ) : null}
          </div>
          <time
            dateTime={entry.createdAt}
            className="shrink-0 pt-0.5 text-xs whitespace-nowrap text-muted-foreground"
          >
            {relativeTime(entry.createdAt, now)}
          </time>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Card header (shared shell)                                          */
/* ------------------------------------------------------------------ */

interface AuditCardShellProps {
  title: string;
  /** Optional "View all" destination. */
  viewAllHref?: string;
  children: React.ReactNode;
}

function AuditCardShell({ title, viewAllHref, children }: AuditCardShellProps) {
  return (
    <section
      data-slot="audit-preview"
      className="flex flex-col gap-2 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Tooltip content="Recent changes recorded in the audit log">
            <span
              className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5"
              aria-label="Audit history"
            >
              <History />
            </span>
          </Tooltip>
          <h3 className="font-heading text-sm font-medium text-foreground">
            {title}
          </h3>
        </div>
        {viewAllHref ? (
          <Link
            href={viewAllHref}
            className="inline-flex items-center gap-0.5 rounded-md text-xs font-medium text-primary transition-colors hover:text-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-3"
          >
            View all
            <ArrowUpRight />
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                            */
/* ------------------------------------------------------------------ */

/** Loading placeholder matching the timeline layout. Use as a Suspense fallback. */
export function AuditLogPreviewSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <section
      data-slot="audit-preview-skeleton"
      className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <header className="flex items-center gap-2">
        <Skeleton className="size-6 rounded-md" />
        <Skeleton className="h-4 w-24" />
      </header>
      <ol className="flex flex-col">
        {Array.from({ length: rows }).map((_, i) => (
          <li
            key={i}
            className={cn(
              "flex items-start gap-3 py-2.5",
              i > 0 && "border-t border-border/60",
            )}
          >
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-3 w-12 shrink-0" />
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* AuditLogPreview (async server component)                            */
/* ------------------------------------------------------------------ */

interface AuditLogPreviewProps {
  entity: string;
  entityId: string;
  /** Card heading. @default "History" */
  title?: string;
  /** Max entries to show. @default 5 */
  limit?: number;
}

/**
 * Loads and renders the recent change history for one entity instance.
 * Async Server Component — wrap in `<Suspense fallback={<AuditLogPreviewSkeleton/>}>`
 * at the call site for streaming, or render directly.
 */
export async function AuditLogPreview({
  entity,
  entityId,
  title = "History",
  limit = 5,
}: AuditLogPreviewProps) {
  const entries = await getRecentAuditForEntity(entity, entityId, limit);
  // Captured once at request time; `new Date()` keeps this render-pure per lint.
  const now = new Date().getTime();
  const viewAllHref = `/admin/audit?entity=${encodeURIComponent(entity)}&entityId=${encodeURIComponent(entityId)}`;

  return (
    <AuditCardShell title={title} viewAllHref={viewAllHref}>
      {entries.length === 0 ? (
        <EmptyState
          illustration="no-results"
          title="No changes recorded yet"
          description="Edits and actions on this record will appear here."
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

export { AuditCardShell };
