import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { prisma } from "@/server/db";
import { APP_NAME, CONTACT } from "@/lib/constants";
import { BUSINESS_PHONE } from "@/server/contact";
import { orderPayablePaise, type OrderItemSnapshot } from "@/server/services/orders";
import { attachmentUrlPrefix } from "@/lib/requirement-notes";
import { publicBaseOrEmpty } from "@/server/storage/r2";
import { DEFAULT_ORDER_PDF_SIZE, type OrderPdfSize } from "@/lib/order-pdf-size";
import { lineKey, parseOrderBillingSnapshot } from "@/lib/billing-groups/snapshot";
import {
  frozenDeliveryChargePaise,
  parseStoredDeliveryDisclosure,
} from "@/lib/delivery";
import { bucketBillNumber } from "@/lib/billing-groups/engine";
import { GENERAL_GROUP_CODE, GENERAL_GROUP_NAME } from "@/lib/billing-groups/types";

/**
 * Order PDF (owner request) — a received order rendered in the shop's
 * ESTIMATE-bill format (the layout of their offline billing software):
 *
 *     ESTIMATE
 *     THE MEMORY DEALS          ← store masthead + phone + address
 *     Party Details | Bill No / Date
 *     S.No | Description of Goods | Qty | Unit | Rate | Amount
 *     Grand Total (qty pcs, amount) + Amount chargeable (in words)
 *
 * Admin-side download (the route is admin-gated). Amounts render as plain
 * numbers with an "Rs." grand total — Helvetica/WinAnsi cannot encode "₹"
 * (their own billing software prints a placeholder there too).
 */

/* ------------------------------------------------------------------ */
/* Amount in words (Indian system)                                     */
/* ------------------------------------------------------------------ */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0–99 → words ("" for 0). */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

/**
 * Integer rupees → Indian-system words: "Seven Hundred Fifty", crore/lakh/
 * thousand/hundred. Zero → "Zero".
 */
