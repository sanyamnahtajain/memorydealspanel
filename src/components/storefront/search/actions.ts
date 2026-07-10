"use server";

import { listActive } from "@/server/dal/categories";
import type { CategoryChip } from "./types";

/** Cap on how many category quick-chips the overlay shows. */
const CHIP_LIMIT = 8;

/**
 * Fetch active category quick-chips for the search overlay.
 *
 * Categories carry no pricing, so this is viewer-agnostic and safe to call
 * from the client shell on first overlay open. Returns a small, ordered slice
 * (the DAL already sorts by sortOrder then name).
 */
export async function searchCategoryChips(): Promise<CategoryChip[]> {
  const categories = await listActive();
  return categories
    .slice(0, CHIP_LIMIT)
    .map((c) => ({ name: c.name, slug: c.slug }));
}
