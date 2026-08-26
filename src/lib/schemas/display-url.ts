import { z } from "zod";

/**
 * URL rule for DISPLAY assets (product/category images, brand logos).
 *
 * `z.url()` alone rejects root-relative paths like `/seed/chargers-1.svg` —
 * which real rows carry — so every edit of such a product failed client-side
 * validation and the Save button silently did nothing. Display URLs are
 * legitimate in two shapes:
 *
 *   - absolute http(s)  → `https://cdn.example.com/x.jpg`
 *   - root-relative     → `/seed/x.svg`, `/uploads/x.jpg`
 *
 * Everything else stays rejected — including `javascript:` URIs and
 * protocol-relative `//evil.com` (the `^\/(?!\/)` guard), so this is not a
 * loosening of the injection surface.
 */
const ROOT_RELATIVE = /^\/(?!\/)/;

export function displayUrlSchema(message: string) {
  return z
    .string()
    .trim()
    .min(1, message)
    .max(2048, message)
    .refine((value) => {
      if (ROOT_RELATIVE.test(value)) return true;
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    }, message);
}
