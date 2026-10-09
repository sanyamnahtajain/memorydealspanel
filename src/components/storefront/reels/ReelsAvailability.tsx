"use client";

import * as React from "react";

/**
 * Whether at least one reel is live — decided ON THE SERVER by the storefront
 * layout (one swr-cached, price-free read) and handed down so the shell can
 * hide the header "Reels" entry point instead of linking shoppers to an empty
 * feed. Defaults to false: a shell rendered without the provider (tests, the
 * admin) simply shows no Reels icon.
 */
const ReelsAvailabilityContext = React.createContext(false);

export function ReelsAvailabilityProvider({
  available,
  children,
}: {
  available: boolean;
  children: React.ReactNode;
}) {
  return (
    <ReelsAvailabilityContext.Provider value={available}>
      {children}
    </ReelsAvailabilityContext.Provider>
  );
}

export function useReelsAvailable(): boolean {
  return React.useContext(ReelsAvailabilityContext);
}
