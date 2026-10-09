import type { ReactNode } from "react";

import { listLiveReels } from "@/server/services/reels";
import { ReelsAvailabilityProvider } from "@/components/storefront/reels/ReelsAvailability";

/**
 * Storefront layout — the one place that knows whether any reel is live, so
 * the shell's header can show or hide its Reels entry point. The read is the
 * same swr-cached, fail-soft, price-free service the home rail uses; it reads
 * no cookies, so it is safe inside the ISR home shell. Nothing else lives
 * here on purpose: every page still renders its own <StorefrontShell>.
 */
export default async function StorefrontLayout({
  children,
}: {
  children: ReactNode;
}) {
  const reels = await listLiveReels(1);
  return (
    <ReelsAvailabilityProvider available={reels.length > 0}>
      {children}
    </ReelsAvailabilityProvider>
  );
}
