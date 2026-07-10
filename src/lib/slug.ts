/**
 * URL-slug helpers. Slugs are lowercase ASCII with single hyphens,
 * used for Category.slug and Product.slug (both unique in Mongo).
 */

const MAX_SLUG_LENGTH = 80;

/**
 * Converts an arbitrary name into a URL-safe slug:
 * lowercase, ASCII only, diacritics stripped, "&" -> "and",
 * everything non-alphanumeric collapsed to single hyphens.
 *
 *   slugify("Samsung EVO+ 128GB")  -> "samsung-evo-128gb"
 *   slugify("Café & Décor")        -> "cafe-and-decor"
 *
 * Returns "" when nothing usable remains (callers should fall back,
 * as makeUniqueSlug does).
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .replace(/&/g, " and ")
    .replace(/['’]/g, "") // don't split on apostrophes: "Boat's" -> "boats"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
}

/**
 * Produces a slug guaranteed unique per the provided `exists` check
 * (typically a Prisma count/findUnique). Tries the base slug first,
 * then "-2", "-3", … and finally a random suffix if the numeric
 * space is exhausted.
 */
export async function makeUniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base) || "item";
  if (!(await exists(root))) {
    return root;
  }
  for (let n = 2; n <= 100; n += 1) {
    const candidate = `${root}-${n}`;
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
  // Pathological collision space: fall back to random suffixes.
  for (;;) {
    const candidate = `${root}-${Math.random().toString(36).slice(2, 8)}`;
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
}
