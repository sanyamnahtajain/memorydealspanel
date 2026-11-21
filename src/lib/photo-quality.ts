/**
 * When is a product photo too small to look sharp? Shared by the uploader
 * (browser), the admin badges and the admin "small photo" filter (server).
 * Kept free of browser-only imports so server code can use it.
 */

/** Longest edge, in pixels, below which a photo looks soft on today's phones. */
export const SMALL_PHOTO_EDGE = 800;

/** Is this stored photo too small to look sharp? Unknown size = not flagged. */
export function isSmallPhoto(image: { width?: number | null; height?: number | null }): boolean {
  if (!image.width || !image.height) return false;
  return Math.max(image.width, image.height) < SMALL_PHOTO_EDGE;
}
