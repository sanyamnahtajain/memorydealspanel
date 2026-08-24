import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { prisma } from "@/server/db";
import { APP_NAME, CONTACT } from "@/lib/constants";
import { BUSINESS_PHONE } from "@/server/contact";

/**
 * Catalogue / price-list PDF (owner request) — a downloadable product PDF for
 * BOTH sides of the price gate:
 *
 *   PRICED  (admin, or an APPROVED buyer with a live grant): S.No / Product /
 *           Brand / MRP / Price — the trade price list, styled like the shop's
 *           estimate bill (store name + phone header).
 *   PUBLIC  (anonymous / pending / expired): the same catalogue WITHOUT any
 *           money — S.No / Product / Brand / Category + "price on approval".
 *
 * THE GATE IS STRUCTURAL: `loadCatalogPdfRows` SELECTS price/mrp only for the
 * priced variant — the public query never reads a money column, so a price
 * cannot leak into the public PDF even by a later layout bug (mirrors the
 * PublicProduct DTO discipline).
 *
 * pdf-lib + standard Helvetica (WinAnsi): no webfont, no native deps — safe on
 * the Vercel build. WinAnsi cannot encode "₹" (the shop's own billing software
 * prints a placeholder there too), so amounts render as "Rs. 1,299".
 */

/* ------------------------------------------------------------------ */
/* Rows (gate-split projections)                                       */
/* ------------------------------------------------------------------ */

export interface CatalogPdfRowPublic {
  name: string;
  brand: string;
  category: string;
}

export interface CatalogPdfRowPriced extends CatalogPdfRowPublic {
  /** Integer paise. */
  pricePaise: number;
  /** Integer paise, or null when unset. */
  mrpPaise: number | null;
}

/** Load ACTIVE, non-deleted products for the PDF. Price selected ONLY when priced. */
export async function loadCatalogPdfRows(priced: boolean): Promise<{
  rows: CatalogPdfRowPublic[] | CatalogPdfRowPriced[];
}> {
  const categories = await prisma.category.findMany({ select: { id: true, name: true } });
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  if (priced) {
    const products = await prisma.product.findMany({
      where: { deletedAt: null, status: "ACTIVE" },
      orderBy: [{ categoryId: "asc" }, { name: "asc" }],
      select: { name: true, brand: true, categoryId: true, price: true, mrp: true },
    });
    const rows: CatalogPdfRowPriced[] = products.map((p) => ({
      name: p.name,
      brand: p.brand ?? "",
      category: categoryName.get(p.categoryId) ?? "",
      pricePaise: p.price,
      mrpPaise: p.mrp,
    }));
    return { rows };
  }

  // PUBLIC: the select physically omits every money column.
  const products = await prisma.product.findMany({
    where: { deletedAt: null, status: "ACTIVE" },
    orderBy: [{ categoryId: "asc" }, { name: "asc" }],
    select: { name: true, brand: true, categoryId: true },
  });
  const rows: CatalogPdfRowPublic[] = products.map((p) => ({
    name: p.name,
    brand: p.brand ?? "",
    category: categoryName.get(p.categoryId) ?? "",
  }));
  return { rows };
}

/* ------------------------------------------------------------------ */
/* Pure layout (testable without a DB)                                 */
/* ------------------------------------------------------------------ */

const A4 = { w: 595.28, h: 841.89 } as const;
const MARGIN = 40;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.42, 0.42, 0.42);
const RULE = rgb(0.8, 0.8, 0.8);

/** Strip characters Helvetica/WinAnsi can't encode (emoji, Devanagari, ₹ …). */
function winAnsiSafe(s: string): string {
  // Keep printable Latin-1; replace everything else. Collapse runs of the
  // replacement so "🔥🔥Fire" doesn't become "??Fire".
  return s.replace(/[^\x20-\x7E\xA0-\xFF]+/g, "?").replace(/\?{2,}/g, "?");
}

/** "1,29,900 paise" → "Rs. 1,299" (Indian digit grouping; paise shown only when non-zero). */
export function formatRs(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const rem = paise % 100;
  const grouped = rupees.toLocaleString("en-IN");
  return rem === 0 ? `Rs. ${grouped}` : `Rs. ${grouped}.${String(rem).padStart(2, "0")}`;
}

