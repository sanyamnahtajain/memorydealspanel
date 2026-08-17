import { describe, it, expect } from "vitest";

import {
  parseOrderPdfSize,
  DEFAULT_ORDER_PDF_SIZE,
  ORDER_PDF_SIZES,
} from "./order-pdf-size";

describe("parseOrderPdfSize", () => {
  it("accepts the supported sizes verbatim", () => {
    for (const size of ORDER_PDF_SIZES) {
      expect(parseOrderPdfSize(size)).toBe(size);
    }
  });

  it("clamps unknown / missing / malformed values to the A4 default", () => {
    expect(parseOrderPdfSize(null)).toBe(DEFAULT_ORDER_PDF_SIZE);
    expect(parseOrderPdfSize(undefined)).toBe(DEFAULT_ORDER_PDF_SIZE);
    expect(parseOrderPdfSize("")).toBe(DEFAULT_ORDER_PDF_SIZE);
    expect(parseOrderPdfSize("a4")).toBe(DEFAULT_ORDER_PDF_SIZE); // case-sensitive by design
    expect(parseOrderPdfSize("Letter")).toBe(DEFAULT_ORDER_PDF_SIZE);
    expect(parseOrderPdfSize("<script>")).toBe(DEFAULT_ORDER_PDF_SIZE);
  });

  it("defaults to A4", () => {
    expect(DEFAULT_ORDER_PDF_SIZE).toBe("A4");
  });
});
