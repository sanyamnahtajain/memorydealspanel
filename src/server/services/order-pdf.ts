import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { prisma } from "@/server/db";
import { APP_NAME, CONTACT } from "@/lib/constants";
import type { OrderItemSnapshot } from "@/server/services/orders";
import { attachmentUrlPrefix } from "@/lib/requirement-notes";
import { publicBaseOrEmpty } from "@/server/storage/r2";
import { DEFAULT_ORDER_PDF_SIZE, type OrderPdfSize } from "@/lib/order-pdf-size";

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
}

/** One customer requirement (note + photo bytes) appended after the bill. */
export interface OrderPdfRequirement {
  /** The product line the requirement belongs to. */
  name: string;
  note: string | null;
  /** Pre-fetched image bytes (JPEG/PNG — sniffed by magic bytes). */
  images: Uint8Array[];
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

/** Render the order in the estimate-bill layout. PURE (no DB). */
export async function renderOrderPdf(
  data: OrderPdfData,
  paperSize: OrderPdfSize = DEFAULT_ORDER_PDF_SIZE,
): Promise<Uint8Array> {
  const dim = PAPER[paperSize];
  const M = dim.margin; // outer margin
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

  const masthead = (first: boolean) => {
    y = dim.h - M;
    if (first) {
      text("ESTIMATE", M, 9, helv, MUTED, "center", W);
      y -= 16;
      text(APP_NAME.toUpperCase(), M, 21, bold, INK, "center", W);
      y -= 15;
      text(`PH: ${CONTACT.phoneDisplay}`, M, 11, bold, INK, "center", W);
      y -= 13;
      text(CONTACT.addressLines.slice(1).join(", "), M, 8.5, helv, MUTED, "center", W);
      y -= 10;
      hline(y);
      y -= 15;
      // Party / bill meta block.
      text("Party Details :", M + 2, 9.5, bold);
      text(`Bill No.  :  ${data.orderNumber}`, M + W / 2, 9.5, bold, INK, "left", 0);
      y -= 13;
      text(data.partyName, M + 2, 10, helv);
      text(`Date      :  ${ddmmyyyy(data.placedAt)}`, M + W / 2, 9.5, helv, INK, "left", 0);
      if (data.partyPhone) {
        y -= 12;
        text(data.partyPhone, M + 2, 9, helv, MUTED);
      }
      y -= 10;
      hline(y);
      y -= 15;
    } else {
      text(`${APP_NAME.toUpperCase()} — Bill No. ${data.orderNumber}`, M, 9.5, bold, MUTED);
      y -= 14;
    }
    tableHeader();
  };

  masthead(true);

  data.lines.forEach((line, i) => {
    if (y < M + 96) {
      page = doc.addPage([dim.w, dim.h]);
      pages.push(page);
      masthead(false);
    }
    let x = M;
    const cells = [
      `${i + 1} .`,
      line.name,
      line.qty.toFixed(2),
      "pcs",
      money(line.ratePaise),
      money(line.amountPaise),
    ];
    cells.forEach((val, ci) => {
      const c = cols[ci];
      let v = winAnsiSafe(val);
      // Truncate the description to its column.
      if (ci === 1) {
        while (v.length > 1 && helv.widthOfTextAtSize(v, 9) > c.w - 8) v = v.slice(0, -1);
      }
      text(v, x + 4, 9, helv, INK, c.align, c.w - 8);
      x += c.w;
    });
    y -= 14;
    // Model-split sub-rows (allocation lines) — staff pick per model.
    if (line.breakdown && line.breakdown.length > 0) {
      for (const b of line.breakdown) {
        if (y < M + 96) {
          page = doc.addPage([dim.w, dim.h]);
          pages.push(page);
          masthead(false);
        }
        text(`- ${b.qty} x ${b.modelName}`, M + cols[0].w + 10, 8, helv, MUTED);
        y -= 11;
      }
      y -= 3;
    }
  });

  // Totals block (kept on one page).
  if (y < M + 96) {
    page = doc.addPage([dim.w, dim.h]);
    pages.push(page);
    y = dim.h - M;
  }
  y -= 4;
  hline(y);
  y -= 16;
  if ((data.discountPaise ?? 0) > 0) {
    text(
      `Discount${data.couponCode ? ` (${data.couponCode})` : ""}`,
      M + W * 0.35,
      9.5,
      helv,
      INK,
      "right",
      W * 0.2,
    );
    text(`- ${money(data.discountPaise ?? 0)}`, M, 9.5, helv, INK, "right", W);
    y -= 14;
  }
  text("Grand Total", M + W * 0.35, 10, bold, INK, "right", W * 0.2);
  text(`${data.totalQty.toFixed(2)} pcs`, M + W * 0.56, 10, bold, INK, "left", 0);
  text(money(data.grandTotalPaise), M, 10.5, bold, INK, "right", W);
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

  // ---- Customer requirements (notes + photos), after the bill ----------
  const requirements = (data.requirements ?? []).filter(
    (r) => r.note || r.images.length > 0,
  );
  if (requirements.length > 0) {
    // Word-wrap a note into lines that fit the printable width.
    const wrap = (raw: string, size: number, width: number): string[] => {
      const out: string[] = [];
      for (const para of winAnsiSafe(raw).split(/\r?\n/)) {
        let current = "";
        for (const word of para.split(/\s+/)) {
          const candidate = current ? `${current} ${word}` : word;
          if (helv.widthOfTextAtSize(candidate, size) <= width) {
            current = candidate;
          } else {
            if (current) out.push(current);
            current = word;
          }
        }
        out.push(current);
      }
      return out;
    };

    page = doc.addPage([dim.w, dim.h]);
    pages.push(page);
    y = dim.h - M;
    text("CUSTOMER REQUIREMENTS", M, 12, bold, INK, "center", W);
    y -= 10;
    hline(y);
    y -= 18;

    for (const req of requirements) {
      if (y < M + 60) {
        page = doc.addPage([dim.w, dim.h]);
        pages.push(page);
        y = dim.h - M;
      }
      text(req.name, M, 10.5, bold);
      y -= 15;
      if (req.note) {
        for (const lineText of wrap(req.note, 9.5, W - 8)) {
          if (y < M + 30) {
            page = doc.addPage([dim.w, dim.h]);
            pages.push(page);
            y = dim.h - M;
          }
          text(lineText, M + 4, 9.5, helv);
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
        if (y - drawH < M + 20) {
          page = doc.addPage([dim.w, dim.h]);
          pages.push(page);
          y = dim.h - M;
        }
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

  const bytes = await renderOrderPdf({
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    partyName: order.customer.businessName || order.customer.contactName,
    partyPhone: order.customer.phone ?? null,
    lines,
    totalQty: items.reduce((s, it) => s + it.quantity, 0),
    grandTotalPaise: order.grandTotalPaise ?? order.subtotalPaise,
    totalTaxPaise: order.taxApplied ? order.totalTaxPaise : null,
    couponCode: order.couponCode ?? null,
    discountPaise: order.discountPaise ?? 0,
    requirements,
  }, paperSize);
  return { bytes, orderNumber: order.orderNumber };
}
