import { notFound, permanentRedirect } from "next/navigation";

import { getBrandBySlug } from "@/server/dal/brands";
import { getBySlug } from "@/server/dal/categories";

/**
 * Old brand → category drill-down URL. The brand page now carries the
 * category rail itself (Blinkit layout), selected with `?cat=`, so this route
 * just sends old links and bookmarks there permanently.
 */
export default async function BrandCategoryRedirect({
  params,
}: {
  params: Promise<{ slug: string; categorySlug: string }>;
}) {
  const { slug, categorySlug } = await params;
  const [brand, category] = await Promise.all([getBrandBySlug(slug), getBySlug(categorySlug)]);
  if (!brand) notFound();
  permanentRedirect(category ? `/b/${brand.slug}?cat=${category.id}` : `/b/${brand.slug}`);
}
