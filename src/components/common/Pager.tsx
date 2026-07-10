"use client";

/**
 * Pager — URL-driven offset pagination + a load-more button for cursor lists.
 *
 * Two exports:
 *
 *  • `<Pager>` — an accessible Prev/Next control with a "Page N of M" readout
 *    (and optional numbered page links). It is driven entirely by the URL
 *    `?page=` param: clicking Prev/Next pushes a new URL that PRESERVES every
 *    other search param (filters, search query, sort, brand facets…), so the
 *    server component re-renders the requested slice. No client data fetching —
 *    the source of truth stays on the server, which keeps the price gate and
 *    admin authorisation intact.
 *
 *  • `<LoadMoreButton>` — a token-styled button for infinite / cursor lists
 *    (the storefront grid). Shows a spinner while loading and an end-of-list
 *    marker when the caller reports `done`.
 *
 * Both are token-styled (no hardcoded palette) and read correctly on the light
 * storefront and dark admin. Icon-only affordances carry a `<Tooltip>` instead
 * of a bare `title=` attribute.
 */

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";

/* ------------------------------------------------------------------ */
/* Pager (offset / URL-driven)                                         */
/* ------------------------------------------------------------------ */

export interface PagerProps {
  /** 1-based current page. */
  page: number;
  /** Total number of pages (>= 1). */
  pageCount: number;
  /**
   * Total number of rows across all pages. When provided, a compact
   * "1–24 of 312" range summary is rendered alongside the controls.
   */
  total?: number;
  /** Page size used to compute the range summary (defaults derive from total). */
  pageSize?: number;
  /** Name of the URL param that carries the page number. @default "page" */
  paramName?: string;
  /**
   * Show individual numbered page buttons (windowed) in addition to Prev/Next.
   * Off by default — Prev/Next + readout is enough for most admin tables.
   */
  numbered?: boolean;
  /** Scroll to top on navigation. @default false (keeps table position). */
  scroll?: boolean;
  className?: string;
}

/** Build a href for a target page, preserving all other search params. */
function useHrefBuilder(paramName: string) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return React.useCallback(
    (target: number): string => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (target <= 1) {
        params.delete(paramName);
      } else {
        params.set(paramName, String(target));
      }
      const query = params.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, searchParams, paramName],
  );
}

/**
 * Compute a windowed list of page numbers with ellipsis gaps, e.g.
 * `[1, "…", 4, 5, 6, "…", 20]`. Always includes the first and last page.
 */
function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  const span = 1; // pages on each side of the current one
  const pages = new Set<number>([1, pageCount]);
  for (let p = page - span; p <= page + span; p += 1) {
    if (p >= 1 && p <= pageCount) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out;
}

