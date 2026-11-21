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
 * The stored original is the source of every copy the resizer (/api/img)
 * serves, and of the gallery's zoom. There is no way to re-encode a product
 * photo later at higher quality — compress it too hard once and it is soft
 * forever. Owner rule: uploads are kept at the highest quality. These lock
 * the budgets in so they cannot be quietly tightened again.
 */
describe("image pipeline — quality budgets", () => {
  it("keeps a full-size image big enough for the gallery's zoom", async () => {
    await compressImage(photo());
    const options = optionsOfCall();
    expect(options.maxWidthOrHeight).toBe(3000);
    expect(options.maxSizeMB).toBe(4);
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
    expect(options.maxWidthOrHeight).toBe(1000);
    expect(options.maxSizeMB as number).toBeGreaterThanOrEqual(0.3);
    expect(options.initialQuality as number).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps banner artwork at full quality — phones get a resized copy", async () => {
    await compressBannerArtwork(photo("hero.jpg", "image/jpeg", 3_000_000));
    const options = optionsOfCall();
    expect(options.maxWidthOrHeight as number).toBeGreaterThanOrEqual(2400);
    expect(options.maxSizeMB as number).toBeGreaterThanOrEqual(2);
    expect(options.initialQuality as number).toBeGreaterThanOrEqual(0.9);
  });

  it("uploads a photo that is already within limits exactly as taken", async () => {
    const original = photo("good.jpg", "image/jpeg", 1_200_000);
    vi.stubGlobal("createImageBitmap", async () => ({ width: 2400, height: 1800, close() {} }));
    try {
      const out = await compressImage(original);
      expect(out).toBe(original);
      expect(compressMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("still scales down a photo bigger than the limits", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 6000, height: 4000, close() {} }));
    try {
      await compressImage(photo("huge.jpg", "image/jpeg", 3_000_000));
      expect(compressMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
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
