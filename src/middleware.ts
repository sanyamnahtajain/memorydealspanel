import { NextResponse, type NextRequest } from "next/server";
import { securityHeaders } from "@/server/security/headers";
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

/** Attach the security headers to an already-created response. */
function withSecurityHeaders(response: NextResponse): NextResponse {
  for (const { key, value } of securityHeaders()) {
    response.headers.set(key, value);
  }
  return response;
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const isAdminArea = pathname.startsWith("/admin");
  if (isAdminArea && !isAdminPublic(pathname)) {
    const hasSession = request.cookies.has(SESSION_COOKIE);
    if (!hasSession) {
      const loginUrl = new URL("/admin/login", request.url);
      // Preserve where the admin was headed so the login flow could restore it.
      loginUrl.searchParams.set("next", pathname);
      return withSecurityHeaders(NextResponse.redirect(loginUrl));
    }
  }

  return withSecurityHeaders(NextResponse.next());
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
