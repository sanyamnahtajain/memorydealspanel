import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

/**
 * Admin segment layout. It renders children unchanged (each admin page brings
 * its own `AdminShell`), but overrides the document metadata so the admin
 * console is a DISTINCT PWA from the storefront:
 *   - its own home-screen name ("TMD Admin") + Apple web-app title,
 *   - no search indexing,
 *   - its own manifest (`/admin.webmanifest` — dark splash, `/admin/dashboard`
 *     start URL), overriding the storefront manifest for /admin/* pages.
 *
 * Combined with hosting the admin on the `admin.` subdomain (a separate
 * origin), this gives the admin its own installable app, icon, splash screen,
 * and service worker — fully separate from the storefront install.
 */
export const metadata: Metadata = {
  title: {
    default: "Admin · The Memory Deals",
    template: "%s · TMD Admin",
  },
  applicationName: "TMD Admin",
  // Distinct admin PWA manifest (own name / start_url / dark splash). Overrides
  // the storefront manifest link for /admin/* pages.
  manifest: "/admin.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "TMD Admin",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#1e2a9c",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
