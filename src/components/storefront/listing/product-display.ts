import type { PublicProduct, PublicProductImage } from "@/server/dto/product";
import type { StatusChipVariant } from "@/components/common/StatusChip";
import type { StockStatus } from "@/lib/schemas/shared";

/**
 * Pure, price-free display helpers shared by all three listing renderers
 * (grid / compact / table). None of these read a money field — they only
 * touch the public projection.
 */

/** The image to lead with: the primary flag, else lowest sortOrder. */
export function primaryImage(product: PublicProduct): PublicProductImage | null {
  if (product.images.length === 0) return null;
  const primary =
    product.images.find((img) => img.isPrimary) ??
    [...product.images].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return primary ?? null;
}

/** Best available image URL (thumb preferred) for a product, or null. */
export function thumbUrl(product: PublicProduct): string | null {
  const image = primaryImage(product);
  if (!image) return null;
  return image.thumbUrl ?? image.url;
}

/**
 * A short "key spec" line derived from the specs object (first couple of
 * string/number values) or, failing that, the first tags. Used in compact
 * rows and the table's spec column.
 */
export function keySpec(product: PublicProduct, max = 2): string | null {
  const { specs } = product;
  if (specs && typeof specs === "object" && !Array.isArray(specs)) {
    const parts = Object.entries(specs as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .slice(0, max)
      .map(([, v]) => String(v));
    if (parts.length > 0) return parts.join(" · ");
  }
  return product.tags.length > 0 ? product.tags.slice(0, max).join(" · ") : null;
}

/** Maps a stock status to the StatusChip variant that renders it. */
export function stockChipVariant(status: StockStatus): StatusChipVariant {
  switch (status) {
    case "IN_STOCK":
      return "inStock";
    case "LOW":
      return "low";
    case "OUT_OF_STOCK":
      return "outOfStock";
    default:
      return "inactive";
  }
}
