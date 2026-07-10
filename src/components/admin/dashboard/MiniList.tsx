import * as React from "react";
import Link from "next/link";
import { ChevronRight, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/common";

/**
 * One row in a {@link MiniList}: a thumbnailed item with a name, an optional
 * sub-label and a right-aligned metric (e.g. a view count).
 */
export interface MiniListItem {
  id: string;
  /** Primary label, e.g. the product name. */
  title: string;
  /** Secondary label, e.g. the SKU or brand. */
  subtitle?: string;
  /** Pre-formatted metric shown on the right, e.g. "1,204". */
  metric?: string;
  /** Metric caption, e.g. "views". */
  metricLabel?: string;
  /** Thumbnail image URL. Falls back to a placeholder tile when absent. */
  imageUrl?: string | null;
  /** Destination for the row; renders as a link when provided. */
  href?: string;
}

interface MiniListProps {
  items: MiniListItem[];
  /** Copy for the empty state title. */
  emptyTitle?: string;
  /** Copy for the empty state description. */
  emptyDescription?: string;
  className?: string;
}

/**
 * Compact ranked list used for "most viewed" style panels. Presentational and
 * server-rendered. Each row optionally links to a management page.
 */
export function MiniList({
  items,
  emptyTitle = "Nothing to show",
  emptyDescription,
  className,
}: MiniListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        illustration="empty-box"
        title={emptyTitle}
        description={emptyDescription}
        className={className}
      />
    );
  }

  return (
    <ul data-slot="mini-list" className={cn("flex flex-col", className)}>
      {items.map((item, index) => {
        const content = <MiniListRow item={item} rank={index + 1} linked={!!item.href} />;
        return (
          <li
            key={item.id}
            className={cn(index > 0 && "border-t border-border/60")}
          >
            {item.href ? (
              <Link
                href={item.href}
                className="block rounded-md transition-fast hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {content}
              </Link>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MiniListRow({
  item,
  rank,
  linked,
}: {
  item: MiniListItem;
  rank: number;
  linked: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="w-4 shrink-0 text-center font-tabular text-xs font-medium text-muted-foreground">
        {rank}
      </span>
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground">
        {item.imageUrl ? (
          // Product images are remote (R2) or local uploads; a plain img avoids
          // needing next/image remotePatterns config for the admin surface.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <ImageOff aria-hidden className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
        {item.subtitle ? (
          <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
        ) : null}
      </div>
      {item.metric ? (
        <div className="shrink-0 text-right">
          <p className="font-tabular text-sm font-semibold text-foreground">
            {item.metric}
          </p>
          {item.metricLabel ? (
            <p className="text-[0.7rem] leading-tight text-muted-foreground">
              {item.metricLabel}
            </p>
          ) : null}
        </div>
      ) : null}
      {linked ? (
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      ) : null}
    </div>
  );
}