export function Pager({
  page,
  pageCount,
  total,
  pageSize,
  paramName = "page",
  numbered = false,
  scroll = false,
  className,
}: PagerProps) {
  const router = useRouter();
  const buildHref = useHrefBuilder(paramName);

  const clamped = Math.min(Math.max(1, Math.trunc(page)), Math.max(1, pageCount));
  const hasPrev = clamped > 1;
  const hasNext = clamped < pageCount;

  const go = React.useCallback(
    (target: number) => {
      if (target < 1 || target > pageCount || target === clamped) return;
      router.push(buildHref(target), { scroll });
    },
    [router, buildHref, pageCount, clamped, scroll],
  );

  // A single page needs no controls.
  if (pageCount <= 1) {
    if (total !== undefined && total > 0) {
      return (
        <div
          className={cn(
            "flex items-center justify-end text-xs text-muted-foreground tabular-nums",
            className,
          )}
        >
          <RangeSummary page={1} pageCount={1} total={total} pageSize={pageSize} />
        </div>
      );
    }
    return null;
  }

  const window = numbered ? pageWindow(clamped, pageCount) : null;

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-col-reverse items-center gap-3 sm:flex-row sm:justify-between",
        className,
      )}
    >
      {total !== undefined ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          <RangeSummary
            page={clamped}
            pageCount={pageCount}
            total={total}
            pageSize={pageSize}
          />
        </p>
      ) : (
        <span aria-hidden className="hidden sm:block" />
      )}

      <div className="flex items-center gap-1">
        <PagerIconButton
          label="Previous page"
          disabled={!hasPrev}
          onClick={() => go(clamped - 1)}
        >
          <ChevronLeftIcon aria-hidden />
        </PagerIconButton>

        {window ? (
          <ul className="flex items-center gap-1">
            {window.map((entry, i) =>
              entry === "gap" ? (
                <li
                  key={`gap-${i}`}
                  aria-hidden
                  className="px-1 text-sm text-muted-foreground"
                >
                  …
                </li>
              ) : (
                <li key={entry}>
                  <button
                    type="button"
                    onClick={() => go(entry)}
                    aria-current={entry === clamped ? "page" : undefined}
                    className={cn(
                      "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm font-medium tabular-nums outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                      entry === clamped
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {entry}
                  </button>
                </li>
              ),
            )}
          </ul>
        ) : (
          <span className="px-2 text-sm text-muted-foreground tabular-nums">
            Page <span className="font-medium text-foreground">{clamped}</span> of{" "}
            <span className="font-medium text-foreground">{pageCount}</span>
          </span>
        )}

        <PagerIconButton
          label="Next page"
          disabled={!hasNext}
          onClick={() => go(clamped + 1)}
        >
          <ChevronRightIcon aria-hidden />
        </PagerIconButton>
      </div>
    </nav>
  );
}

function PagerIconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4"
    >
      {children}
    </button>
  );
  // Skip the tooltip when disabled — a disabled control has no hover target.
  return disabled ? button : <Tooltip content={label}>{button}</Tooltip>;
}

function RangeSummary({
  page,
  pageCount,
  total,
  pageSize,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize?: number;
}) {
  if (total === 0) return <>No results</>;
  // Derive the per-page size from the caller, or infer it from the totals.
  const size = pageSize ?? Math.ceil(total / Math.max(1, pageCount));
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  return (
    <>
      {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of{" "}
      {total.toLocaleString("en-IN")}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* LoadMoreButton (cursor / infinite)                                  */
/* ------------------------------------------------------------------ */

export interface LoadMoreButtonProps {
  /** Fetch and append the next page. */
  onLoadMore: () => void | Promise<void>;
  /** Whether a fetch is in flight (renders a spinner + disables). */
  loading?: boolean;
  /** True when the list is fully loaded — renders an end marker instead. */
  done?: boolean;
  /** Label on the button. @default "Load more" */
  label?: string;
  /** Copy shown when `done`. Pass an empty string to render nothing. */
  doneLabel?: string;
  className?: string;
}

/**
 * Explicit "load more" control for cursor-paginated lists. Pairs with an
 * IntersectionObserver in the caller for auto-loading; this button is the
 * accessible, always-available fallback (and the sole trigger under reduced
 * data / no-JS-observer situations).
 */
export function LoadMoreButton({
  onLoadMore,
  loading = false,
  done = false,
  label = "Load more",
  doneLabel = "You've reached the end",
  className,
}: LoadMoreButtonProps) {
  if (done) {
    if (!doneLabel) return null;
    return (
      <p
        className={cn(
          "py-4 text-center text-xs text-muted-foreground",
          className,
        )}
      >
        {doneLabel}
      </p>
    );
  }

  return (
    <div className={cn("flex items-center justify-center py-2", className)}>
      <button
        type="button"
        onClick={() => void onLoadMore()}
        disabled={loading}
        aria-busy={loading || undefined}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-medium text-foreground shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
      >
        {loading ? (
          <>
            <Spinner size="sm" label="" />
            Loading…
          </>
        ) : (
          label
        )}
      </button>
    </div>
  );
}
