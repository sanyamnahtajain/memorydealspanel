import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The persisted-variant path: with R2 configured, a variant that already
 * exists in R2 is answered by an immutable redirect and NO resize; a variant
 * that does not exist is resized once, written to R2, and served.
 */

const sharpCalls: number[] = [];
vi.mock("sharp", () => {
  const instance = {
    rotate() { return instance; },
    async metadata() { return { width: 4000, height: 3000 }; },
    resize(opts: { width: number }) { sharpCalls.push(opts.width); return instance; },
    webp() { return instance; },
    async toBuffer() { return Buffer.from("webp-bytes"); },
  };
  return { default: () => instance };
});

const putDerivedObject = vi.fn(async () => true);
vi.mock("@/server/storage/r2", () => ({
  isR2Configured: () => true,
  publicBaseOrEmpty: () => "https://images.thememorydeals.com",
  putDerivedObject,
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { GET } = await import("./route");

const req = (qs: string) => new NextRequest(`https://www.thememorydeals.com/api/img?${qs}`);
const original = "https://images.thememorydeals.com/products/1/a.png";

beforeEach(() => {
  fetchMock.mockReset();
  putDerivedObject.mockClear();
  sharpCalls.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/img — persisted variants", () => {
  it("redirects to the R2 variant when it already exists, without resizing", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD hit
    const res = await GET(req(`u=${encodeURIComponent(original)}&w=640&q=75`));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("https://images.thememorydeals.com");
    expect(location.pathname).toMatch(/^\/derived\/v1\/[0-9a-f]{2}\/[0-9a-f]{40}\/w640-q75\.webp$/);
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("x-image-via")).toBe("r2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "HEAD" });
    expect(sharpCalls).toEqual([]);
    expect(putDerivedObject).not.toHaveBeenCalled();
  });

  it("resizes, writes the variant to R2 and serves it when it does not exist yet", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 404 })) // HEAD miss
      .mockResolvedValueOnce(new Response(new Uint8Array(512), { status: 200, headers: { "content-length": "512" } }));
    const res = await GET(req(`u=${encodeURIComponent(original)}&w=1920&q=82`));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-image-persisted")).toBe("1");
    expect(sharpCalls).toEqual([1920]);
    expect(putDerivedObject).toHaveBeenCalledTimes(1);
    const [key, , contentType] = putDerivedObject.mock.calls[0]! as unknown as [string, Uint8Array, string];
    expect(key).toMatch(/^derived\/v1\/[0-9a-f]{2}\/[0-9a-f]{40}\/w1920-q82\.webp$/);
    expect(contentType).toBe("image/webp");
  });

  it("a failed existence check is treated as a miss, never as an error", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response(new Uint8Array(512), { status: 200, headers: { "content-length": "512" } }));
    const res = await GET(req(`u=${encodeURIComponent(original)}&w=1920`));
    expect(res.status).toBe(200);
  });
});
