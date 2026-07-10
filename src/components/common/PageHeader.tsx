import * as React from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Right-aligned slot for buttons / filters. */
  actions?: React.ReactNode;
  /** When set, renders a small back link above the title. */
  backHref?: string;
  /** Label for the back link. Defaults to "Back". */
  backLabel?: string;
  className?: string;
}

/**
 * Standard page heading: optional back link, title + description on the
 * left, actions slot on the right. Server component.
 */
export function PageHeader({
  title,
  description,
  actions,
  backHref,
  backLabel = "Back",
  className,
}: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn("flex flex-col gap-2", className)}>
      {backHref ? (
        <Link
          href={backHref}
          className="inline-flex w-fit items-center gap-1 rounded-md text-sm text-muted-foreground transition-fast hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden />
          {backLabel}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-56 space-y-1">
          <h1 className="font-heading text-xl font-semibold tracking-tight text-balance text-foreground sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="max-w-prose text-sm text-pretty text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
