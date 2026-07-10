import type { MetadataRoute } from "next";

/**
 * PWA Web App Manifest for MemoryDeals.
 *
 * Served at /manifest.webmanifest by Next.js. Makes both the storefront and
 * admin surfaces installable on Android Chrome (the PRD's target device),
 * which accepts SVG icons for install.
 *
 * Colors are literal brand values (electric blue #2563EB) — the manifest is
 * outside the component/token system, so hardcoding is correct here.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MemoryDeals",
    short_name: "MemoryDeals",
    description:
      "B2B wholesale catalog for mobile accessories — chargers, cables, power banks and more. Trade pricing for approved retailers.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#2563EB",
    categories: ["business", "shopping"],
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icons/apple-touch-icon.svg",
        sizes: "180x180",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
