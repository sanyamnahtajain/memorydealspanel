/**
 * Read an image's pixel size from the first bytes of the file, without
 * decoding it.
 *
 * WHY: owners upload banners in whatever shape their design tool gave them —
 * square, 3:2, 16:9, 3:1. The home carousel shows each one WHOLE at its own
 * shape (see BannerCarousel), so the server has to know the shape before the
 * page is sent; guessing on the client would make the strip jump as images
 * arrive. A banner URL never changes content (keys are content-addressed), so
 * a size read once is good forever and is memoised for the process.
 *
 * Covers what the admin uploader accepts: JPEG (including the EXIF rotation a
 * phone photo carries), PNG, WebP and GIF. Anything else is "unknown", and the
 * carousel falls back to its fixed frame — never an error.
 */

export interface ImageSize {
  width: number;
  height: number;
}

function u16be(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1];
}
function u16le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}
function u24le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}
function u32be(b: Uint8Array, i: number): number {
  return ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
}
function ascii(b: Uint8Array, i: number, n: number): string {
  return String.fromCharCode(...b.subarray(i, i + n));
}

/** EXIF orientation 5–8 means the stored pixels are rotated a quarter turn. */
function exifSwapsAxes(b: Uint8Array, start: number, end: number): boolean {
  // APP1 payload: "Exif\0\0" then a TIFF header.
  if (end - start < 14 || ascii(b, start, 4) !== "Exif") return false;
  const tiff = start + 6;
  const little = ascii(b, tiff, 2) === "II";
  const r16 = (i: number) => (little ? u16le(b, i) : u16be(b, i));
  const r32 = (i: number) =>
    little ? (u16le(b, i) + u16le(b, i + 2) * 65536) : u32be(b, i);
  const ifd = tiff + r32(tiff + 4);
  if (ifd + 2 > end) return false;
  const count = r16(ifd);
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > end) return false;
    if (r16(entry) === 0x0112) {
      const orientation = r16(entry + 8);
      return orientation >= 5 && orientation <= 8;
    }
  }
  return false;
}

function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2;
  let swap = false;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    // Fill bytes and stand-alone markers carry no length.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    if (marker === 0xe1) swap = swap || exifSwapsAxes(b, i + 4, Math.min(b.length, i + 2 + length));
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > b.length) return null;
      const height = u16be(b, i + 5);
      const width = u16be(b, i + 7);
      return swap ? { width: height, height: width } : { width, height };
    }
    i += 2 + length;
  }
  return null;
}

/** Size from the file header, or null when the bytes don't say (yet). */
export function parseImageSize(b: Uint8Array): ImageSize | null {
  if (b.length < 26) return null;
  // PNG: signature, then IHDR is always the first chunk.
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") {
    return { width: u32be(b, 16), height: u32be(b, 20) };
  }
  // GIF87a / GIF89a: logical screen size.
  if (ascii(b, 0, 3) === "GIF") {
    return { width: u16le(b, 6), height: u16le(b, 8) };
  }
  // WebP: RIFF....WEBP then one of three chunk kinds.
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const kind = ascii(b, 12, 4);
    if (kind === "VP8 " && b.length >= 30) {
      return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    }
    if (kind === "VP8L" && b.length >= 25) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X" && b.length >= 30) {
      return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    }
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  return null;
}

/** Width ÷ height, rounded; null when unknown or not a plausible banner. */
export function aspectOf(size: ImageSize | null): number | null {
  if (!size || size.width <= 0 || size.height <= 0) return null;
  const ratio = size.width / size.height;
  // Outside this range it is a sliver or a tower, not a banner — let the
  // fixed frame handle it rather than drawing a 20px-wide slide.
  if (ratio < 0.5 || ratio > 6) return null;
  return Math.round(ratio * 1000) / 1000;
}

const PROBE_BYTES = [64 * 1024, 512 * 1024];
const PROBE_TIMEOUT_MS = 3_000;
const cache = new Map<string, Promise<number | null>>();

async function probe(url: string): Promise<number | null> {
  for (const bytes of PROBE_BYTES) {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${bytes - 1}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = new Uint8Array(await res.arrayBuffer());
    const size = parseImageSize(body);
    if (size) return aspectOf(size);
    // A server that ignored Range sent the whole file: nothing more to read.
    if (res.status === 200 || body.length < bytes) return null;
  }
  return null;
}

/**
 * The aspect ratio of a stored image, or null when it can't be read. Never
 * throws. Only absolute http(s) URLs are fetched; anything else is unknown.
 */
export function imageAspect(url: string | null | undefined): Promise<number | null> {
  if (!url || !/^https?:\/\//i.test(url)) return Promise.resolve(null);
  let pending = cache.get(url);
  if (!pending) {
    pending = probe(url).catch(() => null);
    cache.set(url, pending);
    // A failure is not remembered: the next render tries again.
    void pending.then((ratio) => {
      if (ratio === null) cache.delete(url);
    });
  }
  return pending;
}

export function _resetImageAspectCacheForTests(): void {
  cache.clear();
}
