import { describe, expect, it } from "vitest";

import imageLoader, { IMAGE_WIDTHS, catalogImageUrl, shouldResize, snapImageWidth } from "./image-loader";

/**
 * The home page shipped 21 MB of images to phones because uploads reached
 * them untouched. This loader is the contract that stops that: every
 * catalogue picture is requested at a bounded width through /api/img.
 */
describe("catalogue image loader", () => {
  it("snaps any width UP to the next produced size, never down", () => {
    expect(snapImageWidth(1)).toBe(16);
    expect(snapImageWidth(100)).toBe(128);
    expect(snapImageWidth(384)).toBe(384);
    expect(snapImageWidth(385)).toBe(640);
    expect(snapImageWidth(99_999)).toBe(IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]);
  });

  it("routes storage URLs through the resizer with width + quality", () => {
    const url = catalogImageUrl("https://pub-abc.r2.dev/products/x/1.png", 400, 70);
    const parsed = new URL(url, "https://example.test");
    expect(parsed.pathname).toBe("/api/img");
    expect(parsed.searchParams.get("u")).toBe("https://pub-abc.r2.dev/products/x/1.png");
    expect(parsed.searchParams.get("w")).toBe("640");
    expect(parsed.searchParams.get("q")).toBe("70");
  });

  it("leaves same-origin files and SVGs alone", () => {
    expect(shouldResize("/seed/chargers-1.svg")).toBe(false);
    expect(shouldResize("/uploads/dev.png")).toBe(false);
    expect(shouldResize("https://pub-abc.r2.dev/brands/logo.svg")).toBe(false);
    expect(catalogImageUrl("/seed/x.svg", 640)).toBe("/seed/x.svg");
  });

  it("is what next/image calls", () => {
    expect(imageLoader({ src: "https://pub-abc.r2.dev/a.jpg", width: 750, quality: undefined })).toContain("w=750");
    expect(imageLoader({ src: "https://pub-abc.r2.dev/a.jpg", width: 750, quality: undefined })).toContain("q=75");
  });
});
