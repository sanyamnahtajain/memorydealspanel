import type { MetadataRoute } from "next";

import { siteBaseUrl } from "./seo-site-url";

/**
 * Site-wide robots policy.
 *
 * The public catalog (home, categories, product detail, search) is fully
 * crawlable — those pages never expose prices to an anonymous viewer, so they
 * are safe to index. Everything behind the price gate or session is walled off:
 *   - `/admin`  — the operator console (never public).
 *   - `/account` — per-customer session pages (status, login, renewal).
 *   - `/api`    — server endpoints, never a crawl target.
 *
 * The sitemap is advertised so crawlers discover the canonical catalog URLs
 * (see {@link ./sitemap}).
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteBaseUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/account", "/api"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
