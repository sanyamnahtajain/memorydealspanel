/**
 * Pure filename → token helpers for bulk image matching.
 *
 * These live OUTSIDE `bulk-images.ts` on purpose: that module is a
 * `"use server"` file, and Next only permits async Server Actions to be
 * exported from such a module. These sync utilities are imported by both the
 * server action and its unit tests.
 */

/** A 24-character hex Mongo ObjectId. */
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

/** True when the token is shaped like a Mongo product id. */
export function isObjectId(token: string): boolean {
  return OBJECT_ID_RE.test(token);
}

/**
 * Derive the leading token from a filename such as
 * `64b7f8a2e4b0c12345678901-1.jpg`, `SKU123_2.png` or `SKU123 (front).webp`.
 * We take everything up to the first separator (`-`, `_`, `.`, space or paren)
 * after stripping any directory prefix. Returns null when nothing usable
 * remains. The token is later classified as a product id (24-hex) or a SKU.
 */
export function tokenFromFilename(filename: string): string | null {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const token = base.split(/[-_.\s(]/)[0]?.trim();
  return token && token.length > 0 ? token : null;
}
