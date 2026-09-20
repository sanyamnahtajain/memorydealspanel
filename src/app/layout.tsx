import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
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
import { PushSoundBridge } from "@/components/notify/PushSoundBridge";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { SplashScreen } from "@/components/pwa/SplashScreen";
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

  // The per-request CSP nonce minted in src/proxy.ts. Next stamps it onto its
  // OWN inline scripts automatically, but not onto the hand-written ones
  // below — and under `strict-dynamic` a script without it is simply refused.
  // All three boot scripts had been silently blocked in production: dark-mode
  // users got a flash of the light theme, and saved density never applied
  // before paint.
  //
  // `suppressHydrationWarning` on each: browsers blank the `nonce` attribute
  // in the DOM once a script has been parsed (so page scripts cannot read it),
  // which React would otherwise report as a server/client mismatch.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-scroll-behavior="smooth"
      data-density={initialDensity}
      suppressHydrationWarning
    >
      <head>
        {/* Stops Chrome's "Translate this page?" bar. The catalogue is written
            for Indian retailers in English, and machine-translating product
            names, brands and spec strings produced nonsense — the owner asked
            for the prompt gone. Trade-off: it also disables manual Chrome
            translation for this site. */}
        <meta name="google" content="notranslate" />
        {/* Render-blocking theme bootstrap — sets the `dark` class before the
            first paint to prevent a flash of the wrong theme (FOUC). */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        {/* Render-blocking UI-preferences bootstrap — sets `data-density`
            (and `data-reduce-motion`) before the first paint. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: prefsScript }}
        />
        {/* Render-blocking PWA boot cover — in the INSTALLED app's first
            launch of a session, flag <html> before paint so the dark #md-boot
            cover shows instantly (no flash of app content) until the animated
            SplashScreen takes over and removes the flag.

            FAILSAFE: the cover is full-screen and normally removed by React
            (SplashScreen's effect). If hydration is slow or never happens —
            a weak connection, a failed chunk — that would be a black screen
            forever. So the same script that raises the cover also schedules
            its removal, with no dependency on anything else loading. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var s=(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;if(s&&!sessionStorage.getItem('md-splash-played')&&location.pathname.indexOf('/admin')!==0){var d=document.documentElement;d.dataset.mdBoot='1';setTimeout(function(){try{delete d.dataset.mdBoot}catch(e){}},4000)}}catch(e){}})();",
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html:
              '#md-boot{display:none}html[data-md-boot="1"] #md-boot{display:flex;position:fixed;inset:0;z-index:90;background:#0A0A0B;align-items:center;justify-content:center}#md-boot span{display:flex;width:5rem;height:5rem;align-items:center;justify-content:center;border-radius:1rem;background:#fff}',
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        {/* Pre-paint boot cover (installed app only — see the head script).
            The animated SplashScreen paints over it, then clears the flag. */}
        <div id="md-boot" aria-hidden>
          <span>
            {/* eslint-disable-next-line @next/next/no-img-element -- pre-hydration boot art */}
            <img src="/brand/logo.png" alt="" width={56} height={56} />
          </span>
        </div>
        <ThemeProvider>
          <PreferencesProvider initialDensity={initialDensity}>
            <ScrollToTop />
            {children}
            {/* PWA_REGISTER_SLOT */}
            <PWARegister />
            <SplashScreen />
            <InstallPrompt />
            <AppToaster />
            {/* Turns a push that arrives while the app is open into the
                branded tune + an in-app toast. Both surfaces need it, so it
                lives here rather than in either shell. */}
            <PushSoundBridge />
          </PreferencesProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
