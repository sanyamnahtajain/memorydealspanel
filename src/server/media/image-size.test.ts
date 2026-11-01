import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { _resetImageAspectCacheForTests, aspectOf, imageAspect, parseImageSize } from "./image-size";

function blank(width: number, height: number, alpha = false) {
  return sharp({
    create: { width, height, channels: alpha ? 4 : 3, background: { r: 200, g: 40, b: 90, alpha: 0.5 } },
  });
}

async function bytes(img: sharp.Sharp): Promise<Uint8Array> {
  return new Uint8Array(await img.toBuffer());
}

describe("parseImageSize", () => {
  it.each([
    ["jpeg", (s: sharp.Sharp) => s.jpeg()],
    ["png", (s: sharp.Sharp) => s.png()],
    ["lossy webp", (s: sharp.Sharp) => s.webp()],
    ["lossless webp", (s: sharp.Sharp) => s.webp({ lossless: true })],
    ["gif", (s: sharp.Sharp) => s.gif()],
  ])("reads %s", async (_name, encode) => {
    expect(parseImageSize(await bytes(encode(blank(1600, 901))))).toEqual({ width: 1600, height: 901 });
  });

  it("reads an extended (alpha) webp", async () => {
    expect(parseImageSize(await bytes(blank(447, 300, true).webp()))).toEqual({ width: 447, height: 300 });
  });

  it("swaps width and height for a JPEG stored rotated (EXIF 6)", async () => {
    const rotated = await bytes(blank(1200, 800).jpeg().withMetadata({ orientation: 6 }));
    expect(parseImageSize(rotated)).toEqual({ width: 800, height: 1200 });
  });

  it("reads the header alone — the rest of the file isn't needed", async () => {
    const whole = await bytes(blank(2400, 800).jpeg({ quality: 95 }));
    expect(parseImageSize(whole.subarray(0, 2048))).toEqual({ width: 2400, height: 800 });
  });

  it("says unknown for anything else", () => {
    expect(parseImageSize(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(parseImageSize(new Uint8Array(4))).toBeNull();
  });
});

describe("aspectOf", () => {
  it("rounds to three places", () => {
    expect(aspectOf({ width: 1600, height: 901 })).toBe(1.776);
  });
  it("rejects slivers and towers", () => {
    expect(aspectOf({ width: 100, height: 300 })).toBeNull();
    expect(aspectOf({ width: 3000, height: 400 })).toBeNull();
    expect(aspectOf(null)).toBeNull();
  });
});

describe("imageAspect", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetImageAspectCacheForTests();
  });

  it("reads a stored image once and remembers it", async () => {
    const file = await bytes(blank(1600, 800).png());
    const fetchMock = vi.fn(async () => new Response(file.slice(0, 64 * 1024), { status: 206 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await imageAspect("https://cdn.example.test/banners/a.png")).toBe(2);
    expect(await imageAspect("https://cdn.example.test/banners/a.png")).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is unknown — never an error — when storage fails, and tries again next time", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await imageAspect("https://cdn.example.test/banners/b.jpg")).toBeNull();
    await Promise.resolve();
    expect(await imageAspect("https://cdn.example.test/banners/b.jpg")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("doesn't fetch relative or empty URLs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await imageAspect("/uploads/x.png")).toBeNull();
    expect(await imageAspect(null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
