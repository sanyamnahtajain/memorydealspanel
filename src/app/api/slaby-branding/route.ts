import { NextResponse } from "next/server";

import { getSlabyBranding } from "@/server/services/store-settings";
import { parseSlabyBranding } from "@/lib/slaby/branding";

/**
 * GET /api/slaby-branding — the resolved "Built with Slaby" placement config
 * for client components mounted in many places (footer, request-access sheet,
 * promo card). PUBLIC by design: it carries only boolean toggles + a
 * frequency, nothing sensitive. Short CDN cache so an admin toggle lands
 * within a minute without hammering the DB.
 */

/**
 * CACHED, NOT DYNAMIC. This response is identical for every visitor and this
 * route is mounted in the shell — so under `force-dynamic` it cost one
 * function invocation (and its observability events) on EVERY page view of
 * the whole storefront, to return the same three booleans each time.
 *
 * `s-maxage` is what the CDN reads; the previous `max-age` alone only cached
 * in the visitor's own browser, so every new tab and every cold visitor still
 * hit the function. An admin toggle now lands within a minute, and up to five
 * more minutes of stale-while-revalidate serve instantly while it refreshes.
 */
export const revalidate = 60;

export async function GET(): Promise<NextResponse> {
  // FAILS SOFT. Because this route is cached it is PRERENDERED AT BUILD TIME,
  // so an unhandled database error here does not just break one request — it
  // fails `next build` and blocks the whole deploy (seen on a Vercel project
  // whose DATABASE_URL was wrong: every page tolerated it, this route did
  // not). A "Built with" badge is not worth a failed release, and it is not
  // worth a 500 in the storefront shell either: on any read failure the
  // answer is "everything off", uncached so the real value returns as soon
  // as the database does.
  let config;
  try {
    config = await getSlabyBranding();
  } catch (error) {
    console.error("[slaby-branding] read failed; serving defaults:", error);
    return NextResponse.json(
      { config: parseSlabyBranding(undefined) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { config },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
