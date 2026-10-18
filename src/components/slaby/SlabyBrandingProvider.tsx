"use client";

import * as React from "react";

import type { SlabyBrandingConfig } from "@/lib/slaby/branding";

/**
 * The resolved "Built with Slaby" config, handed down from the storefront
 * layout (one cached server read per request) so every badge on the page
 * renders on the server with the right answer — no per-page API call, no
 * badge popping in after hydration. `null` = no provider above (the admin,
 * tests); the hook then falls back to the fetch it always did.
 */
export const SlabyBrandingContext = React.createContext<SlabyBrandingConfig | null>(null);

export function SlabyBrandingProvider({
  config,
  children,
}: {
  config: SlabyBrandingConfig;
  children: React.ReactNode;
}) {
  return <SlabyBrandingContext.Provider value={config}>{children}</SlabyBrandingContext.Provider>;
}
