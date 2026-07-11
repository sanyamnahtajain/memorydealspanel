import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { AppToaster } from "@/components/common";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { themeScript } from "@/components/theme/theme-script";
import { PreferencesProvider } from "@/components/preferences/PreferencesProvider";
import {
  DENSITY_COOKIE,
  prefsScript,
} from "@/components/preferences/prefs-script";
import { PWARegister } from "@/components/pwa/PWARegister";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { ScrollToTop } from "@/components/common/ScrollToTop";
import { siteBaseUrl } from "./seo-site-url";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteBaseUrl()),
  title: {
    default: "The Memory Deals — A Hub of Mobile Accessories",
    template: "%s · The Memory Deals",
  },
  description:
    "The Memory Deals — a hub of mobile accessories. Wholesale prices on chargers, cables, power banks, cases and more, visible to approved retailers only.",
  applicationName: "The Memory Deals",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png", sizes: "64x64" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    // Light storefront surface — mirrors :root --background in globals.css
    {
      media: "(prefers-color-scheme: light)",
      color: "oklch(0.988 0.004 85)",
    },
    // Dark surface — mirrors .dark --background in globals.css
    {
      media: "(prefers-color-scheme: dark)",
      color: "oklch(0.155 0.01 262)",
    },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve density from its cookie so SSR emits the matching `data-density`
  // attribute and there is no layout shift before the client hydrates. The
  // render-blocking prefs script still corrects it from localStorage first.
  const cookieStore = await cookies();
  const densityCookie = cookieStore.get(DENSITY_COOKIE)?.value;
  const initialDensity =
    densityCookie === "compact" ? "compact" : "comfortable";

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-scroll-behavior="smooth"
      data-density={initialDensity}
      suppressHydrationWarning
    >
      <head>
        {/* Render-blocking theme bootstrap — sets the `dark` class before the
            first paint to prevent a flash of the wrong theme (FOUC). */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Render-blocking UI-preferences bootstrap — sets `data-density`
            (and `data-reduce-motion`) before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: prefsScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <PreferencesProvider initialDensity={initialDensity}>
            <ScrollToTop />
            {children}
            {/* PWA_REGISTER_SLOT */}
            <PWARegister />
            <InstallPrompt />
            <AppToaster />
          </PreferencesProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
