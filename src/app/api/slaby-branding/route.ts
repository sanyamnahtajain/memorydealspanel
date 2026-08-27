import { NextResponse } from "next/server";

import { getSlabyBranding } from "@/server/services/store-settings";

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
  const config = await getSlabyBranding();
  return NextResponse.json(
    { config },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
