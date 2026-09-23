/**
 * The catalogue image pipeline — where every product, category, brand and
 * banner picture is sized for the screen it is about to be drawn on.
 *
 * INCIDENT NOTE: measured on a mid-range phone over slow 4G, the home page was
 * 22.5 MB — 21 MB of it images. One product photo, uploaded by a script that
 * skipped the browser compressor, was a 15 MB PNG, and it was the eager,
 * high-priority LCP image; each category tile was ~800 KB. The page's largest
 * paint landed at 12 seconds and `load` at 97. Customers called it "loading
 * and loading". `images.unoptimized` had been switched on earlier to escape
 * Vercel's image-optimisation quota, which meant whatever was uploaded was
 * exactly what every phone downloaded.
 *
 * THE FIX IS STRUCTURAL, not another re-cut: `next/image` now runs through
 * this loader, which points at our own resizing route (/api/img). The route
 * fetches the original from storage ONCE per (image, width), resizes it with
 * sharp, encodes WebP, and answers with an immutable cache header — so the
 * CDN serves it from then on and a 15 MB upload can never reach a phone
 * again, regardless of what any uploader does. Costs are ours, not a metered
 * quota: one function invocation per distinct (image, width), then cache.
 *
 * `catalogImageUrl` is the same thing for the handful of plain <img> sites
 * (hero banner, gallery, logos) that cannot use next/image.
 */

import type { ImageLoaderProps } from "next/image";

/**
 * The only widths the route will produce — Next's default device + image
 * sizes. A fixed set bounds the CDN cache key space; anything else snaps UP
 * to the next one so the image is never drawn upscaled.
 */
export const IMAGE_WIDTHS = [
  16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920,
] as const;

export const DEFAULT_IMAGE_QUALITY = 75;

export function snapImageWidth(width: number): number {
  const w = Math.max(1, Math.floor(width));
  for (const allowed of IMAGE_WIDTHS) if (allowed >= w) return allowed;
  return IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1];
}

/**
 * Is this a source we should route through the resizer? Storage URLs, yes.
 * Root-relative paths (seed SVGs, dev uploads) and SVGs pass through untouched
 * — an SVG is already the smallest thing it will ever be, and a same-origin
 * static file needs no second trip through a function.
 */
export function shouldResize(src: string): boolean {
  if (!/^https?:\/\//i.test(src)) return false;
  if (/\.svg(\?|$)/i.test(src)) return false;
  return true;
}

/** Build the resizer URL for a source at a display width. */
export function catalogImageUrl(
  src: string,
  width: number,
  quality: number = DEFAULT_IMAGE_QUALITY,
): string {
  if (!shouldResize(src)) return src;
  const params = new URLSearchParams({
    u: src,
    w: String(snapImageWidth(width)),
    q: String(Math.min(100, Math.max(1, Math.round(quality)))),
  });
  return `/api/img?${params.toString()}`;
}

/** `next/image` loader (next.config images.loaderFile). */
export default function imageLoader({ src, width, quality }: ImageLoaderProps): string {
  return catalogImageUrl(src, width, quality ?? DEFAULT_IMAGE_QUALITY);
}
