import type { MetadataRoute } from "next";

import { prisma } from "@/server/db";
import { listActive } from "@/server/dal/categories";

import { siteBaseUrl } from "./seo-site-url";

/**
 * Dynamic sitemap for the public catalog.
 *
 * Enumerates the crawlable, price-free surfaces:
 *   - the home page and the categories index,
 *   - every ACTIVE category (`/categories/[slug]`),
 *   - every ACTIVE, non-soft-deleted product (`/products/[slug]`).
 *
 * PRICE GATE: this route only ever reads slugs and timestamps — never `price`
 * or `mrp`. The product query uses an explicit `select` that omits money
 * fields, so no gated data can leak into the sitemap (which is served to
 * anonymous crawlers).
 */
// Generated on-demand at request time, never prerendered at build. A sitemap
// must not couple the DEPLOY to the database — if Atlas is briefly unreachable
// during `next build`, the build should still succeed. Crawlers hit this route
// rarely, so the per-request DB read is negligible.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteBaseUrl();

  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${base}/categories`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];

  // Price-free reads (slugs + timestamps only). Wrapped so a transient DB
  // outage degrades to the static routes instead of 500-ing the sitemap.
  let categories: Awaited<ReturnType<typeof listActive>> = [];
  let products: { slug: string; updatedAt: Date }[] = [];
  try {
    [categories, products] = await Promise.all([
      listActive(),
      prisma.product.findMany({
        where: { status: "ACTIVE", deletedAt: null },
        // Explicit projection — NO price/mrp. Slug + timestamp only.
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
      }),
    ]);
  } catch (error) {
    console.error(
      "[sitemap] DB read failed; serving static routes only:",
      error,
    );
    return staticRoutes;
  }

  const categoryRoutes: MetadataRoute.Sitemap = categories.map((category) => ({
    url: `${base}/c/${category.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const productRoutes: MetadataRoute.Sitemap = products.map((product) => ({
    url: `${base}/products/${product.slug}`,
    lastModified: product.updatedAt,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...categoryRoutes, ...productRoutes];
}
