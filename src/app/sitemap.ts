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
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteBaseUrl();

  const [categories, products] = await Promise.all([
    listActive(),
    prisma.product.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      // Explicit projection — NO price/mrp. Slug + timestamp only.
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

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

  const categoryRoutes: MetadataRoute.Sitemap = categories.map((category) => ({
    url: `${base}/categories/${category.slug}`,
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
