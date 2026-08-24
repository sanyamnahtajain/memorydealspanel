import { z } from "zod";

/**
 * "Built with Slaby" branding config (owner request) — which storefront spots
 * carry the Slaby badge/ad. Stored as JSON on the StoreSettings singleton and
 * parsed DEFENSIVELY here: anything missing or malformed resolves to
 * everything-off, so the feature is inert until the admin turns it on and can
 * never take a page down.
 *
 * Pure module (no server imports) — shared by the server service, the admin
 * form, and the client hook.
 */

export const SLABY_PLACEMENTS = [
  "login",
  "requestAccess",
  "orderSuccess",
  "footer",
  "promo",
] as const;
export type SlabyPlacement = (typeof SLABY_PLACEMENTS)[number];

export const SLABY_PLACEMENT_LABELS: Record<SlabyPlacement, { label: string; hint: string }> = {
  login: { label: "Sign-in page", hint: "A quiet badge under the login card." },
  requestAccess: {
    label: "Request-access form",
    hint: "A quiet badge under the access-request form.",
  },
  orderSuccess: {
    label: "Order-placed celebration",
    hint: "“Powered by Slaby” on the animated order-success screen.",
  },
  footer: { label: "Storefront footer", hint: "A “Built with Slaby” line in the footer." },
  promo: {
    label: "Occasional promo card",
    hint: "A small dismissible card, shown at most once per the frequency below.",
  },
};

export interface SlabyBrandingConfig {
  /** Master switch — everything below is moot while this is off. */
  enabled: boolean;
  placements: Record<SlabyPlacement, boolean>;
  /** Days between promo-card appearances (the install-prompt-style snooze). */
  promoFrequencyDays: number;
}

/** Everything OFF — the state of a store that never touched the setting. */
export const SLABY_BRANDING_OFF: SlabyBrandingConfig = {
  enabled: false,
  placements: {
    login: true,
    requestAccess: true,
    orderSuccess: true,
    footer: true,
    promo: true,
  },
  promoFrequencyDays: 7,
};

export const slabyBrandingSchema = z.object({
  enabled: z.boolean(),
  placements: z.object({
    login: z.boolean(),
    requestAccess: z.boolean(),
    orderSuccess: z.boolean(),
    footer: z.boolean(),
    promo: z.boolean(),
  }),
  promoFrequencyDays: z.number().int().min(1).max(365),
});

export type SlabyBrandingInput = z.infer<typeof slabyBrandingSchema>;

/** Parse the stored JSON; anything off-shape → the all-off default. */
export function parseSlabyBranding(value: unknown): SlabyBrandingConfig {
  const parsed = slabyBrandingSchema.safeParse(value);
  return parsed.success ? parsed.data : SLABY_BRANDING_OFF;
}

/** Is this placement live? (master switch AND the placement's own toggle) */
export function slabyPlacementOn(
  config: SlabyBrandingConfig,
  placement: SlabyPlacement,
): boolean {
  return config.enabled && config.placements[placement];
}

/** The outbound link, tagged so Slaby can see where visitors came from. */
export function slabyHref(placement: SlabyPlacement): string {
  return `https://slaby.in/?utm_source=memorydeals&utm_medium=badge&utm_campaign=${placement}`;
}
