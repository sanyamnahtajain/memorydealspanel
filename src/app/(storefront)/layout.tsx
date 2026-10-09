import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { SESSION_COOKIE } from "@/server/auth/cookie";
import { listLiveReels } from "@/server/services/reels";
import { ReelsAvailabilityProvider } from "@/components/storefront/reels/ReelsAvailability";

/**
 * Storefront layout — two facts the shell and the client need on every page:
 *
 *  - whether any reel is live (header Reels entry point): the same
 *    swr-cached, fail-soft, price-free read the home rail uses;
 *  - whether the request carried a session cookie AT ALL. Stamped on the
 *    wrapper as `data-viewer-hint` so the per-viewer context client can skip
 *    its request for a visitor the server would answer with an empty payload
 *    anyway (one function invocation per page view, for nothing). Presence
 *    only — the cookie's value is never read here, and "has a cookie" never
 *    means "entitled": entitlement is still resolved per request on the
 *    server. Every storefront route is already rendered per request (the
 *    root layout reads headers for the CSP nonce), so this read changes no
 *    caching.
 *
 * Nothing else lives here on purpose: every page still renders its own
 * <StorefrontShell>.
 */
export default async function StorefrontLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [reels, cookieStore] = await Promise.all([listLiveReels(1), cookies()]);
  const hasSession = (cookieStore.get(SESSION_COOKIE)?.value ?? "") !== "";
  return (
    <ReelsAvailabilityProvider available={reels.length > 0}>
      <div data-viewer-hint={hasSession ? "session" : "anon"} className="contents">
        {children}
      </div>
    </ReelsAvailabilityProvider>
  );
}
