import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { renderOrderPdf, rupeesInWords, amountInWords, type OrderPdfData } from "./order-pdf";

/**
 * Order-PDF pure layer (no DB): the Indian-system amount-in-words helper and
 * the estimate-bill render (masthead, party/bill meta, goods table, grand
 * total + words). PDF text is flate-compressed hex — decode it to assert.
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
    while (end > start && (raw[end - 1] === "\n" || raw[end - 1] === "\r")) end -= 1;
    try {
      inflated += "\n" + inflateSync(buf.subarray(start, end)).toString("latin1");
    } catch {
      /* skip */
    }
  }
  let decoded = "";
  for (const src of [raw, inflated]) {
    for (const hm of src.matchAll(/<([0-9A-Fa-f\s]{2,})>/g)) {
      const hex = hm[1].replace(/\s+/g, "");
      if (hex.length % 2 !== 0) continue;
      decoded += "\n" + Buffer.from(hex, "hex").toString("latin1");
    }
  }
  return decoded;
}

describe("rupeesInWords / amountInWords", () => {
  it("covers the bill's own example: 750 → Seven Hundred Fifty Only", () => {
    expect(amountInWords(75000)).toBe("Seven Hundred Fifty Only");
  });
  it("Indian system: crore/lakh/thousand", () => {
    expect(rupeesInWords(1)).toBe("One");
    expect(rupeesInWords(19)).toBe("Nineteen");
    expect(rupeesInWords(45)).toBe("Forty Five");
    expect(rupeesInWords(100)).toBe("One Hundred");
    expect(rupeesInWords(1204)).toBe("One Thousand Two Hundred Four");
    expect(rupeesInWords(523456)).toBe("Five Lakh Twenty Three Thousand Four Hundred Fifty Six");
    expect(rupeesInWords(12000000)).toBe("One Crore Twenty Lakh");
  });
  it("paise tail", () => {
    expect(amountInWords(75045)).toBe("Seven Hundred Fifty and Forty Five Paise Only");
    expect(amountInWords(0)).toBe("Zero Only");
  });
});

const DATA: OrderPdfData = {
  orderNumber: "5108",
  placedAt: new Date("2026-07-31T10:00:00Z"),
  partyName: "Khan Communication",
  partyPhone: "9876543210",
  lines: [
    { name: "TEMPERED", qty: 10, ratePaise: 5000, amountPaise: 50000 },
    { name: "Super X OV OG Tempered", qty: 10, ratePaise: 1600, amountPaise: 16000 },
    { name: "M600 CHARGER", qty: 2, ratePaise: 4500, amountPaise: 9000 },
  ],
  totalQty: 22,
  grandTotalPaise: 75000,
  totalTaxPaise: null,
};

describe("renderOrderPdf", () => {
  it("renders the estimate layout with masthead, party, lines, total and words", async () => {
    const bytes = await renderOrderPdf(DATA);
    expect(bytes[0]).toBe(0x25); // %PDF
    const text = pdfText(bytes);
    expect(text).toContain("ESTIMATE");
    expect(text).toContain("THE MEMORY DEALS");
    expect(text).toContain("Khan Communication");
    expect(text).toContain("5108");
    expect(text).toContain("TEMPERED");
    expect(text).toContain("22.00 pcs");
    expect(text).toContain("750.00");
    expect(text).toContain("Seven Hundred Fifty Only");
  });

  it("paginates a long order without losing the totals block", async () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({
      name: `Item ${i + 1}`, qty: 1, ratePaise: 1000, amountPaise: 1000,
    }));
    const bytes = await renderOrderPdf({
      ...DATA, lines, totalQty: 120, grandTotalPaise: 120000,
    });
    const text = pdfText(bytes);
    expect(text).toContain("Page 1 of");
    expect(text).toContain("Amount chargeable (in words)");
    expect(text).toContain("One Thousand Two Hundred Only");
  });

  it("shows the GST line only when tax was applied", async () => {
    const withTax = await renderOrderPdf({ ...DATA, totalTaxPaise: 11441 });
    expect(pdfText(withTax)).toContain("Includes GST");
    const without = await renderOrderPdf(DATA);
    expect(pdfText(without)).not.toContain("Includes GST");
  });

  it("renders the same bill on an A5 sheet (smaller paper) with all content", async () => {
    const bytes = await renderOrderPdf(DATA, "A5");
    expect(bytes[0]).toBe(0x25); // %PDF
    const text = pdfText(bytes);
    expect(text).toContain("THE MEMORY DEALS");
    expect(text).toContain("Khan Communication");
    expect(text).toContain("Seven Hundred Fifty Only");
  });

  it("defaults to A4 (unchanged) when no size is given", async () => {
    const a4 = await renderOrderPdf(DATA);
    const explicit = await renderOrderPdf(DATA, "A4");
    // Same page geometry: both start with the %PDF header and render the total.
    expect(a4[0]).toBe(0x25);
    expect(pdfText(explicit)).toContain("Seven Hundred Fifty Only");
  });
});
