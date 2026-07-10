/**
 * Canonical origin resolution for SEO surfaces (sitemap, robots, metadata).
 *
 * Order of precedence:
 *   1. `NEXT_PUBLIC_SITE_URL`  — explicit production origin (recommended).
 *   2. `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL` — deploy-provided host.
 *   3. `http://localhost:3000` — local dev fallback.
 *
 * The returned value is a bare origin with NO trailing slash, so callers can
 * safely template `${base}/path`.
 */
export function siteBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit && explicit.trim().length > 0) {
    return stripTrailingSlash(explicit.trim());
  }

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd && vercelProd.trim().length > 0) {
    return `https://${stripTrailingSlash(vercelProd.trim())}`;
  }

  const vercel = process.env.VERCEL_URL;
  if (vercel && vercel.trim().length > 0) {
    return `https://${stripTrailingSlash(vercel.trim())}`;
  }

  return "http://localhost:3000";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
