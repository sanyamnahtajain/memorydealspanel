import { afterAll, describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";

import { prisma } from "@/server/db";
import { buildOrderPdf } from "./order-pdf";

/** Same extractor the layout tests use. */
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
  // pdf-lib writes the glyphs as HEX strings for subset fonts — decoding
  // that is the half a naive extractor misses (and then reports a false
  // "the text is missing").
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

const created: string[] = [];

afterAll(async () => {
  if (created.length > 0) {
    await prisma.order.deleteMany({ where: { id: { in: created } } });
  }
});

describe("buildOrderPdf — the whole real path, DB to bytes", () => {
  it("carries the customer's order note, GSTIN, city, status and courier", async () => {
    const customer = await prisma.customer.findFirst({
      where: { status: "APPROVED" },
      select: { id: true },
    });
    await prisma.customer.update({
      where: { id: customer!.id },
      data: { gstNumber: "27AABCU9603R1ZX", city: "Mumbai" },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: `QA-PDF-${Date.now()}`,
        customerId: customer!.id,
        status: "CONFIRMED",
        itemCount: 10,
        subtotalPaise: 92_000,
        items: [
          {
            productId: "x",
            name: "ERD Charger",
            quantity: 10,
            unitPricePaise: 9_200,
            lineTotalPaise: 92_000,
          },
        ],
        note: "Please pack the tempered separately and call before dispatch.",
        adminNote: "INTERNAL ONLY do not print",
        tracking: {
          courierName: "Delhivery",
          trackingId: "88112233",
          url: "https://track.example/88112233",
        },
        placedAt: new Date(),
      },
    });
    created.push(order.id);

    const result = await buildOrderPdf(order.id);
    expect(result).not.toBeNull();
    const text = pdfText(result!.bytes);

    expect(text).toContain("CUSTOMER NOTE");
    expect(text).toContain("pack the tempered separately");
    expect(text).toContain("27AABCU9603R1ZX");
    expect(text).toContain("Mumbai");
    expect(text).toContain("Confirmed");
    expect(text).toContain("Delhivery");
    // adminNote is internal and this document gets forwarded to buyers.
    expect(text).not.toContain("INTERNAL ONLY");
  });
});
