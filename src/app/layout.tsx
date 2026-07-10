import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppToaster } from "@/components/common";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { themeScript } from "@/components/theme/theme-script";
import { PWARegister } from "@/components/pwa/PWARegister";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {/* Render-blocking theme bootstrap — sets the `dark` class before the
            first paint to prevent a flash of the wrong theme (FOUC). */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          {children}
          {/* PWA_REGISTER_SLOT */}
          <PWARegister />
          <InstallPrompt />
          <AppToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
