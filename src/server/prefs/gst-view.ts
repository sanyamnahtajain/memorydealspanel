import "server-only";
import { cookies } from "next/headers";

import { getSellerTaxProfile } from "@/server/services/tax-profile";

/**
 * GST display-preference cookie — the retailer's choice of seeing prices
 * inclusive or exclusive of GST.
 *
 * Mirrors the density-cookie pattern (`md-density`): a single, small,
 * non-httpOnly cookie the server can read during SSR to render prices in the
 * right mode without a flash. When the cookie is unset we fall back to the
 * seller profile's `displayMode` (INCLUSIVE ⇒ "incl", EXCLUSIVE ⇒ "excl").
 *
 * This preference is inert while the GST kill-switch (`gstEnabled`) is off —
 * the storefront simply never surfaces the toggle.
 */

/** Cookie name holding the retailer's GST display preference. */
export const GST_VIEW_COOKIE = "gst_view";

/** The two display modes, as stored in the cookie. */
export type GstView = "incl" | "excl";

/** One year — this is a stable UI preference, not a session artefact. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function isGstView(value: unknown): value is GstView {
  return value === "incl" || value === "excl";
}

/**
 * Reads the effective GST view preference. Returns the cookie value when set
 * to a valid mode; otherwise derives the default from the seller profile's
 * `displayMode`. Never throws.
 */
export async function getGstViewPreference(): Promise<GstView> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(GST_VIEW_COOKIE)?.value;
  if (isGstView(raw)) return raw;

  const profile = await getSellerTaxProfile();
  return profile.displayMode === "INCLUSIVE" ? "incl" : "excl";
}

/**
 * Persists the GST view preference. Must be called from a server action or
 * route handler (where cookie writes are permitted). Ignores invalid input.
 */
export async function setGstViewPreference(view: GstView): Promise<void> {
  if (!isGstView(view)) return;
  const cookieStore = await cookies();
  cookieStore.set(GST_VIEW_COOKIE, view, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}
