import type { NextConfig } from "next";

/**
 * Allowed remote hosts for `next/image`. Product/brand/category images live on
 * Cloudflare R2 and are served from `R2_PUBLIC_URL` (an `*.r2.dev` bucket URL
 * in dev/launch, or a custom domain later). We allow:
 *   - any `*.r2.dev` public bucket (covers the current pub-<hash>.r2.dev), and
 *   - whatever host `R2_PUBLIC_URL` resolves to (covers a custom image domain).
 * Local-disk dev uploads are same-origin (`/uploads/...`) and need no entry.
 */
const remotePatterns: NonNullable<
  NonNullable<NextConfig["images"]>["remotePatterns"]
> = [{ protocol: "https", hostname: "**.r2.dev" }];

if (process.env.R2_PUBLIC_URL) {
  try {
    const url = new URL(process.env.R2_PUBLIC_URL);
    remotePatterns.push({
      protocol: url.protocol === "http:" ? "http" : "https",
      hostname: url.hostname,
    });
  } catch {
    // Malformed R2_PUBLIC_URL — fall back to the wildcard above.
  }
}

const nextConfig: NextConfig = {
  images: { remotePatterns },
};

export default nextConfig;
