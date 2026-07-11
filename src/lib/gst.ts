/**
 * GST tax computation core for MemoryDeals — pure, integer-exact, server-authoritative.
 *
 * NO React, NO Prisma runtime, NO I/O. This is the single source of truth for
 * every GST paise figure the system produces. `src/lib/tax-inherit.ts` (owned by
 * the settings stage) and every DAL/order path must reuse `computeLineTax` and
 * `splitTax` rather than re-deriving the arithmetic.
 *
 * All monetary amounts are integer paise (see `src/lib/money.ts`). GST rates are
 * basis points: 1800 bps === 18.00%. Tax on an INCLUSIVE price is always the
 * REMAINDER (gross − taxable) so `taxable + tax === gross` holds exactly, and the
 * CGST/SGST split gives the remainder paisa to SGST so `cgst + sgst === tax`
 * exactly — no 1-paise drift anywhere.
 */

import { assertPaise } from "./money";

/**
 * Storage/entry treatment of a stored price. Structurally assignable to the
 * Prisma `TaxTreatment` enum (which is a string-literal union of the same
 * members) so this module needs no Prisma runtime import.
 */
export type TaxTreatment = "TAX_EXCLUSIVE" | "TAX_INCLUSIVE";

/** Place-of-supply relationship between seller state and buyer state. */
export type SupplyType = "INTRA" | "INTER";

/** The paise breakup of a single priced line. `taxablePaise + taxPaise === grossPaise` always. */
export interface LineTax {
  /** GST-exclusive taxable base in paise. */
  taxablePaise: number;
  /** Total GST in paise (CGST+SGST or IGST, not yet split). */
  taxPaise: number;
  /** Landed, tax-inclusive amount in paise. */
  grossPaise: number;
}

/** Asserts a non-negative integer basis-points rate. */
function assertBps(gstRateBps: number): void {
  if (typeof gstRateBps !== "number" || Number.isNaN(gstRateBps)) {
    throw new TypeError(`gstRateBps must be a number, got ${String(gstRateBps)}`);
  }
  if (!Number.isInteger(gstRateBps)) {
    throw new RangeError(`gstRateBps must be an integer, got ${gstRateBps}`);
  }
  if (gstRateBps < 0) {
    throw new RangeError(`gstRateBps must not be negative, got ${gstRateBps}`);
  }
}

/**
 * Computes the taxable / tax / gross paise for one line, honouring the stored
 * treatment. Pure and integer-exact.
 *
 * EXCLUSIVE — `amountPaise` is the taxable base:
 *   taxable = amount
 *   tax     = round(amount × bps / 10000)
 *   gross   = taxable + tax
 *
 * INCLUSIVE — `amountPaise` already includes GST (MRP-style):
 *   gross   = amount
 *   taxable = round(amount × 10000 / (10000 + bps))
 *   tax     = gross − taxable        (REMAINDER — never independently rounded)
 *
 * With `gstRateBps === 0`: tax is 0 and taxable === gross === amount for either
 * treatment.
 */
export function computeLineTax(input: {
  amountPaise: number;
  gstRateBps: number;
  treatment: TaxTreatment;
}): LineTax {
  const { amountPaise, gstRateBps, treatment } = input;
  assertPaise(amountPaise, "amountPaise");
  assertBps(gstRateBps);

  if (gstRateBps === 0) {
    return { taxablePaise: amountPaise, taxPaise: 0, grossPaise: amountPaise };
  }

  if (treatment === "TAX_INCLUSIVE") {
    const grossPaise = amountPaise;
    const taxablePaise = Math.round((amountPaise * 10000) / (10000 + gstRateBps));
    const taxPaise = grossPaise - taxablePaise;
    return { taxablePaise, taxPaise, grossPaise };
  }

  // TAX_EXCLUSIVE
  const taxablePaise = amountPaise;
  const taxPaise = Math.round((amountPaise * gstRateBps) / 10000);
  const grossPaise = taxablePaise + taxPaise;
  return { taxablePaise, taxPaise, grossPaise };
}

