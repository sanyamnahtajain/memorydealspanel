import { afterEach, describe, expect, it, vi } from "vitest";

const getSlabyBranding = vi.fn();
vi.mock("@/server/services/store-settings", () => ({
  getSlabyBranding: () => getSlabyBranding(),
}));

const { GET } = await import("./route");
const { parseSlabyBranding } = await import("@/lib/slaby/branding");

afterEach(() => {
  getSlabyBranding.mockReset();
  vi.restoreAllMocks();
});

/**
 * This route is cached, so Next PRERENDERS it during `next build`. An
 * unhandled database error here therefore fails the whole deploy — which is
 * exactly what happened on a Vercel project with a bad DATABASE_URL.
 */
describe("GET /api/slaby-branding", () => {
  it("serves the stored config, CDN-cached", async () => {
    const stored = parseSlabyBranding(undefined);
    getSlabyBranding.mockResolvedValue(stored);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ config: stored });
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
  });

  it("never throws when the database is unreachable — a build must not fail on it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getSlabyBranding.mockRejectedValue(new Error("empty database name not allowed"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ config: parseSlabyBranding(undefined) });
    // The fallback must not be cached, or a blip would stick for minutes.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
