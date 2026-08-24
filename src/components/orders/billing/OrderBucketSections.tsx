import * as React from "react";

import { formatPaise } from "@/lib/money";
import { lineKey } from "@/lib/billing-groups/snapshot";
import { GENERAL_GROUP_CODE, GENERAL_GROUP_NAME } from "@/lib/billing-groups/types";
import { bucketColorClasses } from "./colors";
import { formatBps, type OrderBillingBucketView, type OrderBillingView } from "./types";

/**
 * OrderBucketSections — an order's line rows grouped by billing bucket.
 *
 * Presentational and shared: the admin drawer and the customer views pass
 * their own row component through `renderLine`, so the bucket chrome (header
 * with color accent / code badge / bill number, footer with subtotal,
 * discount and net) is identical on both sides. Lines are matched to buckets
 * by their stable `lineKey`; a line no bucket claims lands under General.
 */

interface BucketLine {
  productId: string;
  variantId: string | null;
}

interface OrderBucketSectionsProps<L extends BucketLine> {
  lines: L[];
  billing: OrderBillingView;
  /** Fallback bill number for a synthesised General section (no GEN bucket). */
  orderNumber: string;
  renderLine: (line: L, index: number) => React.ReactNode;
}

export function OrderBucketSections<L extends BucketLine>({
  lines,
  billing,
  orderNumber,
  renderLine,
}: OrderBucketSectionsProps<L>) {
  // Plain computation (no hooks) so this renders in server components too.
  const sections = groupLines(lines, billing, orderNumber);

  return (
    <div className="space-y-3">
      {sections.map(({ bucket, rows }) => {
        const colors = bucketColorClasses(bucket.color);
        return (
          <section
            key={bucket.code}
            className="overflow-hidden rounded-2xl border border-border bg-card"
            aria-label={`${bucket.name} bill`}
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-border p-3">
              <span className={`h-8 w-1 shrink-0 rounded-full ${colors.accent}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-foreground">{bucket.name}</span>
                  <span
                    className={`rounded-md px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold tracking-wide ${colors.badge}`}
                  >
                    {bucket.code}
                  </span>
                  {bucket.separateBill ? (
                    <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
                      Billed separately
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  Bill No. {bucket.billNumber}
                </p>
              </div>
            </div>

            {/* Lines */}
            <ul className="divide-y divide-border">
              {rows.map(({ line, index }) => (
                <React.Fragment key={`${lineKey(line.productId, line.variantId)}-${index}`}>
                  {renderLine(line, index)}
                </React.Fragment>
              ))}
            </ul>

            {/* Footer */}
            <div className="flex flex-col gap-1 border-t border-border bg-muted/40 px-3 py-2 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatPaise(bucket.subtotalPaise)}</span>
              </div>
              {bucket.discountPaise > 0 ? (
                <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300">
                  <span>
                    {bucket.appliedPercentBps !== null
                      ? `${formatBps(bucket.appliedPercentBps)} discount`
                      : "Discount"}
                  </span>
                  <span className="tabular-nums">−{formatPaise(bucket.discountPaise)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between font-semibold text-foreground">
                <span>Net</span>
                <span className="tabular-nums">{formatPaise(bucket.netPaise)}</span>
              </div>
              {bucket.notes ? (
                <p className="mt-1 whitespace-pre-line text-muted-foreground">{bucket.notes}</p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

interface BucketSection<L> {
  bucket: OrderBillingBucketView;
  rows: { line: L; index: number }[];
}

/**
 * Bucket order as frozen; orphan lines (keys no bucket claims — should not
 * happen, but the snapshot is defensive) join General, synthesising one when
 * the snapshot has none. Empty buckets are skipped.
 */
function groupLines<L extends BucketLine>(
  lines: L[],
  billing: OrderBillingView,
  orderNumber: string,
): BucketSection<L>[] {
  const byKey = new Map<string, BucketSection<L>>();
  const sections: BucketSection<L>[] = billing.buckets.map((bucket) => ({ bucket, rows: [] }));
  for (const s of sections) for (const k of s.bucket.lineKeys) byKey.set(k, s);

  let general = sections.find((s) => s.bucket.code === GENERAL_GROUP_CODE) ?? null;
  lines.forEach((line, index) => {
    const target = byKey.get(lineKey(line.productId, line.variantId));
    if (target) {
      target.rows.push({ line, index });
      return;
    }
    if (!general) {
      general = {
        bucket: {
          code: GENERAL_GROUP_CODE,
          name: GENERAL_GROUP_NAME,
          color: "slate",
          separateBill: false,
          notes: null,
          subtotalPaise: 0,
          discountPaise: 0,
          appliedPercentBps: null,
          netPaise: 0,
          billNumber: `${orderNumber}/${GENERAL_GROUP_CODE}`,
          lineKeys: [],
        },
        rows: [],
      };
      sections.push(general);
    }
    general.rows.push({ line, index });
  });
  return sections.filter((s) => s.rows.length > 0);
}
