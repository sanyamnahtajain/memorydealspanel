/**
 * Edge-safe session cookie constants.
 *
 * This module is deliberately dependency-free: it imports NOTHING (no Prisma,
 * no `node:crypto`, no `next/headers`). It exists so that code running in the
 * Edge runtime — most importantly `src/middleware.ts` — can learn the session
 * cookie's NAME without transitively dragging in the Node-only session machinery
 * (`src/server/auth/session.ts` -> `src/server/db.ts` (Prisma) + `node:crypto`).
 *
 * Prisma's MongoDB provider ships no wasm query engine and `node:crypto` is not
 * available in the Edge runtime, so importing `session.ts` from middleware makes
 * the middleware bundle fail to compile and 500s every route. Keeping the cookie
 * name here — and having `session.ts` re-export it from this module — means there
 * is a single source of truth for the name that is safe to import from anywhere.
 */

/** Cookie name for the opaque, httpOnly session token. */
export const SESSION_COOKIE = "md_session";
