import { describe, expect, it } from "vitest";

import { GST_STATE_CODES, gstinStateCode, isValidGstin } from "./gstin";

// Real-format GSTINs with correct checksums (published GSTN samples / computed).
const VALID = ["27AAPFU0939F1ZV", "06BZAHM6385P6Z0", "29AAGCB7383J1Z4", "24AABCU9603R1ZT"];

describe("isValidGstin", () => {
  it("accepts well-formed GSTINs with a correct checksum", () => {
    for (const g of VALID) {
      expect(isValidGstin(g)).toBe(true);
    }
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    expect(isValidGstin("  27aapfu0939f1zv  ")).toBe(true);
  });

  it("rejects a wrong-length string", () => {
    expect(isValidGstin("")).toBe(false);
    expect(isValidGstin("27AAPFU0939F1Z")).toBe(false); // 14
    expect(isValidGstin("27AAPFU0939F1ZVX")).toBe(false); // 16
  });

  it("rejects a bad checksum character", () => {
    // Flip the last char away from the correct 'V'.
    expect(isValidGstin("27AAPFU0939F1ZW")).toBe(false);
    expect(isValidGstin("27AAPFU0939F1ZA")).toBe(false);
  });

  it("rejects a structurally malformed GSTIN", () => {
    expect(isValidGstin("2AAPFU0939F1ZVX")).toBe(false); // 1-digit state region
    expect(isValidGstin("27AAP0U0939F1ZV")).toBe(false); // digit where a PAN letter must be
    expect(isValidGstin("27AAPFU0939F1YV")).toBe(false); // 'Y' where 'Z' is required
    expect(isValidGstin("27AAPFUABCDF1ZV")).toBe(false); // letters where PAN digits must be
  });

  it("rejects an unknown state code even if the rest is well-formed", () => {
    // '00' is not a valid state; structure otherwise fine.
    expect(isValidGstin("00AAPFU0939F1ZV")).toBe(false);
  });

  it("rejects non-string input", () => {
    // @ts-expect-error deliberately wrong type
    expect(isValidGstin(null)).toBe(false);
    // @ts-expect-error deliberately wrong type
    expect(isValidGstin(27)).toBe(false);
  });
});

describe("gstinStateCode", () => {
  it("returns the first two chars for a structurally valid GSTIN", () => {
    expect(gstinStateCode("27AAPFU0939F1ZV")).toBe("27");
    expect(gstinStateCode("06BZAHM6385P6Z0")).toBe("06");
  });

  it("extracts the state even when the checksum is wrong (structure is enough)", () => {
    expect(gstinStateCode("27AAPFU0939F1ZW")).toBe("27");
  });

  it("returns null for malformed / wrong-length / unknown-state input", () => {
    expect(gstinStateCode("27AAPFU0939F1Z")).toBeNull(); // 14
    expect(gstinStateCode("00AAPFU0939F1ZV")).toBeNull(); // unknown state
    expect(gstinStateCode("2AAPFU0939F1ZVX")).toBeNull(); // malformed
    // @ts-expect-error deliberately wrong type
    expect(gstinStateCode(undefined)).toBeNull();
  });
});

describe("GST_STATE_CODES", () => {
  it("maps common codes to their state names", () => {
    expect(GST_STATE_CODES["27"]).toBe("Maharashtra");
    expect(GST_STATE_CODES["29"]).toBe("Karnataka");
    expect(GST_STATE_CODES["07"]).toBe("Delhi");
  });

  it("covers the standard 37 numbered states/UTs plus special codes", () => {
    for (let n = 1; n <= 38; n += 1) {
      const code = String(n).padStart(2, "0");
      expect(GST_STATE_CODES[code]).toBeTruthy();
    }
    expect(GST_STATE_CODES["97"]).toBeTruthy();
  });
});
