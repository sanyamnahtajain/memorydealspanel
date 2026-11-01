import { z } from "zod";

import { displayUrlSchema } from "@/lib/schemas/display-url";
import { objectIdSchema } from "@/lib/schemas/shared";

/**
 * Per-brand category layout — what the brand page's category rail shows and
 * in which order. Owner-configured in Admin → Brands → Brand page.
 *
 * Stored as JSON on the brand (see prisma `Brand.categoryLayout`), so it is
 * read together with the brand and saved in one write. Every read goes
 * through {@link parseBrandLayout}: anything missing or malformed resolves to
 * "no configuration", and the rail falls back to the catalogue's own order
 * and photos — a bad value can never take the brand page down.
 *
 * Pure and client-safe (no server imports): the admin editor, the save
 * action and the storefront read the same rules.
 */

export const MAX_BRAND_TAGLINE = 120;
export const MAX_BRAND_CATEGORY_LABEL = 40;
/** A brand rail longer than this is a catalogue, not a rail. */
export const MAX_BRAND_LAYOUT_ENTRIES = 100;

export const brandCategoryEntrySchema = z.object({
  categoryId: objectIdSchema,
  /** Brand-specific photo for this category (null = the category's own). */
  image: displayUrlSchema("Photo must be a valid URL.").nullish(),
  /** Display name on this brand's page (null = the category's own name). */
  label: z
    .string()
    .trim()
    .max(MAX_BRAND_CATEGORY_LABEL, `Keep the name under ${MAX_BRAND_CATEGORY_LABEL} characters.`)
    .nullish(),
  /** Leave this category off the brand's rail. */
  hidden: z.boolean().default(false),
});

export type BrandCategoryEntry = z.infer<typeof brandCategoryEntrySchema>;

export const brandLayoutSchema = z.array(brandCategoryEntrySchema).max(MAX_BRAND_LAYOUT_ENTRIES);

/** Everything the admin "Brand page" editor saves in one go. */
export const brandPageInputSchema = z.object({
  brandId: objectIdSchema,
  coverImage: displayUrlSchema("Cover must be a valid URL.").nullish(),
  tagline: z
    .string()
    .trim()
    .max(MAX_BRAND_TAGLINE, `Keep the line under ${MAX_BRAND_TAGLINE} characters.`)
    .nullish(),
  layout: brandLayoutSchema,
});

export type BrandPageInput = z.infer<typeof brandPageInputSchema>;

/**
 * The stored layout, cleaned: invalid entries dropped one by one (a single
 * bad row must not discard the owner's whole ordering), duplicates of a
 * category keep the FIRST occurrence, blank labels become null.
 */
export function parseBrandLayout(value: unknown): BrandCategoryEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: BrandCategoryEntry[] = [];
  for (const raw of value.slice(0, MAX_BRAND_LAYOUT_ENTRIES)) {
    const parsed = brandCategoryEntrySchema.safeParse(raw);
    if (!parsed.success) continue;
    const entry = parsed.data;
    if (seen.has(entry.categoryId)) continue;
    seen.add(entry.categoryId);
    out.push({
      categoryId: entry.categoryId,
      image: entry.image ?? null,
      label: entry.label ? entry.label : null,
      hidden: entry.hidden,
    });
  }
  return out;
}

/** The shape a rail item needs; the catalogue's own category row. */
export interface RailCategory {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  count: number;
}

/**
 * Apply a brand's layout to the categories it actually has products in.
 *
 *  - configured categories come first, in the owner's order, with the
 *    owner's photo and name where set;
 *  - hidden ones are left out;
 *  - categories the owner has not configured yet (a new range) follow in
 *    the catalogue's own order, so a fresh category is never invisible;
 *  - configured categories with no visible products right now are skipped
 *    (an empty shelf is not worth a tap).
 */
export function applyBrandLayout(
  categories: RailCategory[],
  layout: BrandCategoryEntry[],
): RailCategory[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const placed = new Set<string>();
  const out: RailCategory[] = [];
  for (const entry of layout) {
    const cat = byId.get(entry.categoryId);
    if (!cat) continue;
    placed.add(cat.id);
    if (entry.hidden) continue;
    out.push({ ...cat, name: entry.label || cat.name, image: entry.image || cat.image });
  }
  for (const cat of categories) {
    if (!placed.has(cat.id)) out.push(cat);
  }
  return out;
}