/** The CGST/SGST/IGST split of a tax amount. `cgst + sgst + igst === taxPaise` always. */
export interface TaxSplit {
  supplyType: SupplyType;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

/**
 * Splits a tax amount by supply type.
 *
 * INTRA (same state) → CGST + SGST, `cgst = floor(tax/2)`, `sgst = tax − cgst`
 * (the odd remainder paisa goes to SGST — no leak). IGST is 0.
 *
 * INTER (different states) → `igst = tax`; CGST and SGST are 0.
 */
export function splitTax(taxPaise: number, supplyType: SupplyType): TaxSplit {
  assertPaise(taxPaise, "taxPaise");
  if (supplyType === "INTRA") {
    const cgstPaise = Math.floor(taxPaise / 2);
    const sgstPaise = taxPaise - cgstPaise;
    return { supplyType, cgstPaise, sgstPaise, igstPaise: 0 };
  }
  if (supplyType === "INTER") {
    return { supplyType, cgstPaise: 0, sgstPaise: 0, igstPaise: taxPaise };
  }
  throw new RangeError(`supplyType must be "INTRA" or "INTER", got ${String(supplyType)}`);
}

/**
 * Decides supply type from seller and place-of-supply state codes.
 *
 * Both present & equal → "INTRA"; both present & different → "INTER". If either
 * is missing (null/undefined/empty) → `null`: the caller must then show a
 * combined "GST @X%" and must NOT split into CGST/SGST (never guess).
 */
export function determineSupplyType(
  sellerStateCode: string | null | undefined,
  placeOfSupplyStateCode: string | null | undefined,
): SupplyType | null {
  const seller = normaliseStateCode(sellerStateCode);
  const buyer = normaliseStateCode(placeOfSupplyStateCode);
  if (seller === null || buyer === null) {
    return null;
  }
  return seller === buyer ? "INTRA" : "INTER";
}

function normaliseStateCode(code: string | null | undefined): string | null {
  if (typeof code !== "string") {
    return null;
  }
  const trimmed = code.trim();
  return trimmed === "" ? null : trimmed;
}

/** Result of nearest-rupee rounding. `grandTotalPaise − roundOffPaise === input`. */
export interface RupeeRounding {
  /** The amount rounded to the nearest whole rupee, in paise (always a multiple of 100). */
  grandTotalPaise: number;
  /** The adjustment applied: grandTotalPaise − input paise. May be negative. */
  roundOffPaise: number;
}

/**
 * Rounds a paise amount to the nearest whole rupee (INVOICE rounding mode).
 * The round-off is emitted explicitly, never silently absorbed. `roundOffPaise`
 * may be negative (rounded down) or positive (rounded up); half rounds up.
 */
export function roundToRupee(paise: number): RupeeRounding {
  assertPaise(paise, "paise");
  const grandTotalPaise = Math.round(paise / 100) * 100;
  return { grandTotalPaise, roundOffPaise: grandTotalPaise - paise };
}

/**
 * One priced line fed to {@link summariseOrderTax}. The caller has already run
 * {@link computeLineTax} to obtain taxable/tax/gross; this shape carries those
 * plus the grouping keys.
 */
export interface OrderTaxLine {
  taxablePaise: number;
  taxPaise: number;
  grossPaise: number;
  gstRateBps: number;
  /** HSN code for grouping; null lines group together under an empty key. */
  hsnCode?: string | null;
}

export interface SummariseOrderTaxOptions {
  supplyType: SupplyType;
  /**
   * LINE (default): totals are the exact sums of the per-line figures, no
   * order-level round-off (`roundOffPaise` is 0, `grandTotalPaise === totalGrossPaise`).
   * INVOICE: one nearest-rupee round-off applied to the summed gross at the end.
   */
  roundingMode?: "LINE" | "INVOICE";
}

/** One row of the HSN summary, grouped by (hsnCode, gstRateBps). */
export interface HsnSummaryRow {
  hsnCode: string | null;
  gstRateBps: number;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

/** Aggregated order-level tax totals plus the grouped HSN summary. */
export interface OrderTaxSummary {
  supplyType: SupplyType;
  totalTaxablePaise: number;
  totalTaxPaise: number;
  totalCgstPaise: number;
  totalSgstPaise: number;
  totalIgstPaise: number;
  /** Sum of per-line gross before any invoice round-off. */
  totalGrossPaise: number;
  /** Invoice-level nearest-rupee adjustment (INVOICE mode); 0 in LINE mode. */
  roundOffPaise: number;
  /** Final payable: totalGrossPaise + roundOffPaise. */
  grandTotalPaise: number;
  /** One row per (hsnCode, gstRateBps), in first-seen order. */
  hsnSummary: HsnSummaryRow[];
}

/**
 * Aggregates priced lines into order totals + an HSN summary grouped by
 * (hsnCode, gstRateBps). Each line's tax is split by the given supply type and
 * summed; the split is computed per line (not on the grand total) so the
 * per-line no-drift guarantees carry through to `cgst + sgst === tax` on every
 * HSN row and on the order total.
 *
 * In INVOICE mode a single nearest-rupee round-off is applied to the summed
 * gross and surfaced as `roundOffPaise`; in LINE mode there is no round-off.
 */
export function summariseOrderTax(
  lines: readonly OrderTaxLine[],
  opts: SummariseOrderTaxOptions,
): OrderTaxSummary {
  const { supplyType, roundingMode = "LINE" } = opts;

  let totalTaxablePaise = 0;
  let totalTaxPaise = 0;
  let totalCgstPaise = 0;
  let totalSgstPaise = 0;
  let totalIgstPaise = 0;
  let totalGrossPaise = 0;

  const groups = new Map<string, HsnSummaryRow>();

  for (const line of lines) {
    assertPaise(line.taxablePaise, "line.taxablePaise");
    assertPaise(line.taxPaise, "line.taxPaise");
    assertPaise(line.grossPaise, "line.grossPaise");
    assertBps(line.gstRateBps);

    const split = splitTax(line.taxPaise, supplyType);

    totalTaxablePaise += line.taxablePaise;
    totalTaxPaise += line.taxPaise;
    totalCgstPaise += split.cgstPaise;
    totalSgstPaise += split.sgstPaise;
    totalIgstPaise += split.igstPaise;
    totalGrossPaise += line.grossPaise;

    const hsnCode = line.hsnCode ?? null;
    const key = `${hsnCode ?? ""}|${line.gstRateBps}`;
    const existing = groups.get(key);
    if (existing) {
      existing.taxablePaise += line.taxablePaise;
      existing.taxPaise += line.taxPaise;
      existing.cgstPaise += split.cgstPaise;
      existing.sgstPaise += split.sgstPaise;
      existing.igstPaise += split.igstPaise;
    } else {
      groups.set(key, {
        hsnCode,
        gstRateBps: line.gstRateBps,
        taxablePaise: line.taxablePaise,
        taxPaise: line.taxPaise,
        cgstPaise: split.cgstPaise,
        sgstPaise: split.sgstPaise,
        igstPaise: split.igstPaise,
      });
    }
  }

  let roundOffPaise = 0;
  let grandTotalPaise = totalGrossPaise;
  if (roundingMode === "INVOICE") {
    const rounded = roundToRupee(totalGrossPaise);
    roundOffPaise = rounded.roundOffPaise;
    grandTotalPaise = rounded.grandTotalPaise;
  }

  return {
    supplyType,
    totalTaxablePaise,
    totalTaxPaise,
    totalCgstPaise,
    totalSgstPaise,
    totalIgstPaise,
    totalGrossPaise,
    roundOffPaise,
    grandTotalPaise,
    hsnSummary: [...groups.values()],
  };
}