export function rupeesInWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  if (crore) parts.push(`${rupeesInWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/** Paise → "Seven Hundred Fifty Only" / "… and Forty-Five Paise Only". */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  const r = rupeesInWords(rupees);
  return p === 0 ? `${r} Only` : `${r} and ${twoDigits(p)} Paise Only`;
}

/* ------------------------------------------------------------------ */
/* Pure layout                                                         */
/* ------------------------------------------------------------------ */

export interface OrderPdfLine {
  name: string;
  qty: number;
  /** Integer paise per unit. */
  ratePaise: number;
  /** Integer paise for the line. */
  amountPaise: number;
  /** Frozen per-model split, rendered as muted sub-rows for preparation. */
  breakdown?: { modelName: string; qty: number }[];
  /** Customer requirement note, shown (wrapped, muted) under the item line. */
  note?: string;
}

/** One customer requirement (note + photo bytes) appended after the bill. */
export interface OrderPdfRequirement {
  /** The product line the requirement belongs to. */
  name: string;
  note: string | null;
  /** Pre-fetched image bytes (JPEG/PNG — sniffed by magic bytes). */
  images: Uint8Array[];
}

/** One billing bucket of the order, for the summary page + its own bill page. */
export interface OrderPdfBucket {
  code: string;
  name: string;
  separateBill: boolean;
  notes: string | null;
  /** "MD-XXXX/DLR" — printed as the bill number of the bucket's page. */
  billNumber: string;
  /** Indexes into `OrderPdfData.lines` (ascending). */
  lineIndexes: number[];
  subtotalPaise: number;
  discountPaise: number;
  /** The tier percentage that applied (basis points), or null when none did. */
  appliedPercentBps: number | null;
  netPaise: number;
}

export interface OrderPdfData {
  orderNumber: string;
  /** Placed-at date, rendered dd-mm-yyyy. */
  placedAt: Date;
  partyName: string;
  partyPhone: string | null;
  lines: OrderPdfLine[];
  totalQty: number;
  /** The chargeable total in paise (grand total when GST applied, else subtotal). */
  grandTotalPaise: number;
  /** Frozen order-level GST total (paise), when tax was applied. */
  totalTaxPaise: number | null;
  /** Coupon frozen at placement (code + discount off the goods subtotal). */
  couponCode?: string | null;
  discountPaise?: number;
  /** Customer requirements (notes + photos) — rendered after the bill. */
  requirements?: OrderPdfRequirement[];
  /**
   * Frozen billing buckets. When present the document is a run of sequential
   * bills — "BILL 1 OF n", "BILL 2 OF n", … each with its own goods table and
   * bill total, separated by dashed cut lines — closed by ONE "ORDER TOTAL"
   * block. When absent the single-bill layout renders exactly as before.
   */
  billing?: {
    groupDiscountPaise: number;
    buckets: OrderPdfBucket[];
  };
  /**
   * Frozen delivery disclosure (owner request): the minimum charge always
   * collected, printed under the totals with the weight/size/PIN-code caveat.
   */
  delivery?: { minChargePaise: number; note: string | null } | null;
  /**
   * The delivery CHARGE frozen on the order (integer paise). When > 0 it prints
   * as a REAL totals line ("Delivery (minimum)") just before the Grand Total —
   * and `grandTotalPaise` above must ALREADY include it, so the amount in words
   * matches the figure. 0 (or absent) on an order placed before delivery was
   * charged: nothing extra prints and the bill is byte-for-byte as it was.
   */
  deliveryChargePaise?: number;
}

/**
 * Sheet sizes the download offers (owner request). Dimensions in PDF points.
 * A5 (half of A4) tightens the outer margin and the fixed money columns so the
 * same estimate layout stays balanced on the smaller sheet — the description
 * column takes the remaining width, and rows simply paginate sooner. A4 keeps
 * its original numbers, so A4 bills render exactly as before.
 */
const PAPER: Record<
  OrderPdfSize,
  {
    w: number;
    h: number;
    margin: number;
    cols: { sno: number; qty: number; unit: number; rate: number; amount: number };
  }
> = {
  A4: { w: 595.28, h: 841.89, margin: 46, cols: { sno: 34, qty: 56, unit: 40, rate: 70, amount: 84 } },
  A5: { w: 419.53, h: 595.28, margin: 32, cols: { sno: 28, qty: 46, unit: 30, rate: 58, amount: 72 } },
};
const INK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.4, 0.4, 0.4);

function winAnsiSafe(s: string): string {
  return s.replace(/[^\x20-\x7E\xA0-\xFF]+/g, "?").replace(/\?{2,}/g, "?");
}

/** paise → "500.00" (bill-style two-decimal number, Indian grouping). */
function money(paise: number): string {
  const rupees = paise / 100;
  return rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ddmmyyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/** "600" bps → "6"; "1250" → "12.5" (for the "Dealer discount 6%" row). */
function percentLabel(bps: number): string {
  return (bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** A discount line in a totals block: "Discount (CODE)   - 50.00". */
interface DiscountRow {
  label: string;
  paise: number;
}

/** What one totals block prints (the order's, or a single bucket's). */
interface TotalsSpec {
  /** Printed as a leading "Subtotal" row when set (summary page only). */
  subtotalPaise?: number;
  discounts: DiscountRow[];
  totalQty: number;
  grandTotalPaise: number;
  /** "Includes GST" line when set. */
  taxPaise: number | null;
  /** Bucket notes, wrapped (muted) under the amount in words. */
  notes?: string | null;
}

/** One bill page to print when billing buckets are present. */
interface BillPage {
  billNumber: string;
  /** "Dealer" — shown beside the party block. */
  label: string;
  lineIndexes: number[];
  totals: TotalsSpec;
}

/** Render the order in the estimate-bill layout. PURE (no DB). */
export async function renderOrderPdf(
  data: OrderPdfData,
  paperSize: OrderPdfSize = DEFAULT_ORDER_PDF_SIZE,
): Promise<Uint8Array> {
  const dim = PAPER[paperSize];
  const M = dim.margin; // outer margin
  // The delivery charge already inside `data.grandTotalPaise`; 0 disables every
  // delivery line below, so a pre-charge order prints exactly as it always did.
  const deliveryChargePaise = data.deliveryChargePaise ?? 0;
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pages: PDFPage[] = [];
  let page = doc.addPage([dim.w, dim.h]);
  pages.push(page);
  const W = dim.w - M * 2;
  let y = dim.h - M;

  const text = (
    t: string, x: number, size: number, font: PDFFont,
    color = INK, align: "left" | "right" | "center" = "left", width = 0,
  ) => {
    const s = winAnsiSafe(t);
    let tx = x;
    if (align === "right") tx = x + width - font.widthOfTextAtSize(s, size);
    if (align === "center") tx = x + (width - font.widthOfTextAtSize(s, size)) / 2;
    page.drawText(s, { x: tx, y, size, font, color });
  };
  const hline = (yy: number) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: dim.w - M, y: yy }, thickness: 0.8, color: INK });
  /** Full-width dotted rule (totals separators). */
  const dotted = (yy: number) =>
    page.drawLine({
      start: { x: M, y: yy },
      end: { x: dim.w - M, y: yy },
      thickness: 1,
      color: MUTED,
      dashArray: [1, 3],
    });
  /** Full-width dashed "cut here" rule (between bills). */
  const dashed = (yy: number) =>
    page.drawLine({
      start: { x: M, y: yy },
      end: { x: dim.w - M, y: yy },
      thickness: 1.1,
      color: INK,
      dashArray: [6, 4],
    });
  /** Start a fresh sheet (no masthead) with the cursor at the top margin. */
  const newPage = () => {
    page = doc.addPage([dim.w, dim.h]);
    pages.push(page);
    y = dim.h - M;
  };

  /**
   * Word-wrap `raw` to lines that fit `width` at `size`. Long single tokens are
   * hard-broken by character so nothing ever overflows the column. Never
   * returns an empty array (so callers can rely on `.length >= 1`).
   */
  const wrapToWidth = (raw: string, font: PDFFont, size: number, width: number): string[] => {
    const out: string[] = [];
    let cur = "";
    for (let word of winAnsiSafe(raw).split(/\s+/).filter(Boolean)) {
      // A token wider than the whole column: chop it into column-wide chunks.
      while (font.widthOfTextAtSize(word, size) > width && word.length > 1) {
        let chunk = word;
        while (chunk.length > 1 && font.widthOfTextAtSize(chunk, size) > width) chunk = chunk.slice(0, -1);
        if (cur) { out.push(cur); cur = ""; }
        out.push(chunk);
        word = word.slice(chunk.length);
      }
      const candidate = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) cur = candidate;
      else { if (cur) out.push(cur); cur = word; }
    }
    if (cur) out.push(cur);
    return out.length > 0 ? out : [""];
  };

  // Columns of the goods table (mirrors the bill: S.No wide description, Qty, Unit, Rate, Amount).
  // Fixed widths come from the paper size; the description takes the remainder.
  const { sno, qty, unit, rate, amount } = dim.cols;
  const cols = [
    { label: "S.No", w: sno, align: "left" as const },
    { label: "Description of Goods", w: W - sno - qty - unit - rate - amount, align: "left" as const },
    { label: "Qty.", w: qty, align: "right" as const },
    { label: "Unit", w: unit, align: "center" as const },
    { label: "Rate", w: rate, align: "right" as const },
    { label: "Amount (Rs.)", w: amount, align: "right" as const },
  ];

  const tableHeader = () => {
    let x = M;
    for (const c of cols) {
      text(c.label, x + 4, 9, bold, INK, c.align, c.w - 8);
      x += c.w;
    }
    y -= 5;
    hline(y);
    y -= 14;
  };

  // The bill number the current sheet belongs to (continuation mastheads
  // repeat it). The order number for the single bill; "MD-XXXX/DLR" on a
  // bucket's page.
  let billNumber = data.orderNumber;

  /**
   * Sheet masthead. `first` prints the full store block + party/bill meta;
   * continuation sheets print a one-line reminder. `heading` is the muted
   * document title ("ESTIMATE" / "ORDER SUMMARY"); `group` adds a "Group :"
   * line to the bill meta on a bucket's page. `withTable` adds the goods
   * table header (the summary page has its own table).
   */
  const masthead = (
    first: boolean,
    heading = "ESTIMATE",
    group: string | null = null,
    withTable = true,
    metaLabel = "Bill No.",
  ) => {
    y = dim.h - M;
    if (first) {
      text(heading, M, 9, helv, MUTED, "center", W);
      y -= 16;
      text(APP_NAME.toUpperCase(), M, 21, bold, INK, "center", W);
      y -= 15;
      text(`PH: ${BUSINESS_PHONE.display}`, M, 11, bold, INK, "center", W);
      y -= 13;
      text(CONTACT.addressLines.slice(1).join(", "), M, 8.5, helv, MUTED, "center", W);
      y -= 10;
      hline(y);
      y -= 15;
      // Party / bill meta block.
      text("Party Details :", M + 2, 9.5, bold);
      text(`${metaLabel}  :  ${billNumber}`, M + W / 2, 9.5, bold, INK, "left", 0);
      y -= 13;
      text(data.partyName, M + 2, 10, helv);
      text(`Date      :  ${ddmmyyyy(data.placedAt)}`, M + W / 2, 9.5, helv, INK, "left", 0);
      if (data.partyPhone) {
        y -= 12;
        text(data.partyPhone, M + 2, 9, helv, MUTED);
      }
      if (group) {
        y -= 12;
        text(`Group     :  ${group}`, M + W / 2, 9.5, helv, INK, "left", 0);
      }
      y -= 10;
      hline(y);
      y -= 15;
    } else {
      text(`${APP_NAME.toUpperCase()} — Bill No. ${billNumber}`, M, 9.5, bold, MUTED);
      y -= 14;
    }
    if (withTable) tableHeader();
  };

  const descCol = cols[1];
  const descX = M + cols[0].w; // description column starts after S.No

  /** The goods table rows for `lines` (S.No 1..n), paginating with continuation mastheads. */
  const goodsRows = (lines: OrderPdfLine[]) => {
    lines.forEach((line, i) => {
      // The FULL product name wraps to as many lines as it needs (never
      // truncated — the whole reason the name was invisible on the A5 sheet),
      // and the customer's requirement note prints (muted) right under it, so
      // it's always on the bill instead of only in the photo appendix.
      const nameLines = wrapToWidth(line.name, helv, 9, descCol.w - 8);
      const noteLines = line.note ? wrapToWidth(line.note, helv, 8, descCol.w - 12) : [];
      const rowHeight = nameLines.length * 12 + noteLines.length * 10;

      // Page-break when this whole (possibly tall) row wouldn't clear the bottom.
      if (y - rowHeight < M + 40) {
        newPage();
        masthead(false);
      }

      const rowTop = y;

      // Fixed cells (S.No, Qty, Unit, Rate, Amount) sit on the first line.
      const fixed: (string | null)[] = [
        `${i + 1} .`,
        null,
        line.qty.toFixed(2),
        "pcs",
        money(line.ratePaise),
        money(line.amountPaise),
      ];
      let x = M;
      cols.forEach((c, ci) => {
        const val = fixed[ci];
        if (ci !== 1 && val != null) {
          y = rowTop;
          text(winAnsiSafe(val), x + 4, 9, helv, INK, c.align, c.w - 8);
        }
        x += c.w;
      });

      // Description column: wrapped name lines, then wrapped note lines.
      y = rowTop;
      for (const nl of nameLines) {
        text(nl, descX + 4, 9, helv, INK, "left", descCol.w - 8);
        y -= 12;
      }
      for (const nl of noteLines) {
        text(nl, descX + 8, 8, helv, MUTED, "left", descCol.w - 12);
        y -= 10;
      }

      // Normalize to the bottom of the tallest column, plus a little breathing room.
      y = rowTop - rowHeight - 2;
      // Model-split sub-rows (allocation lines) — staff pick per model.
      if (line.breakdown && line.breakdown.length > 0) {
        for (const b of line.breakdown) {
          if (y < M + 96) {
            newPage();
            masthead(false);
          }
          text(`- ${b.qty} x ${b.modelName}`, M + cols[0].w + 10, 8, helv, MUTED);
          y -= 11;
        }
        y -= 3;
      }
    });
  };

  /** A right-aligned label/amount pair in the totals area. */
  const totalsRow = (label: string, value: string, font: PDFFont, size: number) => {
    text(label, M + W * 0.35, size, font, INK, "right", W * 0.2);
    text(value, M, size, font, INK, "right", W);
    y -= 14;
  };

  /** Totals block (kept on one page): discounts, grand total, amount in words, GST, notes. */
  const totalsBlock = (spec: TotalsSpec) => {
    if (y < M + 96) newPage();
    y -= 4;
    hline(y);
    y -= 16;
    if (spec.subtotalPaise != null) totalsRow("Subtotal", money(spec.subtotalPaise), helv, 9.5);
    for (const d of spec.discounts) totalsRow(d.label, `- ${money(d.paise)}`, helv, 9.5);
    // Delivery is a CHARGE: it prints AFTER every discount and is added, not
    // subtracted. Only on the order's own totals — never inside a bucket bill.
    if (deliveryChargePaise > 0) {
      totalsRow("Delivery (minimum)", `+ ${money(deliveryChargePaise)}`, helv, 9.5);
    }
    text("Grand Total", M + W * 0.35, 10, bold, INK, "right", W * 0.2);
    text(`${spec.totalQty.toFixed(2)} pcs`, M + W * 0.56, 10, bold, INK, "left", 0);
    text(money(spec.grandTotalPaise), M, 10.5, bold, INK, "right", W);
    y -= 8;
    hline(y);
    y -= 16;
    text("Amount chargeable (in words)", M + 2, 8.5, helv, MUTED);
    y -= 12;
    text(amountInWords(spec.grandTotalPaise), M + 2, 9.5, bold);
    if (spec.taxPaise != null) {
      y -= 14;
      text(`Includes GST: Rs. ${money(spec.taxPaise)}`, M + 2, 8.5, helv, MUTED);
    }
    if (spec.notes) {
      y -= 16;
      text("Notes", M + 2, 8.5, helv, MUTED);
      y -= 12;
      for (const nl of wrapToWidth(spec.notes, helv, 8.5, W - 8)) {
        if (y < M + 30) newPage();
        text(nl, M + 4, 8.5, helv, MUTED);
        y -= 11;
      }
    }
  };

  const couponRows: DiscountRow[] =
    (data.discountPaise ?? 0) > 0
      ? [{ label: `Discount${data.couponCode ? ` (${data.couponCode})` : ""}`, paise: data.discountPaise ?? 0 }]
      : [];

  /**
   * BILL i OF n — a bill's section header. The first bill sits right under the
   * shared masthead; every later bill is preceded by a dashed "cut here" rule
   * (or a fresh sheet when the current one is nearly full — paper saver).
   */
  const MIN_BILL_SECTION = 170; // header + a couple of rows + bill totals
  const startBillSection = (bill: BillPage, index: number, count: number) => {
    billNumber = bill.billNumber;
    if (y < M + MIN_BILL_SECTION) {
      newPage();
      text(`${APP_NAME.toUpperCase()} — Order No. ${data.orderNumber}`, M, 8.5, helv, MUTED);
      y -= 18;
    } else if (index > 0) {
      // The beautiful part: a dashed cut line between consecutive bills.
      y -= 10;
      dashed(y);
      y -= 22;
    } else {
      y -= 2;
    }
    text(`BILL ${index + 1} OF ${count}`, M, 8, bold, MUTED, "left", 0);
    text(`No. ${bill.billNumber}`, M, 8.5, helv, MUTED, "right", W);
    y -= 13;
    text(bill.label, M, 11, bold);
    y -= 8;
    hline(y);
    y -= 14;
    tableHeader();
  };

  /** A bill's own totals: dotted rule → subtotal / discount → BILL TOTAL. */
  const billTotals = (bill: BillPage) => {
    const t = bill.totals;
    if (y < M + 80) newPage();
    y -= 2;
    dotted(y);
    y -= 15;
    if (t.subtotalPaise != null && t.discounts.length > 0) {
      totalsRow("Subtotal", money(t.subtotalPaise), helv, 9.5);
    }
    for (const d of t.discounts) totalsRow(d.label, `- ${money(d.paise)}`, helv, 9.5);
    text("Bill Total", M + W * 0.35, 10, bold, INK, "right", W * 0.2);
    text(`${t.totalQty.toFixed(2)} pcs`, M + W * 0.56, 10, bold, INK, "left", 0);
    text(money(t.grandTotalPaise), M, 10.5, bold, INK, "right", W);
    y -= 10;
    if (t.notes) {
      for (const nl of wrapToWidth(t.notes, helv, 8, W - 8)) {
        if (y < M + 24) newPage();
        text(nl, M + 2, 8, helv, MUTED);
        y -= 10;
      }
    }
    y -= 4;
  };

  /**
   * The closing ORDER TOTAL: a double rule, one line per bill's total, a
   * dotted rule, the coupon (order-level), then the grand total + words.
   */
  const orderTotalBlock = (bills: BillPage[]) => {
    const needed =
      130 + bills.length * 13 + couponRows.length * 13 + (deliveryChargePaise > 0 ? 13 : 0);
    if (y < M + needed) newPage();
    y -= 4;
    hline(y);
    page.drawLine({
      start: { x: M, y: y - 2.5 },
      end: { x: dim.w - M, y: y - 2.5 },
      thickness: 0.8,
      color: INK,
    });
    y -= 22;
    text("ORDER TOTAL", M, 11, bold, INK, "center", W);
    y -= 18;
    bills.forEach((b, i) => {
      text(`Bill ${i + 1}  ·  ${b.label}  ·  ${b.billNumber}`, M + 2, 9, helv);
      text(money(b.totals.grandTotalPaise), M, 9.5, helv, INK, "right", W);
      y -= 13;
    });
    y -= 2;
    dotted(y);
    y -= 15;
    for (const d of couponRows) {
      text(d.label, M + 2, 9.5, helv);
      text(`- ${money(d.paise)}`, M, 9.5, helv, INK, "right", W);
      y -= 13;
    }
    // Delivery: one charge for the WHOLE order, so it belongs here — after the
    // per-bill totals and the coupon — never split across the bucket bills.
    if (deliveryChargePaise > 0) {
      text("Delivery (minimum)", M + 2, 9.5, helv);
      text(`+ ${money(deliveryChargePaise)}`, M, 9.5, helv, INK, "right", W);
      y -= 13;
    }
    text("Grand Total", M + 2, 10.5, bold);
    text(`${data.totalQty.toFixed(2)} pcs`, M + W * 0.5, 10, bold, INK, "left", 0);
    text(money(data.grandTotalPaise), M, 11, bold, INK, "right", W);
    y -= 8;
    hline(y);
    y -= 16;
    text("Amount chargeable (in words)", M + 2, 8.5, helv, MUTED);
    y -= 12;
    text(amountInWords(data.grandTotalPaise), M + 2, 9.5, bold);
    if (data.totalTaxPaise != null) {
      y -= 14;
      text(`Includes GST: Rs. ${money(data.totalTaxPaise)}`, M + 2, 8.5, helv, MUTED);
    }
    y -= 6;
  };

  if (!data.billing) {
    // Single bill — the pre-billing-groups layout, unchanged.
    masthead(true);
    goodsRows(data.lines);
    totalsBlock({
      discounts: couponRows,
      totalQty: data.totalQty,
      grandTotalPaise: data.grandTotalPaise,
      taxPaise: data.totalTaxPaise,
    });
  } else {
    // Bucketed order: ONE shared masthead (store + party + ORDER number),
    // then the bills in sequence — no summary table (owner request) — closed
    // by the single ORDER TOTAL block.
    masthead(true, "ESTIMATE", null, false, "Order No.");
    const bills = billPages(data);
    bills.forEach((bill, index) => {
      startBillSection(bill, index, bills.length);
      goodsRows(bill.lineIndexes.map((li) => data.lines[li]));
      billTotals(bill);
    });
    billNumber = data.orderNumber;
    orderTotalBlock(bills);
  }

  // ---- Delivery terms (owner request) — under the totals ---------------
  // The frozen minimum delivery charge + the weight/size/PIN-code caveat, in
  // simple English. Two eras, both printed verbatim as the buyer saw them:
  //  - charged (today): the amount IS a line in the Grand Total above, and is
  //    still a MINIMUM that can rise;
  //  - disclosed-only (orders placed before the charge): the original "extra
  //    (not included above)" wording, so an old bill reprints unchanged.
  if (data.delivery) {
    // Room for the heading + the (longer, charged) caveat + an optional note.
    if (y < M + 96) newPage();
    y -= 4;
    dotted(y);
    y -= 15;
    text(
      deliveryChargePaise > 0
        ? `Delivery (minimum): Rs. ${money(deliveryChargePaise)} — included in the Grand Total above.`
        : `Delivery: at least Rs. ${money(data.delivery.minChargePaise)} extra (not included above).`,
      M + 2,
      9,
      bold,
    );
    y -= 12;
    for (const nl of wrapToWidth(
      deliveryChargePaise > 0
        ? "This is the minimum. The final delivery charge depends on parcel weight, parcel size and the PIN code; anything above this is confirmed before dispatch."
        : "Final delivery charge depends on parcel weight, parcel size and the PIN code.",
      helv,
      8,
      W - 8,
    )) {
      text(nl, M + 2, 8, helv, MUTED);
      y -= 10;
    }
    if (data.delivery.note) {
      for (const nl of wrapToWidth(data.delivery.note, helv, 8, W - 8)) {
        if (y < M + 24) newPage();
        text(nl, M + 2, 8, helv, MUTED);
        y -= 10;
      }
    }
    y -= 4;
  }

  // ---- Customer requirement PHOTOS, after the bill ---------------------
  // The note TEXT now prints inline under each item above, so this appendix is
  // only for the photographed lists (items that actually carry images). The
  // note is repeated (muted) under each photo group as a caption for staff.
  const requirements = (data.requirements ?? []).filter((r) => r.images.length > 0);
  if (requirements.length > 0) {
    // Flow onto the current sheet when there's meaningful room for at least a
    // heading + one photo; only a nearly-full sheet forces a page break.
    if (y < M + 150) {
      newPage();
    } else {
      y -= 8;
      page.drawLine({
        start: { x: M, y }, end: { x: dim.w - M, y }, thickness: 1.6, color: INK,
      });
      y -= 20;
    }
    text("CUSTOMER REQUIREMENT PHOTOS", M, 12, bold, INK, "center", W);
    y -= 10;
    hline(y);
    y -= 18;

    for (const req of requirements) {
      if (y < M + 60) newPage();
      text(req.name, M, 10.5, bold);
      y -= 15;
      if (req.note) {
        for (const lineText of wrapToWidth(req.note, helv, 9.5, W - 8)) {
          if (y < M + 30) newPage();
          text(lineText, M + 4, 9.5, helv, MUTED);
          y -= 12;
        }
        y -= 4;
      }
      for (const bytes of req.images) {
        // Sniff the format — client uploads are forced to JPEG, but old or
        // hand-uploaded PNGs still embed; anything else is skipped.
        const isPng =
          bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50;
        const isJpg =
          bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
        if (!isPng && !isJpg) continue;
        let image;
        try {
          image = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        } catch {
          continue; // corrupt image — never sink the whole PDF
        }
        // Fit within the printable width and a generous height so a
        // photographed list stays readable.
        const maxW = W;
        const maxH = 460;
        const scale = Math.min(maxW / image.width, maxH / image.height, 1);
        const drawW = image.width * scale;
        const drawH = image.height * scale;
        if (y - drawH < M + 20) newPage();
        page.drawImage(image, { x: M, y: y - drawH, width: drawW, height: drawH });
        y -= drawH + 14;
      }
      y -= 8;
    }
  }

  // Page numbers (only when multi-page — the single-page bill stays clean).
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      const label = `Page ${i + 1} of ${pages.length}`;
      p.drawText(label, {
        x: dim.w - M - helv.widthOfTextAtSize(label, 8),
        y: M - 16, size: 8, font: helv, color: MUTED,
      });
    });
  }

  return doc.save();
}

/**
 * The bill pages to print after the summary: one per separately-billed
 * bucket, then ONE General page carrying every other line (the General bucket
 * plus any bucket not billed separately — their discounts still print as their
 * own rows). Empty pages are skipped.
 */
function billPages(data: OrderPdfData): BillPage[] {
  const buckets = data.billing?.buckets ?? [];
  const separate = buckets.filter((b) => b.separateBill);
  const merged = buckets.filter((b) => !b.separateBill);
  const lineQty = (indexes: number[]) => indexes.reduce((s, i) => s + (data.lines[i]?.qty ?? 0), 0);
  const discountRow = (b: OrderPdfBucket): DiscountRow[] =>
    b.discountPaise > 0
      ? [{
          label: b.appliedPercentBps != null
            ? `${b.name} discount ${percentLabel(b.appliedPercentBps)}%`
            : `${b.name} discount`,
          paise: b.discountPaise,
        }]
      : [];

  const pages: BillPage[] = separate
    .filter((b) => b.lineIndexes.length > 0)
    .map((b) => ({
      billNumber: b.billNumber,
      label: `${b.name} (${b.code})`,
      lineIndexes: b.lineIndexes,
      totals: {
        subtotalPaise: b.subtotalPaise,
        discounts: discountRow(b),
        totalQty: lineQty(b.lineIndexes),
        grandTotalPaise: b.netPaise,
        taxPaise: null,
        notes: b.notes,
      },
    }));

  // General: every line no separate bucket claims, in order.
  const claimed = new Set(separate.flatMap((b) => b.lineIndexes));
  const generalIdx = data.lines.map((_, i) => i).filter((i) => !claimed.has(i));
  if (generalIdx.length > 0) {
    const general = merged.find((b) => b.code === GENERAL_GROUP_CODE);
    const subtotal = generalIdx.reduce((s, i) => s + data.lines[i].amountPaise, 0);
    const discount = merged.reduce((s, b) => s + b.discountPaise, 0);
    const notes = merged.map((b) => b.notes).filter((n): n is string => !!n).join("\n");
    pages.push({
      billNumber: general?.billNumber ?? bucketBillNumber(data.orderNumber, GENERAL_GROUP_CODE),
      label: `${GENERAL_GROUP_NAME} (${GENERAL_GROUP_CODE})`,
      lineIndexes: generalIdx,
      totals: {
        subtotalPaise: subtotal,
        discounts: merged.flatMap(discountRow),
        totalQty: lineQty(generalIdx),
        grandTotalPaise: subtotal - discount,
        taxPaise: null,
        notes: notes || null,
      },
    });
  }
  return pages;
}

/* ------------------------------------------------------------------ */
/* DB entry point                                                      */
/* ------------------------------------------------------------------ */

/** Load an order + customer and render the estimate PDF. Null when not found. */
export async function buildOrderPdf(
  orderId: string,
  paperSize: OrderPdfSize = DEFAULT_ORDER_PDF_SIZE,
): Promise<{ bytes: Uint8Array; orderNumber: string } | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: { select: { businessName: true, contactName: true, phone: true } } },
  });
  if (!order) return null;

  const items = (order.items as unknown as OrderItemSnapshot[]) ?? [];
  const lines: OrderPdfLine[] = items.map((it) => ({
    name: it.variantLabel ? `${it.name} — ${it.variantLabel}` : it.name,
    qty: it.quantity,
    ratePaise: it.unitPricePaise,
    amountPaise: it.lineTotalPaise,
    ...(it.breakdown && it.breakdown.length > 0
      ? { breakdown: it.breakdown }
      : {}),
    // Customer requirement note → printed inline (muted) under the item.
    ...(typeof it.note === "string" && it.note.trim() !== ""
      ? { note: it.note.trim() }
      : {}),
  }));

  // Fetch requirement photos server-side so the PDF is self-contained for the
  // staff. SSRF hygiene: only URLs under OUR storage prefix are fetched (the
  // snapshot was sanitized at placement; this re-checks anyway), bounded in
  // count, size and time — a dead image never sinks the whole PDF.
  const base = publicBaseOrEmpty();
  const prefix = base ? attachmentUrlPrefix(base) : null;
  const requirements: OrderPdfRequirement[] = [];
  for (const it of items) {
    const note = typeof it.note === "string" && it.note.trim() !== "" ? it.note : null;
    const urls = (it.attachments ?? [])
      .map((a) => a?.url)
      .filter(
        (u): u is string =>
          prefix !== null && typeof u === "string" && u.startsWith(prefix),
      )
      .slice(0, 6);
    if (!note && urls.length === 0) continue;
    const images: Uint8Array[] = [];
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) continue;
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length > 0 && buf.length <= 8 * 1024 * 1024) images.push(buf);
      } catch {
        // Unreachable image — the note and the other photos still render.
      }
    }
    requirements.push({
      name: it.variantLabel ? `${it.name} — ${it.variantLabel}` : it.name,
      note,
      images,
    });
  }

  // Frozen billing buckets → line indexes (the PDF layer never sees keys).
  const snapshot = parseOrderBillingSnapshot(order.billingGroups);
  const indexByKey = new Map(items.map((it, i) => [lineKey(it.productId, it.variantId), i]));
  const billing: OrderPdfData["billing"] = snapshot
    ? {
        groupDiscountPaise: snapshot.groupDiscountPaise,
        buckets: snapshot.buckets.map((b) => ({
          code: b.code,
          name: b.name,
          separateBill: b.separateBill,
          notes: b.notes,
          billNumber: bucketBillNumber(order.orderNumber, b.code),
          lineIndexes: b.lineKeys
            .map((k) => indexByKey.get(k))
            .filter((i): i is number => i !== undefined)
            .sort((a, z) => a - z),
          subtotalPaise: b.subtotalPaise,
          discountPaise: b.discountPaise,
          appliedPercentBps: b.appliedTier?.percentBps ?? null,
          netPaise: b.netPaise,
        })),
      }
    : undefined;

  // The payable total = frozen goods total (incl. GST, net of every discount)
  // PLUS the frozen delivery charge. `orderPayablePaise` is the one formula
  // every surface shares; a pre-charge order reads 0 delivery and is unchanged.
  const deliveryChargePaise = frozenDeliveryChargePaise(order.deliveryChargePaise);

  const bytes = await renderOrderPdf({
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    partyName: order.customer.businessName || order.customer.contactName,
    partyPhone: order.customer.phone ?? null,
    lines,
    totalQty: items.reduce((s, it) => s + it.quantity, 0),
    grandTotalPaise: orderPayablePaise(order),
    deliveryChargePaise,
    totalTaxPaise: order.taxApplied ? order.totalTaxPaise : null,
    couponCode: order.couponCode ?? null,
    discountPaise: order.discountPaise ?? 0,
    requirements,
    ...(billing ? { billing } : {}),
    delivery: parseStoredDeliveryDisclosure(order.deliveryDisclosure),
  }, paperSize);
  return { bytes, orderNumber: order.orderNumber };
}
