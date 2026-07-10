import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/common";

/**
 * One access grant nearing expiry, shown in {@link ExpiringList}.
 */
export interface ExpiringGrantItem {
  id: string;
  /** Customer business name (primary label). */
  businessName: string;
  /** Secondary label, e.g. contact name or city. */
  subtitle?: string;
  /** ISO expiry timestamp; used for the "expires in Nd" label + <time>. */
  expiresAt: string;
  /** Destination when clicked, e.g. the customer detail page. */
  href?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Coarse "expires in …" label against a fixed server-captured `now` (epoch ms)
 * so the render stays pure and matches SSR. Past-due grants read "expired".
 */
function expiryLabel(iso: string, now: number): { text: string; soon: boolean } {
  const target = new Date(iso).getTime();
  const diff = target - now;
  if (diff <= 0) return { text: "expired", soon: true };
  if (diff < HOUR_MS) return { text: "< 1h", soon: true };
  if (diff < DAY_MS) {
    const h = Math.max(1, Math.round(diff / HOUR_MS));
    return { text: `in ${h}h`, soon: true };
  }
  const d = Math.round(diff / DAY_MS);
  return { text: `in ${d}d`, soon: d <= 2 };
}

interface ExpiringListProps {
  items: ExpiringGrantItem[];
  /** Reference "now" (epoch ms), captured once on the server. */
  now: number;
  className?: string;
}

/**
 * Compact list of access grants expiring within the dashboard window. Purely
 * presentational and server-rendered; rows link to the customer when a href is
 * supplied. Renders a friendly empty state when nothing is expiring.
 */
export function ExpiringList({ items, now, className }: ExpiringListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        illustration="empty-box"
        title="Nothing expiring soon"
        description="Grants nearing their expiry date will appear here."
      />
    );
  }

  return (
    <ul className={cn("flex flex-col", className)}>
      {items.map((item) => {
        const { text, soon } = expiryLabel(item.expiresAt, now);
        const row = (
          <div className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {item.businessName}
              </p>
              {item.subtitle ? (
                <p className="truncate text-xs text-muted-foreground">
                  {item.subtitle}
                </p>
              ) : null}
            </div>
            <time
              dateTime={item.expiresAt}
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
                soon
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {text}
            </time>
            {item.href ? (
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground/60"
              />
            ) : null}
          </div>
        );

        return (
          <li key={item.id} className="border-b border-border/60 last:border-b-0">
            {item.href ? (
              <Link
                href={item.href}
                className="-mx-2 block rounded-lg px-2 transition-fast hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}
