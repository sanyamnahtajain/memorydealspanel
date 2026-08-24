import { NextResponse } from "next/server";

import { getSlabyBranding } from "@/server/services/store-settings";

/**
 * GET /api/slaby-branding — the resolved "Built with Slaby" placement config
 * for client components mounted in many places (footer, request-access sheet,
 * promo card). PUBLIC by design: it carries only boolean toggles + a
 * frequency, nothing sensitive. Short CDN cache so an admin toggle lands
 * within a minute without hammering the DB.
 */

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const config = await getSlabyBranding();
  return NextResponse.json(
    { config },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
