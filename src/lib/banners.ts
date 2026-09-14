import { z } from "zod";

import { displayUrlSchema } from "@/lib/schemas/display-url";

/**
 * Storefront promo banners.
 *
 * SCALABILITY IS THE POINT: a banner is (artwork, where it goes, when it runs,
 * which slot). New slots are added to {@link BANNER_PLACEMENTS} — a string, so
 * no migration — and everything else (admin CRUD, scheduling, ordering, the
 * carousel) works for them unchanged.
 */

/** Every slot the storefront knows how to render. */
export const BANNER_PLACEMENTS = [
  {
    key: "HOME_HERO",
    label: "Home — top carousel",
    hint: "The first thing shoppers see. Wide artwork; keep text large.",
  },
  {
    key: "HOME_MID",
    label: "Home — mid strip",
    hint: "Between the sections further down the home page.",
  },
] as const;

export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number]["key"];

export const BANNER_PLACEMENT_KEYS = BANNER_PLACEMENTS.map((p) => p.key) as [
  BannerPlacement,
  ...BannerPlacement[],
];

export function isBannerPlacement(value: string): value is BannerPlacement {
  return (BANNER_PLACEMENT_KEYS as readonly string[]).includes(value);
}

/** Longest alt text worth storing — it is read aloud, not displayed. */
export const MAX_BANNER_ALT = 160;

/**
 * Where a banner may point.
 *
 * Internal paths ("/c/chargers", "/search?q=cable") are the common case and
 * the safe default. An absolute https URL is allowed for a campaign
 * microsite. `javascript:` and protocol-relative "//evil.com" are rejected by
 * displayUrlSchema — a banner is a link an admin types, and it renders for
 * every visitor, so it must never become a script vector.
 */
export const bannerHrefSchema = displayUrlSchema(
  "Link must be a path like /c/chargers or a full https:// address.",
);

export const bannerInputSchema = z.object({
  placement: z.enum(BANNER_PLACEMENT_KEYS),
  imageUrl: displayUrlSchema("Banner image must be a valid URL."),
  mobileImageUrl: displayUrlSchema("Mobile image must be a valid URL")
    .nullish(),
  alt: z.string().trim().min(1, "Describe the banner.").max(MAX_BANNER_ALT),
  href: bannerHrefSchema.nullish(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  active: z.boolean().default(true),
  startsAt: z.string().datetime({ offset: true }).nullish(),
  endsAt: z.string().datetime({ offset: true }).nullish(),
});

export type BannerInput = z.infer<typeof bannerInputSchema>;

/** The shape the storefront renders. */
export interface StorefrontBanner {
  id: string;
  imageUrl: string;
  mobileImageUrl: string | null;
  alt: string;
  href: string | null;
}

export interface BannerSchedule {
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * Whether a banner should be on screen right now.
 *
 * Start is inclusive and end is EXCLUSIVE, so a campaign ending "1 Oct" stops
 * the instant October begins rather than running a day long. A banner with no
 * dates is live whenever it is active.
 */
export function isBannerLive(banner: BannerSchedule, now: Date): boolean {
  if (!banner.active) return false;
  if (banner.startsAt && now < banner.startsAt) return false;
  if (banner.endsAt && now >= banner.endsAt) return false;
  return true;
}

/**
 * Why a banner is not showing, in words an admin can act on. Null when it is
 * live — the admin list uses this so "saved but invisible" is never a mystery.
 */
export function bannerStatusReason(
  banner: BannerSchedule,
  now: Date,
): string | null {
  if (!banner.active) return "Turned off";
  if (banner.startsAt && now < banner.startsAt) return "Scheduled";
  if (banner.endsAt && now >= banner.endsAt) return "Finished";
  return null;
}
