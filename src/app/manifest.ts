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
    name: "The Memory Deals",
    short_name: "TMD",
    description:
      "The Memory Deals — a hub of mobile accessories. Wholesale prices on chargers, cables, power banks and more, for approved retailers.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Near-black boot canvas: the OS-generated splash, the pre-paint #md-boot
    // cover, and the animated SplashScreen all share it — one seamless launch.
    background_color: "#0A0A0B",
    theme_color: "#0A0A0B",
    categories: ["business", "shopping"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
