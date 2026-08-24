"use client";

import * as React from "react";

import {
  parseSlabyBranding,
  SLABY_BRANDING_OFF,
  type SlabyBrandingConfig,
} from "@/lib/slaby/branding";

/**
 * Client-side access to the Slaby branding config for components that are
 * mounted from many places (footer, request-access sheet, promo card) where
 * prop-drilling the server config would touch every call site.
 *
 * One fetch per page load (module-level promise cache, shared by every
 * consumer). Until it resolves — or if it fails — the config is the all-off
 * default, so nothing flashes and a network error can never break a flow.
 */

let cached: SlabyBrandingConfig | null = null;
let inflight: Promise<SlabyBrandingConfig> | null = null;

function load(): Promise<SlabyBrandingConfig> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch("/api/slaby-branding")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        cached = parseSlabyBranding(json?.config);
        return cached;
      })
      .catch(() => {
        inflight = null; // allow a retry on the next mount
        return SLABY_BRANDING_OFF;
      });
  }
  return inflight;
}

export function useSlabyBranding(): SlabyBrandingConfig {
  const [config, setConfig] = React.useState<SlabyBrandingConfig>(
    cached ?? SLABY_BRANDING_OFF,
  );
  React.useEffect(() => {
    let alive = true;
    void load().then((c) => {
      if (alive) setConfig(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return config;
}
