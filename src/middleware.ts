import { NextResponse, type NextRequest } from "next/server";
import {
  buildContentSecurityPolicy,
  securityHeaders,
} from "@/server/security/headers";
// Import ONLY the cookie name from the dependency-free module. Importing it
// from `@/server/auth/session` would transitively pull Prisma (no Edge wasm
// engine) and `node:crypto` (unavailable in Edge) into the middleware bundle,
// which fails to compile and 500s every route. See cookie.ts for the rationale.
import { SESSION_COOKIE } from "@/server/auth/cookie";

/**
 * Edge middleware — two jobs, both cheap and DB-free:
 *
 * 1. Stamp every response with the app's security headers (CSP, HSTS in prod,
 *    frame/MIME/referrer guards). This is defence-in-depth that complements the
 *    price gate; it is applied uniformly so no route can accidentally opt out.
 *    A fresh per-request nonce is minted here and woven into `script-src`; it
 *    is also forwarded to the App Router on the *request* headers so Next
 *    stamps the same nonce onto its inline bootstrap scripts and the app can
 *    hydrate. Without the nonce the strict CSP blocks those inline scripts,
 *    React never hydrates, and every client component (login included) breaks.
 *
 * 2. Coarse admin-area protection: any `/admin/*` request without an
 *    `md_session` cookie is bounced to `/admin/login`. This is a presence check
 *    only — it does NOT decode the session, look anything up, or compute
 *    priceAccess. The Edge runtime can't run Prisma, and (more importantly) the
 *    authoritative "is this actually an admin?" decision belongs to
 *    `resolveViewer` running in the RSC/server-action layer. Middleware just
 *    keeps anonymous traffic off the admin surface and out of the login-only
 *    forms; the dashboard re-checks with a real DB-backed viewer resolution.
 *
 * Because middleware can't distinguish an admin session from a customer one
 * (both live in the same cookie), a customer who forges/reuses a cookie still
 * reaches `/admin/dashboard`, where `resolveViewer` + `isAdmin` reject them and
 * redirect back to login. Middleware is the outer, fail-safe fence; the page
 * guard is the real lock.
 */

/** Admin routes that must remain reachable without a session. */
const ADMIN_PUBLIC_PATHS = ["/admin/login"];

function isAdminPublic(pathname: string): boolean {
  return ADMIN_PUBLIC_PATHS.some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
}

/**
 * The header Next's App Router reads to discover the request nonce. When this
 * request header carries a CSP containing `'nonce-<v>'`, Next extracts `<v>`
 * and stamps it onto every inline bootstrap script it renders.
 */
const CSP_HEADER = "Content-Security-Policy";

/** Whether the Next dev server is running (relaxes CSP: eval + websockets). */
const IS_DEV = process.env.NODE_ENV !== "production";

/** Attach the security headers (with this request's nonce) to a response. */
function withSecurityHeaders(
  response: NextResponse,
  nonce: string,
): NextResponse {
  for (const { key, value } of securityHeaders(IS_DEV, nonce)) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * A short, unguessable per-request nonce. `crypto.randomUUID` is available in
 * the Edge runtime and gives ~122 bits of entropy — ample for a CSP nonce.
 */
function makeNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const nonce = makeNonce();

  // Forward the nonce to the App Router on the *request* headers. Next parses
  // this CSP, lifts out the `'nonce-…'` token, and applies it to the inline
  // scripts it emits — the piece that lets the document hydrate.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_HEADER, buildContentSecurityPolicy(IS_DEV, nonce));
  requestHeaders.set("x-nonce", nonce);

  const isLocal = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  const onAdminHost = !isLocal && host.startsWith("admin.");

  // ── The admin subdomain lands on the admin console ────────────────────────
  // https://admin.thememorydeals.com/ → the dashboard (which itself falls back
  // to /admin/login when unauthed, so an unauthed visitor sees the login page).
  // ONLY the root is remapped — /admin/*, the manifest, icons, API and every
  // other route are served untouched, so nothing else is disturbed.
  if (onAdminHost && pathname === "/") {
    if (!request.cookies.has(SESSION_COOKIE)) {
      return withSecurityHeaders(
        NextResponse.redirect(new URL("/admin/login", request.url)),
        nonce,
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/admin/dashboard";
    return withSecurityHeaders(
      NextResponse.rewrite(url, { request: { headers: requestHeaders } }),
      nonce,
    );
  }

  // ── Keep the admin OFF the main domain (opt-in via ADMIN_HOST) ────────────
  // When ADMIN_HOST is configured, /admin/* on the storefront domain is sent to
  // the admin subdomain, so the two apps stay cleanly separated. Skipped when
  // unset (admin still works on the main domain) and in local dev.
  const adminHost = process.env.ADMIN_HOST;
  if (!onAdminHost && !isLocal && adminHost && pathname.startsWith("/admin")) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.host = adminHost;
    return NextResponse.redirect(url);
  }

  // ── Admin auth fence (main domain, and /admin paths on the admin host) ────
  const isAdminArea = pathname.startsWith("/admin");
  if (isAdminArea && !isAdminPublic(pathname)) {
    const hasSession = request.cookies.has(SESSION_COOKIE);
    if (!hasSession) {
      const loginUrl = new URL("/admin/login", request.url);
      // Preserve where the admin was headed so the login flow could restore it.
      loginUrl.searchParams.set("next", pathname);
      return withSecurityHeaders(NextResponse.redirect(loginUrl), nonce);
    }
  }

  return withSecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    nonce,
  );
}

/**
 * Run on all application routes but skip Next internals and static assets, so
 * we neither waste work nor rewrite headers on files served straight from the
 * CDN. `_next/static`, `_next/image`, the favicon and common asset extensions
 * are excluded; everything else (pages, route handlers, server actions) passes
 * through and gets security headers.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff|woff2|ttf|otf|map)$).*)",
  ],
};