function truncate(font: PDFFont, text: string, size: number, maxWidth: number): string {
  let t = winAnsiSafe(text);
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

export interface CatalogPdfOptions {
  priced: boolean;
  /** Injectable clock for tests. */
  now?: Date;
}

/**
 * Render the catalogue PDF from already-projected rows. PURE (no DB): the
 * priced flag only chooses the LAYOUT; whether money exists at all was decided
 * by the projection above.
 */
export async function renderCatalogPdf(
  rows: CatalogPdfRowPublic[] | CatalogPdfRowPriced[],
  opts: CatalogPdfOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const now = opts.now ?? new Date();
  const dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });

  const usableW = A4.w - MARGIN * 2;
  // Columns: S.No | Product | Brand | (MRP | Price) or (Category)
  const cols = opts.priced
    ? [
        { key: "sno", label: "S.No", w: 36, align: "left" as const },
        { key: "name", label: "Product", w: usableW - 36 - 90 - 78 - 78, align: "left" as const },
        { key: "brand", label: "Brand", w: 90, align: "left" as const },
        { key: "mrp", label: "MRP", w: 78, align: "right" as const },
        { key: "price", label: "Price", w: 78, align: "right" as const },
      ]
    : [
        { key: "sno", label: "S.No", w: 36, align: "left" as const },
        { key: "name", label: "Product", w: usableW - 36 - 100 - 120, align: "left" as const },
        { key: "brand", label: "Brand", w: 100, align: "left" as const },
        { key: "category", label: "Category", w: 120, align: "left" as const },
      ];

  const pages: PDFPage[] = [];
  let page = doc.addPage([A4.w, A4.h]);
  pages.push(page);
  let y = A4.h - MARGIN;

  const drawText = (
    text: string,
    x: number,
    size: number,
    font: PDFFont,
    color = INK,
    align: "left" | "right" | "center" = "left",
    width = 0,
  ) => {
    const t = winAnsiSafe(text);
    let tx = x;
    if (align === "right") tx = x + width - font.widthOfTextAtSize(t, size);
    if (align === "center") tx = x + (width - font.widthOfTextAtSize(t, size)) / 2;
    page.drawText(t, { x: tx, y, size, font, color });
  };

  const rule = (yy: number, from = MARGIN, to = A4.w - MARGIN) =>
    page.drawLine({ start: { x: from, y: yy }, end: { x: to, y: yy }, thickness: 0.7, color: RULE });

  const header = (first: boolean) => {
    y = A4.h - MARGIN;
    if (first) {
      // Estimate-bill style masthead: store name, phone, address.
      drawText(APP_NAME.toUpperCase(), MARGIN, 20, bold, INK, "center", usableW);
      y -= 16;
      drawText(`PH: ${BUSINESS_PHONE.display}`, MARGIN, 11, bold, INK, "center", usableW);
      y -= 14;
      drawText(CONTACT.addressLines.slice(1).join(", "), MARGIN, 8.5, helv, MUTED, "center", usableW);
      y -= 16;
      rule(y);
      y -= 16;
      drawText(opts.priced ? "PRICE LIST" : "PRODUCT CATALOGUE", MARGIN, 12, bold);
      drawText(`Date: ${dateStr}`, MARGIN, 10, helv, MUTED, "right", usableW);
      y -= 18;
    } else {
      drawText(APP_NAME.toUpperCase(), MARGIN, 10, bold, MUTED);
      drawText(`Date: ${dateStr}`, MARGIN, 10, helv, MUTED, "right", usableW);
      y -= 14;
    }
    // Table header row.
    let x = MARGIN;
    for (const c of cols) {
      drawText(c.label, x, 9.5, bold, INK, c.align, c.w - 8);
      x += c.w;
    }
    y -= 6;
    rule(y);
    y -= 13;
  };

  header(true);

  let sno = 0;
  for (const row of rows) {
    sno += 1;
    if (y < MARGIN + 40) {
      page = doc.addPage([A4.w, A4.h]);
      pages.push(page);
      header(false);
    }
    let x = MARGIN;
    for (const c of cols) {
      let val = "";
      if (c.key === "sno") val = String(sno);
      else if (c.key === "name") val = row.name;
      else if (c.key === "brand") val = row.brand;
      else if (c.key === "category") val = (row as CatalogPdfRowPublic).category;
      else if (c.key === "mrp") {
        const m = (row as CatalogPdfRowPriced).mrpPaise;
        val = m == null ? "—" : formatRs(m);
      } else if (c.key === "price") val = formatRs((row as CatalogPdfRowPriced).pricePaise);
      drawText(truncate(c.align === "right" ? helv : helv, val, 9, c.w - 8), x, 9, helv, INK, c.align, c.w - 8);
      x += c.w;
    }
    y -= 14;
  }

  // Footer band on the last page.
  if (y < MARGIN + 34) {
    page = doc.addPage([A4.w, A4.h]);
    pages.push(page);
    y = A4.h - MARGIN;
  }
  y = MARGIN + 18;
  rule(y + 10);
  drawText(
    opts.priced
      ? `${sno} products - prices subject to change without notice.`
      : `${sno} products - wholesale prices shown after approval. Request access at ${CONTACT.website.replace("https://", "")}.`,
    MARGIN,
    8.5,
    helv,
    MUTED,
  );

  // Page numbers.
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, {
      x: A4.w - MARGIN - helv.widthOfTextAtSize(label, 8),
      y: MARGIN - 14,
      size: 8,
      font: helv,
      color: MUTED,
    });
  });

  return doc.save();
}

/** Query + render in one call (the route's entrypoint). */
export async function buildCatalogPdf(priced: boolean): Promise<Uint8Array> {
  const { rows } = await loadCatalogPdfRows(priced);
  return renderCatalogPdf(rows, { priced });
}
