import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { IMAGE_WIDTHS, snapImageWidth } from "@/lib/image-loader";
import { isR2Configured, publicBaseOrEmpty, putDerivedObject } from "@/server/storage/r2";

/**
 * GET /api/img?u=<storage url>&w=<width>&q=<quality>
 *
 * The catalogue image resizer behind src/lib/image-loader.ts (read that
 * header for why this exists). Fetches the original from our object storage,
 * resizes to `w` (never upscaling), encodes WebP, and answers IMMUTABLE — the
 * CDN caches each (image, width) for a year and the function is never asked
 * for that pair again. Originals are content-addressed (UUID keys), so
 * immutability is safe.
 *
 * PERSISTED VARIANTS: the CDN cache is per region and evicts, so without
 * more the same (image, width) was resized again on every cold edge — on a
 * busy day that was most of the project's function CPU and origin transfer,
 * and the 30 s cap turned the slowest of them into timeouts. Now the first
 * resize is written back to R2 under a content-addressed key, and every later
 * request for that pair answers with an immutable 302 to R2 after one cheap
 * HEAD: no download, no decode, a few milliseconds of function time, and R2
 * egress is free. The master (1920) is persisted the same way, so a 15 MB
 * original is downloaded exactly once in the life of the catalogue.
 *
 * FAILS OPEN: if the original cannot be fetched, decoded or resized — a
 * corrupt file, sharp unavailable on the host, an upstream hiccup — the
 * response is a redirect to the original. A broken resizer must degrade to
 * "the picture is big", never to "there is no picture".
 *
 * SECURITY: `u` is an open parameter, so the upstream host is allow-listed to
 * our own storage. This must never become a general-purpose proxy.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Widths BELOW this are cut from a CDN-cached master at this width rather
 * than from the original. Measured: a 15 MB original costs 4–5 s to fetch and
 * decode on every cold width, and a phone, a tablet and a desktop each ask for
 * a different width — three visitors, three 15 MB downloads. Via the master,
 * only the very first request for an image ever touches the original; every
 * other width starts from a ~100 KB WebP the CDN already holds.
 */
const MASTER_WIDTH = 1920;
const MASTER_QUALITY = 82;

/** A year, immutable; `stale-if-error` keeps serving through a bad minute. */
const CACHE_HEADER = "public, max-age=31536000, s-maxage=31536000, immutable, stale-if-error=86400";
/** The failure redirect is short-lived so a fixed resizer takes over quickly. */
const FALLBACK_CACHE_HEADER = "public, max-age=60, s-maxage=300";
/** Refuse to decode anything larger than this — a guard for the function's memory. */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;
/** The existence check against R2 must never be what makes a request slow. */
const HEAD_TIMEOUT_MS = 2_500;
/** Bump to invalidate every persisted variant (e.g. after a quality change). */
const DERIVED_VERSION = "v1";

/**
 * Where a (source, width, quality) variant lives in R2. Content-addressed on
 * the source URL — originals never change under a key — so it is safe to
 * answer this path forever once it exists.
 */
function derivedKey(upstream: URL, width: number, quality: number): string {
  const digest = createHash("sha1").update(upstream.toString()).digest("hex");
  return `derived/${DERIVED_VERSION}/${digest.slice(0, 2)}/${digest}/w${width}-q${quality}.webp`;
}

/** The persisted variant's public URL when it already exists, else null. */
async function findPersisted(key: string): Promise<URL | null> {
  const base = publicBaseOrEmpty();
  if (!base) return null;
  const url = new URL(`${base}/${key}`);
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

function allowedUpstream(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  if (url.hostname.endsWith(".r2.dev")) return true;
  const base = publicBaseOrEmpty();
  if (base) {
    try {
      if (new URL(base).hostname === url.hostname) return true;
    } catch {
      /* malformed base — fall through */
    }
  }
  return false;
}

function fallback(to: URL): NextResponse {
  return NextResponse.redirect(to, { status: 302, headers: { "Cache-Control": FALLBACK_CACHE_HEADER } });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const raw = params.get("u") ?? "";
  let upstream: URL;
  try {
    upstream = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Bad image URL." }, { status: 400 });
  }
  if (!allowedUpstream(upstream)) {
    return NextResponse.json({ error: "Image host not allowed." }, { status: 400 });
  }

  const requestedWidth = Number(params.get("w"));
  const width = Number.isFinite(requestedWidth) && requestedWidth > 0 ? snapImageWidth(requestedWidth) : IMAGE_WIDTHS[8];
  const requestedQuality = Number(params.get("q"));
  const quality = Number.isFinite(requestedQuality) ? Math.min(100, Math.max(1, Math.round(requestedQuality))) : 75;

  // Already resized once, anywhere, ever? Then this is a redirect, cached
  // immutably by the CDN and the browser alike — the function does no work.
  const persist = isR2Configured();
  const key = derivedKey(upstream, width, quality);
  if (persist) {
    const existing = await findPersisted(key);
    if (existing) {
      return NextResponse.redirect(existing, {
        status: 302,
        headers: { "Cache-Control": CACHE_HEADER, "X-Image-Via": "r2" },
      });
    }
  }

  // Anything smaller than the master is cut FROM the master (see MASTER_WIDTH):
  // a request to this same route at the master width, which the CDN answers
  // from cache after the first time. The master request itself reads the
  // original — recursion is exactly one level deep by construction.
  const viaMaster = width < MASTER_WIDTH;
  const source_url = viaMaster
    ? new URL(
        `/api/img?${new URLSearchParams({ u: upstream.toString(), w: String(MASTER_WIDTH), q: String(MASTER_QUALITY) })}`,
        request.nextUrl.origin,
      )
    : upstream;

  let source: ArrayBuffer;
  try {
    const res = await fetch(source_url, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      // Immutable either way; let the platform cache the fetch too.
      cache: "force-cache",
    });
    if (!res.ok) return fallback(upstream);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_SOURCE_BYTES) return fallback(upstream);
    source = await res.arrayBuffer();
    if (source.byteLength > MAX_SOURCE_BYTES) return fallback(upstream);
  } catch {
    return fallback(upstream);
  }

  try {
    // Loaded lazily so a host without the native binary fails soft per
    // request instead of failing the whole route module at import.
    const { default: sharp } = await import("sharp");
    const image = sharp(Buffer.from(source), { failOn: "none", limitInputPixels: 80_000_000 }).rotate();
    const meta = await image.metadata();
    const body = await image
      .resize({ width, withoutEnlargement: true, fit: "inside" })
      .webp({ quality, effort: 4 })
      .toBuffer();
    // Write-behind for every edge that comes after this one. Awaited (a
    // few tens of ms) so the object exists before the response is cached;
    // a failed write only means the next cold edge resizes once more.
    const persisted = persist ? await putDerivedObject(key, new Uint8Array(body), "image/webp") : false;
    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(body.byteLength),
        "Cache-Control": CACHE_HEADER,
        // Diagnostics for the network tab: how much a phone was spared.
        "X-Image-Source-Bytes": String(source.byteLength),
        "X-Image-Source-Width": String(meta.width ?? 0),
        "X-Image-Via": viaMaster ? "master" : "original",
        "X-Image-Persisted": persisted ? "1" : "0",
      },
    });
  } catch (error) {
    console.error("[img] resize failed, redirecting to original:", error);
    return fallback(upstream);
  }
}
