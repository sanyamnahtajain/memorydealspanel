"use client";

import * as React from "react";
import { History } from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { humanizeAction, relativeTime } from "@/lib/audit-format";
import { getEntityAuditAction } from "@/server/actions/audit";
import type { AuditPreviewEntry } from "@/server/services/audit-query";

/**
 * EntityAuditList — a client-side change-history timeline for a single entity
 * instance. Unlike the async server-component {@link AuditLogPreview}, this can
 * live inside a client surface (e.g. the CustomerProfileDrawer): it lazily
 * fetches the recent audit entries through the admin-only
 * {@link getEntityAuditAction} server action whenever `entityId` changes and
 * renders them with the same visual language.
 *
 * It is self-contained (no server-only imports) so it is safe to import from a
 * `"use client"` component.
 */

const ACTOR_TINTS: Record<string, string> = {
  admin: "bg-primary/10 text-primary",
  system: "bg-accent text-accent-foreground",
  customer: "bg-success/10 text-success",
};

function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

export interface EntityAuditListProps {
  entity: string;
  entityId: string;
  /** Max entries to show. @default 5 */
  limit?: number;
  className?: string;
}

/** Loaded audit rows paired with the request-time "now" for stable labels. */
interface LoadedAudit {
  entries: AuditPreviewEntry[];
  now: number;
}

export function EntityAuditList({
  entity,
  entityId,
  limit = 5,
  className,
}: EntityAuditListProps) {
  // `null` while loading. `now` is captured once when the data arrives (never
  // during render) so relative labels stay deterministic between renders.
  const [loaded, setLoaded] = React.useState<LoadedAudit | null>(null);

  React.useEffect(() => {
    let active = true;
    // Fetch keyed by entity/id/limit; the async setState below is allowed and
    // does not trigger the synchronous cascading-render lint.
    getEntityAuditAction(entity, entityId, limit).then((rows) => {
      if (active) setLoaded({ entries: rows, now: Date.now() });
    });
    return () => {
      active = false;
      // Reset to the loading state when the target entity changes.
      setLoaded(null);
    };
  }, [entity, entityId, limit]);

  if (loaded === null) {
    return (
      <ol className={cn("flex flex-col", className)} aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
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
    );
  }

  const { entries, now } = loaded;

  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
        <History className="size-3.5 shrink-0" aria-hidden />
        No changes recorded yet.
      </div>
    );
  }

  return (
    <ol className={cn("flex flex-col", className)}>
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
