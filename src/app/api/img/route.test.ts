import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sharpCalls: { width?: number; quality?: number }[] = [];
vi.mock("sharp", () => {
  const instance = {
    rotate() { return instance; },
    async metadata() { return { width: 4000, height: 3000 }; },
    resize(opts: { width: number }) { sharpCalls.push({ width: opts.width }); return instance; },
    webp(opts: { quality: number }) { sharpCalls[sharpCalls.length - 1]!.quality = opts.quality; return instance; },
    async toBuffer() { return Buffer.from("webp-bytes"); },
  };
  return { default: () => instance };
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
process.env.R2_PUBLIC_URL = "https://images.thememorydeals.com";

const { GET } = await import("./route");

const req = (qs: string) => new NextRequest(`https://www.thememorydeals.com/api/img?${qs}`);
const okUpstream = () =>
  new Response(new Uint8Array(1024), { status: 200, headers: { "content-length": "1024" } });

beforeEach(() => {
  fetchMock.mockReset();
  sharpCalls.length = 0;
});
afterEach(() => vi.restoreAllMocks());

/**
 * /api/img is an OPEN parameter on a public route: the tests that matter are
 * that it only ever fetches our own storage, that it can never upscale, and
 * that it fails towards "the picture is big", never "there is no picture".
 */
describe("GET /api/img", () => {
  it("refuses hosts that are not our storage — this is not a proxy", async () => {
    for (const u of ["https://evil.example/x.png", "http://pub-abc.r2.dev/x.png", "not a url"]) {
      const res = await GET(req(`u=${encodeURIComponent(u)}&w=640`));
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resizes an r2.dev original to the snapped width as immutable WebP", async () => {
    fetchMock.mockResolvedValueOnce(okUpstream());
    const res = await GET(req(`u=${encodeURIComponent("https://pub-abc.r2.dev/p/1.png")}&w=400&q=60`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(sharpCalls[0]).toEqual({ width: 640, quality: 60 });
  });

  it("cuts small widths from the CDN-cached 1920px master, not the original", async () => {
    fetchMock.mockResolvedValueOnce(okUpstream());
    const res = await GET(req(`u=${encodeURIComponent("https://pub-abc.r2.dev/p/1.png")}&w=384`));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-image-via")).toBe("master");
    const fetched = new URL(String(fetchMock.mock.calls[0]![0]));
    // Same route, same origin, master width — so one 15 MB download ever.
    expect(fetched.origin).toBe("https://www.thememorydeals.com");
    expect(fetched.pathname).toBe("/api/img");
    expect(fetched.searchParams.get("w")).toBe("1920");
    expect(fetched.searchParams.get("u")).toBe("https://pub-abc.r2.dev/p/1.png");
  });

  it("the master itself reads the original", async () => {
    fetchMock.mockResolvedValueOnce(okUpstream());
    const res = await GET(req(`u=${encodeURIComponent("https://pub-abc.r2.dev/p/1.png")}&w=1920`));
    expect(res.headers.get("x-image-via")).toBe("original");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://pub-abc.r2.dev/p/1.png");
  });

  it("accepts the configured public image host too", async () => {
    fetchMock.mockResolvedValueOnce(okUpstream());
    const res = await GET(req(`u=${encodeURIComponent("https://images.thememorydeals.com/p/1.jpg")}&w=128`));
    expect(res.status).toBe(200);
  });

  it("falls back to the original when the upstream fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    const res = await GET(req(`u=${encodeURIComponent("https://pub-abc.r2.dev/p/missing.png")}&w=640`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://pub-abc.r2.dev/p/missing.png");
    // …and only briefly, so a recovered resizer takes over.
    expect(res.headers.get("cache-control")).not.toContain("immutable");
  });

  it("refuses to decode an absurdly large original — redirects instead of running out of memory", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array(8), { status: 200, headers: { "content-length": String(200 * 1024 * 1024) } }),
    );
    const res = await GET(req(`u=${encodeURIComponent("https://pub-abc.r2.dev/p/huge.png")}&w=640`));
    expect(res.status).toBe(302);
    expect(sharpCalls).toHaveLength(0);
  });
});
