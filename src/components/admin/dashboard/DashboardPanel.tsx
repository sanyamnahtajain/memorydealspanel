import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardPanelProps {
  title: string;
  /** Optional subtitle under the title. */
  description?: string;
  /** Optional "view all" style link shown in the header. */
  action?: { label: string; href: string };
  children: React.ReactNode;
  className?: string;
}

/**
 * Card container for a dashboard section (activity feed, most-viewed, etc.).
 * Provides a consistent titled header with an optional header link. Server
 * component.
 */
export function DashboardPanel({
  title,
  description,
  action,
  children,
  className,
}: DashboardPanelProps) {
  return (
    <section
      data-slot="dashboard-panel"
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-5",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? (
          <Link
            href={action.href}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-md text-xs font-medium text-primary transition-fast hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {action.label}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
        ) : null}
      </header>
      <div className="mt-3 flex-1">{children}</div>
    </section>
  );
}
