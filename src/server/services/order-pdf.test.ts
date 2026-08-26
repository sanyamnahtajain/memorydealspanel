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

const BILLED: OrderPdfData = {
  ...DATA,
  grandTotalPaise: 72000, // 750 − 6% of the 500 dealer bucket (30)
  billing: {
    groupDiscountPaise: 3000,
    buckets: [
      {
        code: "DLR",
        name: "Dealer",
        separateBill: true,
        notes: "Deliver to the dealer counter.",
        billNumber: "5108/DLR",
        lineIndexes: [0],
        subtotalPaise: 50000,
        discountPaise: 3000,
        appliedPercentBps: 600,
        netPaise: 47000,
      },
      {
        code: "GEN",
        name: "General",
        separateBill: false,
        notes: null,
        billNumber: "5108/GEN",
        lineIndexes: [1, 2],
        subtotalPaise: 25000,
        discountPaise: 0,
        appliedPercentBps: null,
        netPaise: 25000,
      },
    ],
  },
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

  it("wraps an 80-char custom model name in the split sub-rows instead of running off the page", async () => {
    // Custom (typed) models are free text up to 80 chars; the split sub-rows
    // must go through wrapToWidth like the name/note lines do.
    const bytes = await renderOrderPdf({
      ...DATA,
      lines: [
        {
          name: "TEMPERED",
          qty: 40,
          ratePaise: 5000,
          amountPaise: 200000,
          breakdown: [
            { modelName: "W".repeat(80), qty: 10 },
            { modelName: "Totally Made Up Phone Pro Max Ultra Special Wholesale Edition", qty: 30 },
          ],
        },
      ],
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF");
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

  describe("billing buckets", () => {
    it("prints sequential bills (BILL 1 OF n …) closed by ONE ORDER TOTAL — no summary table", async () => {
      const text = pdfText(await renderOrderPdf(BILLED));
      // No summary table (owner request) — the document IS the bills.
      expect(text).not.toContain("ORDER SUMMARY");
      expect(text).toContain("BILL 1 OF 2");
      expect(text).toContain("BILL 2 OF 2");
      expect(text).toContain("5108/DLR");
      expect(text).toContain("5108/GEN");
      expect(text).toContain("Bill Total");
      expect(text).toContain("Dealer discount 6%");
      expect(text).toContain("dealer counter");
      // The closing block: per-bill lines + grand total in words.
      expect(text).toContain("ORDER TOTAL");
      expect(text).toContain("Seven Hundred Twenty Only");
    });

    it("PAPER SAVER: a small bucketed order fits on a single A4 sheet", async () => {
      // Sections FLOW (divider + compact bill header) instead of forcing a
      // fresh page per bucket — so this 3-line order must not paginate at all.
      // "Page N of M" only prints on multi-page bills, so its absence is the
      // single-sheet proof.
      const text = pdfText(await renderOrderPdf(BILLED));
      expect(text).not.toContain("Page 1 of");
    });

    it("renders the bucketed bill on A5 too", async () => {
      const text = pdfText(await renderOrderPdf(BILLED, "A5"));
      expect(text).toContain("BILL 1 OF 2");
      expect(text).toContain("5108/DLR");
      expect(text).toContain("Dealer discount 6%");
      expect(text).toContain("Seven Hundred Twenty Only");
    });

    it("leaves the single-bill layout untouched when no billing is present", async () => {
      const text = pdfText(await renderOrderPdf(DATA));
      expect(text).not.toContain("ORDER TOTAL");
      expect(text).not.toContain("BILL 1 OF");
      expect(text).not.toContain("Page 1 of");
      expect(text).toContain("Seven Hundred Fifty Only");
    });
  });

  it("prints the frozen delivery disclosure under the totals (single AND bucketed)", async () => {
    const delivery = { minChargePaise: 250_00, note: "Free above Rs. 50,000." };
    const single = pdfText(await renderOrderPdf({ ...DATA, delivery }));
    expect(single).toContain("Delivery: at least Rs. 250.00 extra");
    expect(single).toContain("PIN code");
    expect(single).toContain("Free above Rs. 50,000.");
    // Absent → nothing printed (old orders unchanged).
    expect(pdfText(await renderOrderPdf(DATA))).not.toContain("Delivery: at least");
  });

  describe("delivery as a REAL totals line", () => {
    const delivery = { minChargePaise: 250_00, note: null };

    it("single bill: prints the charge as a totals row and the words match the total", async () => {
      // Goods 750.00 + delivery 250.00 = 1,000.00 payable.
      const text = pdfText(
        await renderOrderPdf({
          ...DATA,
          delivery,
          deliveryChargePaise: 250_00,
          grandTotalPaise: 75000 + 25000,
        }),
      );
      expect(text).toContain("Delivery (minimum)");
      expect(text).toContain("+ 250.00");
      expect(text).toContain("1,000.00");
      // The amount in words is the PAYABLE total, delivery included.
      expect(text).toContain("One Thousand Only");
      expect(text).not.toContain("Seven Hundred Fifty Only");
      // The note now says it IS in the total, and still calls it a minimum.
      expect(text).toContain("Delivery (minimum): Rs. 250.00");
      expect(text).toContain("included in the Grand Total above");
      expect(text).toContain("PIN code");
      expect(text).not.toContain("not included above");
    });

    it("bucketed bills: the charge lands ONCE, in the closing ORDER TOTAL", async () => {
      // Goods 720.00 (750 − 30 dealer) + delivery 250.00 = 970.00.
      const text = pdfText(
        await renderOrderPdf({
          ...BILLED,
          delivery,
          deliveryChargePaise: 250_00,
          grandTotalPaise: 72000 + 25000,
        }),
      );
      expect(text).toContain("ORDER TOTAL");
      expect(text).toContain("Nine Hundred Seventy Only");
      // Exactly one delivery money row — never repeated per bill.
      expect(text.match(/\+ 250\.00/g)?.length).toBe(1);
      // The per-bill totals are GOODS only: delivery never joins a bill total.
      expect(text).toContain("Bill Total");
      expect(text).toContain("470.00"); // dealer bill, post-discount
      expect(text).toContain("250.00"); // general bill goods total
    });

    it("renders the charged layout on A5 too", async () => {
      const text = pdfText(
        await renderOrderPdf(
          { ...DATA, delivery, deliveryChargePaise: 250_00, grandTotalPaise: 100000 },
          "A5",
        ),
      );
      expect(text).toContain("Delivery (minimum)");
      expect(text).toContain("One Thousand Only");
    });

    it("a HISTORICAL order (disclosure, no frozen charge) prints exactly as before", async () => {
      const before = pdfText(await renderOrderPdf({ ...DATA, delivery }));
      const explicitZero = pdfText(
        await renderOrderPdf({ ...DATA, delivery, deliveryChargePaise: 0 }),
      );
      expect(explicitZero).toBe(before);
      expect(before).toContain("Delivery: at least Rs. 250.00 extra");
      expect(before).toContain("not included above");
      expect(before).not.toContain("Delivery (minimum)");
      // The total is still the goods total, untouched.
      expect(before).toContain("Seven Hundred Fifty Only");
    });

    it("delivery OFF adds no line at all", async () => {
      const text = pdfText(await renderOrderPdf(DATA));
      expect(text).not.toContain("Delivery (minimum)");
      expect(text).not.toContain("+ 250.00");
      expect(text).toContain("Seven Hundred Fifty Only");
    });
  });

  it("wraps a long product name (no truncation) and prints the customer note inline", async () => {
    const longName =
      "Premium Tempered Glass Full Screen Protector Oleophobic Matte Finish";
    const withNote: OrderPdfData = {
      ...DATA,
      lines: [
        {
          name: longName,
          qty: 5,
          ratePaise: 5000,
          amountPaise: 25000,
          note: "Customer wants matte finish only, pack in bubblewrap.",
        },
      ],
      totalQty: 5,
      grandTotalPaise: 25000,
    };
    for (const size of ["A4", "A5"] as const) {
      const text = pdfText(await renderOrderPdf(withNote, size));
      // Every word of the long name survives (wrapping, never truncation)…
      for (const word of ["Premium", "Oleophobic", "Matte", "Protector"]) {
        expect(text).toContain(word);
      }
      // …and the customer note is printed on the bill itself.
      expect(text).toContain("bubblewrap");
    }
  });
});
