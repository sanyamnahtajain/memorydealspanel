import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/server/auth/cookie";
import { hasPassedEntryGate } from "@/server/auth/entry-gate";
import { searchCatalog } from "@/server/storefront/catalog";
import { loadSearchIndex, suggestFromIndex, type Suggestion } from "@/server/storefront/search-index";

/**
 * GET /api/search/suggest?q=… — the search sheet's type-ahead.
 *
 * A plain GET (not a server action) so the phone can CANCEL a stale request
 * when the next letter is typed and cache answers it has already seen — server
 * actions run one at a time and cannot be aborted, which is what made typing
 * feel stuck. Answers come from the in-memory index (milliseconds), with the
 * database search as the fallback while a cold instance builds it.
 *
 * Price-free by construction. Still behind the shop-code wall: suggestions are
 * catalogue data, and the wall exists so strangers can't browse it.
 */

export const dynamic = "force-dynamic";

const MAX_QUERY = 80;
const LIMIT = 8;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const store = await cookies();
  if (!store.has(SESSION_COOKIE) && !(await hasPassedEntryGate())) {
    return NextResponse.json({ items: [] }, { status: 403 });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY);
  if (q.length === 0) return respond([]);

  const index = await loadSearchIndex();
  if (index) return respond(suggestFromIndex(index, q, LIMIT));

  // Cold instance and the index is not ready yet: the original database path.
  const { items } = await searchCatalog(q);
  return respond(
    items.slice(0, LIMIT).map((p) => {
      const primary = p.images.find((img) => img.isPrimary) ?? p.images[0] ?? null;
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        brand: p.brand,
        thumbUrl: primary ? (primary.thumbUrl ?? primary.url) : null,
      };
    }),
  );
}

function respond(items: Suggestion[]): NextResponse {
  return NextResponse.json(
    { items },
    // Per device only (the wall depends on this browser's cookies); a minute is
    // plenty — new products reach the index within a minute anyway.
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
