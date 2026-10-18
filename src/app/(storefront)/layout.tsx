import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { SESSION_COOKIE } from "@/server/auth/cookie";
import { resolveViewer } from "@/server/auth/viewer";
import { whatsappContactHrefForViewer } from "@/server/contact";
import { swrCached } from "@/server/cache/swr";
import { listLiveReels } from "@/server/services/reels";
import { getSlabyBranding } from "@/server/services/store-settings";
import { SLABY_BRANDING_OFF, type SlabyBrandingConfig } from "@/lib/slaby/branding";
import { ReelsAvailabilityProvider } from "@/components/storefront/reels/ReelsAvailability";
import { SlabyBrandingProvider } from "@/components/slaby/SlabyBrandingProvider";
import { WhatsAppFloat } from "@/components/storefront/WhatsAppFloat";

/**
 * Storefront layout — the few facts the shell and the client need on every
 * page, resolved once per request:
 *
 *  - whether any reel is live (header Reels entry point);
 *  - the "Built with Slaby" config, so every badge renders in the first paint
 *    instead of after a per-page fetch (both reads are swr-cached, fail soft,
 *    and price-free);
 *  - whether the request carried a session cookie AT ALL, stamped as
 *    `data-viewer-hint` so the per-viewer context client can skip its request
 *    for a visitor the server would answer empty anyway. Presence only;
 *    entitlement is still resolved per request on the server;
 *  - the floating WhatsApp button, for viewers the contact gate admits
 *    (`whatsappContactHrefForViewer` — the same rule as the product page).
 *
 * Every storefront route is already rendered per request (the root layout
 * reads headers for the CSP nonce), so these reads change no caching.
 * Nothing else lives here on purpose: every page still renders its own
 * <StorefrontShell>.
 */
export default async function StorefrontLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [reels, cookieStore, slaby, viewer] = await Promise.all([
    listLiveReels(1),
    cookies(),
    swrCached<SlabyBrandingConfig>("slaby-branding", getSlabyBranding, {
      ttlMs: 60_000,
      coldBudgetMs: 1_500,
      fallback: SLABY_BRANDING_OFF,
      label: "slaby branding",
    }),
    resolveViewer(),
  ]);
  const hasSession = (cookieStore.get(SESSION_COOKIE)?.value ?? "") !== "";
  const whatsappHref = whatsappContactHrefForViewer(viewer);
  return (
    <ReelsAvailabilityProvider available={reels.length > 0}>
      <SlabyBrandingProvider config={slaby}>
        <div data-viewer-hint={hasSession ? "session" : "anon"} className="contents">
          {children}
        </div>
        {whatsappHref ? <WhatsAppFloat href={whatsappHref} /> : null}
      </SlabyBrandingProvider>
    </ReelsAvailabilityProvider>
  );
}
