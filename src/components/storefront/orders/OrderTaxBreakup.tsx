/**
 * OrderTaxBreakup — the shared, presentational GST breakup for a placed order.
 *
 * Renders the FROZEN tax snapshot: an HSN summary table (grouped by hsn + rate),
 * the CGST/SGST (intra-state) or IGST (inter-state) or combined-GST totals, the
 * invoice round-off, the grand total, the supply type, and both GSTINs. Used by
 * BOTH the customer proforma (OrderDetailView) and the admin detail panel.
 *
 * PURE / SERVER-RENDERABLE: takes an already-gated, JSON-serializable snapshot
 * and only formats it. It NEVER re-derives or recomputes any amount — a placed
 * order's figures are immutable. The caller decides whether to render it at all
 * (only for a price-authorised viewer), so no gating happens here.
 */

import { formatPaise } from "@/lib/money";

/** Serializable per-order tax snapshot both order views converge on. */
export interface OrderTaxBreakupData {
  supplyType: "INTRA" | "INTER" | null;
  sellerStateCode: string | null;
  sellerGstin: string | null;
  placeOfSupplyStateCode: string | null;
  totalTaxablePaise: number;
  totalCgstPaise: number;
  totalSgstPaise: number;
  totalIgstPaise: number;
  totalTaxPaise: number;
  roundOffPaise: number;
  grandTotalPaise: number;
  hsnSummary: {
    hsnCode: string | null;
    gstRateBps: number;
    taxablePaise: number;
    taxPaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
  }[];
}

/** Whole-basis-points → "18%" / "18.5%". */
function formatRate(gstRateBps: number): string {
  const pct = gstRateBps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

function supplyLabel(supplyType: "INTRA" | "INTER" | null): string {
  if (supplyType === "INTRA") return "Intra-state (CGST + SGST)";
  if (supplyType === "INTER") return "Inter-state (IGST)";
  return "GST (combined — place of supply not set)";
}

export function OrderTaxBreakup({
  tax,
  /** When true, prepend the "Proforma / Quotation — not a tax invoice" banner. */
  proforma = false,
}: {
  tax: OrderTaxBreakupData;
  proforma?: boolean;
}) {
  const intra = tax.supplyType === "INTRA";
  const inter = tax.supplyType === "INTER";
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      {proforma ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          Proforma / Quotation — not a tax invoice.
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Tax breakup</h3>
        <span className="text-xs text-muted-foreground">
          {supplyLabel(tax.supplyType)}
        </span>
      </div>

      {/* HSN summary table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs tabular-nums">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-1.5 pr-2 font-medium">HSN</th>
              <th className="py-1.5 pr-2 font-medium">Rate</th>
              <th className="py-1.5 pr-2 text-right font-medium">Taxable</th>
              {intra ? (
                <>
                  <th className="py-1.5 pr-2 text-right font-medium">CGST</th>
                  <th className="py-1.5 text-right font-medium">SGST</th>
                </>
              ) : inter ? (
                <th className="py-1.5 text-right font-medium">IGST</th>
              ) : (
                <th className="py-1.5 text-right font-medium">GST</th>
              )}
            </tr>
          </thead>
          <tbody className="text-foreground">
            {tax.hsnSummary.map((row, i) => (
              <tr key={`${row.hsnCode ?? ""}-${row.gstRateBps}-${i}`} className="border-b border-border/60">
                <td className="py-1.5 pr-2">{row.hsnCode ?? "—"}</td>
                <td className="py-1.5 pr-2">{formatRate(row.gstRateBps)}</td>
                <td className="py-1.5 pr-2 text-right">{formatPaise(row.taxablePaise)}</td>
                {intra ? (
                  <>
                    <td className="py-1.5 pr-2 text-right">{formatPaise(row.cgstPaise)}</td>
                    <td className="py-1.5 text-right">{formatPaise(row.sgstPaise)}</td>
                  </>
                ) : inter ? (
                  <td className="py-1.5 text-right">{formatPaise(row.igstPaise)}</td>
                ) : (
                  <td className="py-1.5 text-right">{formatPaise(row.taxPaise)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <dl className="flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
        <div className="flex items-center justify-between text-muted-foreground">
          <dt>Taxable value</dt>
          <dd className="tabular-nums">{formatPaise(tax.totalTaxablePaise)}</dd>
        </div>
        {intra ? (
          <>
            <div className="flex items-center justify-between text-muted-foreground">
              <dt>CGST</dt>
              <dd className="tabular-nums">{formatPaise(tax.totalCgstPaise)}</dd>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <dt>SGST</dt>
              <dd className="tabular-nums">{formatPaise(tax.totalSgstPaise)}</dd>
            </div>
          </>
        ) : inter ? (
          <div className="flex items-center justify-between text-muted-foreground">
            <dt>IGST</dt>
            <dd className="tabular-nums">{formatPaise(tax.totalIgstPaise)}</dd>
          </div>
        ) : (
          <div className="flex items-center justify-between text-muted-foreground">
            <dt>GST</dt>
            <dd className="tabular-nums">{formatPaise(tax.totalTaxPaise)}</dd>
          </div>
        )}
        {tax.roundOffPaise !== 0 ? (
          <div className="flex items-center justify-between text-muted-foreground">
            <dt>Round off</dt>
            <dd className="tabular-nums">
              {tax.roundOffPaise > 0 ? "+" : "−"}
              {formatPaise(Math.abs(tax.roundOffPaise))}
            </dd>
          </div>
        ) : null}
        <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
          <dt className="font-semibold text-foreground">Grand total</dt>
          <dd className="text-base font-semibold text-foreground tabular-nums">
            {formatPaise(tax.grandTotalPaise)}
          </dd>
        </div>
      </dl>

      {/* Supply context + both GSTINs */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-[0.7rem] text-muted-foreground">
        {tax.sellerGstin ? (
          <div className="col-span-2 flex justify-between">
            <dt>Seller GSTIN</dt>
            <dd className="font-medium tabular-nums text-foreground">{tax.sellerGstin}</dd>
          </div>
        ) : null}
        {tax.sellerStateCode ? (
          <div className="flex justify-between">
            <dt>Seller state</dt>
            <dd className="tabular-nums text-foreground">{tax.sellerStateCode}</dd>
          </div>
        ) : null}
        <div className="flex justify-between">
          <dt>Place of supply</dt>
          <dd className="tabular-nums text-foreground">
            {tax.placeOfSupplyStateCode ?? "—"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
