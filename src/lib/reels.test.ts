import { describe, expect, it } from "vitest";

import {
  MAX_REEL_CAPTION,
  instagramUrlSchema,
  reelInputSchema,
} from "./reels";

const OID = "64b0c8f1e4b0a1b2c3d4e5f6";

const base = {
  videoUrl: "https://cdn.example.com/reels/clip.mp4",
  caption: "New boAt neckbands just landed.",
};

describe("instagramUrlSchema — only Instagram links power the CTA", () => {
  it("accepts post and reel links on instagram.com, with or without www", () => {
    expect(
      instagramUrlSchema.safeParse("https://www.instagram.com/reel/Cx1a2b3c/").success,
    ).toBe(true);
    expect(
      instagramUrlSchema.safeParse("https://instagram.com/p/Cx1a2b3c/").success,
    ).toBe(true);
    expect(
      instagramUrlSchema.safeParse("  https://www.instagram.com/the_memory_deals/  ").success,
    ).toBe(true);
  });

  it("rejects plain http", () => {
    expect(
      instagramUrlSchema.safeParse("http://www.instagram.com/reel/Cx1a2b3c/").success,
    ).toBe(false);
  });

  it("rejects look-alike hosts", () => {
    expect(instagramUrlSchema.safeParse("https://instagram.com.evil.io/x").success).toBe(false);
    expect(instagramUrlSchema.safeParse("https://notinstagram.com/x").success).toBe(false);
    expect(instagramUrlSchema.safeParse("https://www.youtube.com/shorts/abc").success).toBe(false);
  });

  it("rejects things that are not URLs at all", () => {
    expect(instagramUrlSchema.safeParse("instagram.com/reel/abc").success).toBe(false);
    expect(instagramUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(instagramUrlSchema.safeParse("").success).toBe(false);
  });
});

describe("reelInputSchema", () => {
  it("accepts the minimal reel and fills the defaults", () => {
    const parsed = reelInputSchema.parse(base);
    expect(parsed.sortOrder).toBe(0);
    expect(parsed.active).toBe(true);
    expect(parsed.posterUrl).toBeUndefined();
    expect(parsed.productId).toBeUndefined();
  });

  it("accepts a root-relative video path (seeded rows carry these)", () => {
    expect(
      reelInputSchema.safeParse({ ...base, videoUrl: "/seed/reels/one.mp4" }).success,
    ).toBe(true);
  });

  it("rejects a javascript: or protocol-relative video URL", () => {
    expect(
      reelInputSchema.safeParse({ ...base, videoUrl: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(
      reelInputSchema.safeParse({ ...base, videoUrl: "//evil.example/x.mp4" }).success,
    ).toBe(false);
  });

  it("requires a caption and caps its length", () => {
    expect(reelInputSchema.safeParse({ ...base, caption: "   " }).success).toBe(false);
    expect(
      reelInputSchema.safeParse({ ...base, caption: "x".repeat(MAX_REEL_CAPTION) }).success,
    ).toBe(true);
    const over = reelInputSchema.safeParse({
      ...base,
      caption: "x".repeat(MAX_REEL_CAPTION + 1),
    });
    expect(over.success).toBe(false);
    if (!over.success) {
      expect(over.error.issues[0]?.message).toContain(String(MAX_REEL_CAPTION));
    }
  });

  it("trims the caption before measuring it", () => {
    const parsed = reelInputSchema.parse({ ...base, caption: "  hello  " });
    expect(parsed.caption).toBe("hello");
  });

  it("takes a 24-hex ObjectId for productId and nothing else", () => {
    expect(reelInputSchema.safeParse({ ...base, productId: OID }).success).toBe(true);
    expect(reelInputSchema.safeParse({ ...base, productId: null }).success).toBe(true);
    expect(reelInputSchema.safeParse({ ...base, productId: "neckband-x1" }).success).toBe(false);
    expect(reelInputSchema.safeParse({ ...base, productId: OID.slice(0, 23) }).success).toBe(false);
    expect(reelInputSchema.safeParse({ ...base, productId: 123 }).success).toBe(false);
  });

  it("accepts a null Instagram link and rejects a non-Instagram one", () => {
    expect(reelInputSchema.safeParse({ ...base, instagramUrl: null }).success).toBe(true);
    expect(
      reelInputSchema.safeParse({ ...base, instagramUrl: "https://tiktok.com/@x/video/1" }).success,
    ).toBe(false);
  });

  it("keeps durationSec a positive whole number of seconds, up to ten minutes", () => {
    expect(reelInputSchema.safeParse({ ...base, durationSec: 42 }).success).toBe(true);
    expect(reelInputSchema.safeParse({ ...base, durationSec: 0 }).success).toBe(false);
    expect(reelInputSchema.safeParse({ ...base, durationSec: 4.5 }).success).toBe(false);
    expect(reelInputSchema.safeParse({ ...base, durationSec: 601 }).success).toBe(false);
    expect(reelInputSchema.safeParse({ ...base, durationSec: null }).success).toBe(true);
  });

  it("bounds sortOrder", () => {
    expect(reelInputSchema.safeParse({ ...base, sortOrder: -1 }).success).toBe(false);
    expect(reelInputSchema.safeParse({ ...base, sortOrder: 9999 }).success).toBe(true);
    expect(reelInputSchema.safeParse({ ...base, sortOrder: 10000 }).success).toBe(false);
  });

  it("never carries a price field, even if one is sent", () => {
    // The storefront reel is price-free by contract; a stray `price` must be
    // dropped on the floor, not stored.
    const parsed = reelInputSchema.parse({ ...base, price: 49900 });
    expect("price" in parsed).toBe(false);
  });
});
