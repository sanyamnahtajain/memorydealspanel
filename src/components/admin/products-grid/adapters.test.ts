import { describe, it, expect } from "vitest";

import { toUpdateInput } from "./adapters";
import type { ProductRow } from "./productColumns";

/**
 * Grid GST cell adapters: the grid edits HSN as a short string and GST as a
 * PERCENT, while the server stores HSN as-is and the rate as integer basis
 * points. `toUpdateInput` bridges the two (percent → bps) and treats an empty
 * cell as clearing the override back to "inherit" (null).
 */
describe("toUpdateInput — GST overrides", () => {
  it("converts an edited GST percent to integer basis points", () => {
    const out = toUpdateInput({ gstRatePercent: 18 } as Partial<ProductRow>);
    expect(out).toEqual({ gstRateBps: 1800 });
  });

  it("rounds a fractional percent to the nearest bps", () => {
    const out = toUpdateInput({ gstRatePercent: 2.5 } as Partial<ProductRow>);
    expect(out?.gstRateBps).toBe(250);
  });

  it("clears the GST rate override (inherit) when the cell is emptied", () => {
    const nulled = toUpdateInput({ gstRatePercent: null } as Partial<ProductRow>);
    expect(nulled).toEqual({ gstRateBps: null });
    const blanked = toUpdateInput({
      gstRatePercent: "" as unknown as number,
    } as Partial<ProductRow>);
    expect(blanked).toEqual({ gstRateBps: null });
  });

  it("passes an HSN string through and clears it when blank", () => {
    expect(toUpdateInput({ hsnCode: "8523" } as Partial<ProductRow>)).toEqual({
      hsnCode: "8523",
    });
    expect(toUpdateInput({ hsnCode: "  " } as Partial<ProductRow>)).toEqual({
      hsnCode: null,
    });
    expect(toUpdateInput({ hsnCode: null } as Partial<ProductRow>)).toEqual({
      hsnCode: null,
    });
  });

  it("does not emit GST keys when the patch touched no GST cell", () => {
    const out = toUpdateInput({ name: "Widget" } as Partial<ProductRow>);
    expect(out).toEqual({ name: "Widget" });
    expect(out && "gstRateBps" in out).toBe(false);
    expect(out && "hsnCode" in out).toBe(false);
  });
});
