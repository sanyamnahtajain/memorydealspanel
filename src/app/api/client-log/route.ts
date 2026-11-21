import { NextResponse, type NextRequest } from "next/server";

/**
 * POST /api/client-log — one-line reports from shoppers' phones (sent by the
 * boot script, src/lib/boot-script.ts): a page that had to reload itself
 * because its scripts were gone, or one that was stuck even after that.
 *
 * Written to the server log (Vercel → Logs, search "[client]") and nowhere
 * else: no database, no personal data — the path, the reason and the browser.
 * Size-capped and never fails loudly; it is a diagnostic, not a feature.
 */

export const dynamic = "force-dynamic";

const MAX_BYTES = 2048;
const KINDS = new Set(["reload", "stuck", "error"]);

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const text = (await request.text()).slice(0, MAX_BYTES);
    const body = JSON.parse(text) as Record<string, unknown>;
    const kind = clip(body.kind, 16);
    if (KINDS.has(kind)) {
      console.warn(
        "[client]",
        JSON.stringify({
          kind,
          reason: clip(body.reason, 300),
          path: clip(body.path, 200),
          ua: clip(body.ua, 160),
        }),
      );
    }
  } catch {
    /* malformed beacon — ignore */
  }
  return new NextResponse(null, { status: 204 });
}
