import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  renderCatalogPdf,
  formatRs,
  type CatalogPdfRowPriced,
  type CatalogPdfRowPublic,
} from "./catalog-pdf";

/**
 * Catalogue-PDF pure layer (no DB). The render must produce a real PDF for
 * both gate variants, survive many rows (pagination) and hostile text (emoji,
 * ₹, Devanagari — WinAnsi-unsafe), and the PUBLIC variant's bytes must not
 * carry money strings (belt-and-braces on top of the price-free projection).
 */

const PRICED: CatalogPdfRowPriced[] = [
  { name: "POR 2730 MPORT MINO C", brand: "PORTRONICS", category: "CONNECTORS", pricePaise: 13800, mrpPaise: null },
  { name: "Fire 🔥 केबल Cable ₹", brand: "boAt", category: "CABLES", pricePaise: 129900, mrpPaise: 199900 },
];
const PUBLIC: CatalogPdfRowPublic[] = PRICED.map(({ name, brand, category }) => ({ name, brand, category }));

const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF

/**
 * Extract searchable text from a PDF: content streams are FlateDecode-
 * compressed AND pdf-lib writes drawn text as HEX strings (`<50524943…> Tj`),
 * so inflate every `stream…endstream` chunk, then hex-decode every `<…>`
 * string token (WinAnsi ≈ latin1 for our characters) and concatenate.
 */
function pdfText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const raw = buf.toString("latin1");
  let inflated = "";
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    let end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    // Trim the EOL that precedes `endstream` — zlib rejects trailing garbage.
    while (end > start && (raw[end - 1] === "\n" || raw[end - 1] === "\r")) end -= 1;
    try {
      inflated += "\n" + inflateSync(buf.subarray(start, end)).toString("latin1");
    } catch {
      /* not a flate stream — skip */
    }
  }
  // Decode hex-string tokens from both raw and inflated content.
  let decoded = "";
  for (const src of [raw, inflated]) {
    for (const hm of src.matchAll(/<([0-9A-Fa-f\s]{2,})>/g)) {
      const hex = hm[1].replace(/\s+/g, "");
      if (hex.length % 2 !== 0) continue;
      decoded += "\n" + Buffer.from(hex, "hex").toString("latin1");
    }
  }
  // Only the decoded drawn text — raw/inflated bytes are compressed noise that
  // could coincidentally contain (or hide) a searched-for substring.
  return decoded;
}

describe("formatRs", () => {
  it("formats paise as Rs. with Indian grouping; paise only when non-zero", () => {
    expect(formatRs(13800)).toBe("Rs. 138");
    expect(formatRs(129900)).toBe("Rs. 1,299");
    expect(formatRs(12345)).toBe("Rs. 123.45");
    expect(formatRs(10000000)).toBe("Rs. 1,00,000");
  });
});

describe("renderCatalogPdf", () => {
  const now = new Date("2026-08-01T10:00:00Z");

  it("renders a priced PRICE LIST containing amounts", async () => {
    const bytes = await renderCatalogPdf(PRICED, { priced: true, now });
    expect(isPdf(bytes)).toBe(true);
    const text = pdfText(bytes);
    expect(text).toContain("PRICE LIST");
    expect(text).toContain("Rs. 138");
    expect(text).toContain("Rs. 1,299");
  });

  it("renders a public CATALOGUE whose bytes carry NO money strings", async () => {
    const bytes = await renderCatalogPdf(PUBLIC, { priced: false, now });
    expect(isPdf(bytes)).toBe(true);
    const text = pdfText(bytes);
    expect(text).toContain("PRODUCT CATALOGUE");
    expect(text).not.toContain("Rs.");
    expect(text).not.toContain("PRICE LIST");
  });

  it("survives WinAnsi-hostile text (emoji / Devanagari / rupee sign)", async () => {
    const bytes = await renderCatalogPdf(PRICED, { priced: true, now });
    expect(isPdf(bytes)).toBe(true); // no encode throw
  });

  it("paginates hundreds of rows with page numbers", async () => {
    const many: CatalogPdfRowPriced[] = Array.from({ length: 300 }, (_, i) => ({
      name: `Product ${i + 1}`,
      brand: "BRAND",
      category: "CAT",
      pricePaise: 10000 + i,
      mrpPaise: null,
    }));
    const bytes = await renderCatalogPdf(many, { priced: true, now });
    expect(isPdf(bytes)).toBe(true);
    const text = pdfText(bytes);
    expect(text).toContain("Page 1 of");
  });
});
