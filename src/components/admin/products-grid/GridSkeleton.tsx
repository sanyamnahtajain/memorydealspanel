import { Shimmer } from "@/components/common";

/**
 * Skeleton for the bulk-edit DealSheet. Rendered as a Suspense fallback while
 * the (large) product read streams in, so navigating to the grid paints the
 * page shell + a spreadsheet-shaped placeholder instantly instead of freezing
 * on the previous screen. Mirrors the real grid: a toolbar, a header row, then
 * a run of body rows.
 */
export function GridSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-busy
    >
      <span className="sr-only" role="status">
        Loading products…
      </span>

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <Shimmer className="h-8 w-40 rounded-lg" />
        <Shimmer className="h-8 w-24 rounded-lg" />
        <div className="ml-auto flex gap-2">
          <Shimmer className="h-8 w-20 rounded-lg" />
          <Shimmer className="h-8 w-8 rounded-lg" />
        </div>
      </div>

      {/* Header row */}
      <div className="flex gap-3 border-b border-border bg-muted/20 px-3 py-2.5">
        {HEADER_WIDTHS.map((w, i) => (
          <Shimmer key={i} className="h-4 rounded" style={{ width: w }} />
        ))}
      </div>

      {/* Body rows */}
      {Array.from({ length: 12 }, (_, r) => (
        <div
          key={r}
          className="flex items-center gap-3 border-b border-border/60 px-3 py-3"
        >
          {HEADER_WIDTHS.map((w, i) => (
            <Shimmer
              key={i}
              className="h-4 rounded"
              style={{ width: w, opacity: 1 - r * 0.05 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Approximate column widths so the skeleton reads as a spreadsheet. */
const HEADER_WIDTHS = ["18%", "10%", "12%", "9%", "9%", "8%", "7%", "12%"];
