import { beforeEach, describe, expect, it, vi } from "vitest";

type CompressOptions = Record<string, unknown>;

const compressMock = vi.fn(
  async (file: File, options: CompressOptions) => {
    void options;
    return new File(["x"], file.name, { type: file.type });
  },
);

/** Options the pipeline handed the compressor on its Nth call. */
function optionsOfCall(index = 0): CompressOptions {
  const call = compressMock.mock.calls[index];
  if (!call) throw new Error("the compressor was never called");
  return call[1];
}

vi.mock("browser-image-compression", () => ({
  default: (file: File, options: CompressOptions) =>
    compressMock(file, options),
}));

const {
  compressImage,
  compressBannerArtwork,
  makeThumbnail,
  assertValidImageFile,
  ImageError,
} = await import("./image");

function photo(name = "shot.jpg", type = "image/jpeg", bytes = 2_000_000) {
  return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(() => {
  compressMock.mockClear();
});

/**
 * The upload budgets decide what a buyer actually sees: `images.unoptimized`
 * is on, so whatever leaves this module is served verbatim, and the original
 * never leaves the browser. There is no way to re-encode a product photo
 * later at higher quality — compress it too hard once and it is soft forever.
 * These lock the budgets in so they cannot be quietly tightened again.
 */
describe("image pipeline — quality budgets", () => {
  it("keeps a full-size image big enough for the gallery's zoom", async () => {
    await compressImage(photo());
    const options = optionsOfCall();
    expect(options.maxWidthOrHeight).toBe(2000);
    expect(options.maxSizeMB).toBe(1.5);
  });

  it("starts the encoder high instead of the library's default 0.7", async () => {
    // Without initialQuality, browser-image-compression re-encodes at 0.7
    // even when the file would have fit comfortably at 0.9.
    await compressImage(photo());
    const options = optionsOfCall();
    expect(options.initialQuality as number).toBeGreaterThanOrEqual(0.9);
  });

  it("cuts thumbnails at 2x the largest card we render", async () => {
    // A grid card is ~45vw on a phone and ~22vw on a desktop — around 580 and
    // 630 DEVICE pixels once density is counted. A 400px thumb was upscaled
    // in every single card.
    await makeThumbnail(photo());
    const options = optionsOfCall();
    expect(options.maxWidthOrHeight).toBe(800);
    expect(options.maxSizeMB as number).toBeGreaterThanOrEqual(0.2);
    expect(options.initialQuality as number).toBeGreaterThanOrEqual(0.8);
  });

  it("keeps banner artwork wide but light — it is the home page's LCP", async () => {
    await compressBannerArtwork(photo("hero.jpg"));
    const options = optionsOfCall();
    // A 3:1 strip needs the width…
    expect(options.maxWidthOrHeight as number).toBeGreaterThanOrEqual(1600);
    // …but must NOT inherit the zoomable product photo's byte budget.
    expect(options.maxSizeMB as number).toBeLessThan(0.75);
  });

  it("never changes the file's format", async () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      compressMock.mockClear();
      await compressImage(photo("x", type));
      const options = optionsOfCall();
      expect(options.fileType).toBe(type);
    }
  });

  it("accepts an ordinary phone photo", () => {
    // The old 5 MB cap rejected these, pushing the owner into resizing shots
    // elsewhere first — usually losing more quality than the pipeline would.
    expect(() => assertValidImageFile(photo("dsc.jpg", "image/jpeg", 9_000_000))).not.toThrow();
  });

  it("still refuses something far too big to decode safely", () => {
    expect(() =>
      assertValidImageFile(photo("huge.jpg", "image/jpeg", 20_000_000)),
    ).toThrow(ImageError);
  });

  it("still refuses a file that is not an image", () => {
    expect(() =>
      assertValidImageFile(new File(["x"], "price.pdf", { type: "application/pdf" })),
    ).toThrow(ImageError);
  });
});
