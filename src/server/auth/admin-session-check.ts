import { createHash } from "node:crypto";

import { prisma } from "@/server/db";
import { swrCached } from "@/server/cache/swr";

/**
 * Cheap, bounded "is this admin session still alive?" for the PROXY.
 *
 * WHY: the proxy only checked that a session COOKIE EXISTED. An admin whose
 * 24-hour session had expired (every morning, in practice) sailed through to
 * the page, which streamed the loading skeleton first and sent the redirect
 * to the login screen INSIDE the RSC payload — a redirect that only runs once
 * client JavaScript is up. Any hiccup in hydration left them staring at a
 * skeleton titled "Dashboard" with no way forward. A real HTTP 307 from the
 * proxy needs nothing from the client.
 *
 * Bounded like every other proxy read: served stale-while-revalidate per
 * token, one lookup in flight at a time, and a cold lookup that exceeds the
 * budget answers "unknown" so the request passes through to the page's own
 * authoritative check. The proxy must never be able to hang or lock anyone
 * out — it is a fast path, not the gate.
 *
 * Never trusts the answer for anything but redirecting: the page still runs
 * `resolveViewer` and decides for itself.
 */

export type AdminSessionVerdict = "live" | "dead" | "unknown";

const TTL_MS = 30_000;
const BUDGET_MS = 1_500;

export async function checkAdminSession(
  token: string,
): Promise<AdminSessionVerdict> {
  if (!token) return "dead";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return swrCached<AdminSessionVerdict>(
    `admin-session:${tokenHash}`,
    async () => {
      const row = await prisma.session.findUnique({
        where: { tokenHash },
        select: { adminId: true, revokedAt: true, expiresAt: true },
      });
      if (!row) return "dead";
      // A CUSTOMER cookie on an admin URL is not this check's business — the
      // page rejects it with its own message. Only a genuinely expired or
      // revoked ADMIN session gets the shortcut to the login screen.
      if (row.adminId === null) return "unknown";
      if (row.revokedAt !== null) return "dead";
      if (row.expiresAt.getTime() <= Date.now()) return "dead";
      return "live";
    },
    {
      ttlMs: TTL_MS,
      coldBudgetMs: BUDGET_MS,
      fallback: "unknown",
      label: "admin session check",
    },
  );
}
