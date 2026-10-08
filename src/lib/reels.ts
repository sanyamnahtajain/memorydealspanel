import { z } from "zod";

import { displayUrlSchema } from "@/lib/schemas/display-url";
import { objectIdSchema } from "@/lib/schemas/shared";

/**
 * Storefront reels — short vertical shop videos (the clips the owner posts
 * on Instagram @the_memory_deals), self-hosted so the storefront can give an
 * Instagram-like full-screen feed without the Meta Graph API.
 *
 * PRICE GATE: a reel never carries money. The optional product link only
 * names the product; the price is read on the product page like everywhere
 * else, so the public /reels feed and the ISR home rail stay cache-safe.
 *
 * Upload limits are the product-video limits (src/lib/video.ts) — one
 * pipeline, one set of numbers the owner already knows.
 */

export const INSTAGRAM_HANDLE = "the_memory_deals";
export const INSTAGRAM_PROFILE_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}/`;

/** Longest caption worth showing over a 9:16 frame. */
export const MAX_REEL_CAPTION = 160;

/** Feed page size and the home rail length. */
export const REELS_PAGE_SIZE = 12;
export const HOME_REELS_LIMIT = 8;

/** Hard cap on live reels — a feed nobody finishes is wasted bandwidth. */
export const MAX_REELS = 60;

/** Only Instagram post/reel links are accepted for the "View on Instagram" CTA. */
export const instagramUrlSchema = z
  .string()
  .trim()
  .url("Instagram link must be a full https:// address.")
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          /(^|\.)instagram\.com$/i.test(url.hostname)
        );
      } catch {
        return false;
      }
    },
    { message: "Must be a link on instagram.com." },
  );

export const reelInputSchema = z.object({
  videoUrl: displayUrlSchema("Video must be a valid URL."),
  posterUrl: displayUrlSchema("Poster image must be a valid URL.").nullish(),
  caption: z
    .string()
    .trim()
    .min(1, "Write a short caption.")
    .max(MAX_REEL_CAPTION, `Keep the caption under ${MAX_REEL_CAPTION} characters.`),
  instagramUrl: instagramUrlSchema.nullish(),
  productId: objectIdSchema.nullish(),
  durationSec: z.number().int().min(1).max(600).nullish(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  active: z.boolean().default(true),
});

export type ReelInput = z.infer<typeof reelInputSchema>;

/** The product a reel sells — the public, price-free projection. */
export interface ReelProductSummary {
  id: string;
  slug: string;
  name: string;
  /** Primary image (thumb when available). Null when the product has none. */
  imageUrl: string | null;
}

/** The shape the storefront renders. Never carries a price. */
export interface StorefrontReel {
  id: string;
  videoUrl: string;
  posterUrl: string | null;
  caption: string;
  instagramUrl: string | null;
  durationSec: number | null;
  product: ReelProductSummary | null;
}
