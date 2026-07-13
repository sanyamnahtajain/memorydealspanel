import { describe, expect, it } from "vitest";
import { isObjectId, tokenFromFilename } from "./bulk-image-match";

describe("tokenFromFilename", () => {
  it("takes the leading token before the first separator", () => {
    expect(tokenFromFilename("SKU123-1.jpg")).toBe("SKU123");
    expect(tokenFromFilename("SKU123_2.png")).toBe("SKU123");
    expect(tokenFromFilename("SKU123 (front).webp")).toBe("SKU123");
    expect(tokenFromFilename("SKU123.jpeg")).toBe("SKU123");
  });

  it("strips a directory prefix (folder uploads)", () => {
    expect(tokenFromFilename("photos/64b7f8a2e4b0c12345678901-1.jpg")).toBe(
      "64b7f8a2e4b0c12345678901",
    );
    expect(tokenFromFilename("a\\b\\SAM-EVO.png")).toBe("SAM");
  });

  it("returns null when no usable token remains", () => {
    expect(tokenFromFilename(".hidden.jpg")).toBeNull();
    expect(tokenFromFilename("   ")).toBeNull();
    expect(tokenFromFilename("-1.jpg")).toBeNull();
  });
});

describe("isObjectId", () => {
  it("accepts a 24-char hex id in either case", () => {
    expect(isObjectId("64b7f8a2e4b0c12345678901")).toBe(true);
    expect(isObjectId("64B7F8A2E4B0C12345678901")).toBe(true);
  });

  it("rejects anything that is not a 24-hex string", () => {
    expect(isObjectId("SKU123")).toBe(false);
    expect(isObjectId("64b7f8a2e4b0c1234567890")).toBe(false); // 23 chars
    expect(isObjectId("64b7f8a2e4b0c123456789012")).toBe(false); // 25 chars
    expect(isObjectId("64b7f8a2e4b0c1234567890g")).toBe(false); // non-hex
  });
});
