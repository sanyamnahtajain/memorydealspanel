import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import {
  ADMIN_FEED_TYPES,
  resolveResumeCursor,
  type AdminEventDTO,
  type AdminEventsPage,
} from "@/lib/admin-events";

/**
 * GET /api/admin/events?since=<cursor> — the admin panel's live feed.
 * ADMIN-ONLY. Answers in milliseconds with every staff-facing notification
 * created after `since`, plus the cursor to ask from next time.
 *
 * WHY A POLL, NOT A STREAM: this used to be a Server-Sent Events stream that
 * held a serverless function open for its full 60 s cap, every minute, for
 * every open admin tab — and the host killed it at the cap, so each of those
 * was logged as a timed-out invocation. On the usage page that was the bulk
 * of "provisioned memory" (function-seconds) and the entire timeout rate. The
 * stream itself only ever tailed this same collection on a timer, so a
 * client-side poll on the same cadence delivers the same events with the
 * function alive for a few milliseconds per tick instead of a minute.
 *
 * The cursor is the newest `createdAt` returned, bounded by
 * `resolveResumeCursor` so a stale tab resumes from at most ten minutes back
 * and a forged future value cannot skip real events.
 */

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const viewer = await resolveViewer();
  if (!isAdmin(viewer)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const since = resolveResumeCursor(request.nextUrl.searchParams.get("since"));
  let cursor = since;
  let events: AdminEventDTO[] = [];
  try {
    const rows = await prisma.notification.findMany({
      // Staff-facing types only — the same table also holds rows addressed
      // to buyers and the nudge job's dedupe bookkeeping.
      where: { createdAt: { gt: since }, type: { in: [...ADMIN_FEED_TYPES] } },
      orderBy: { createdAt: "asc" },
      take: PAGE_SIZE,
      select: { id: true, type: true, payload: true, createdAt: true },
    });
    events = rows.map((row) => {
      if (row.createdAt > cursor) cursor = row.createdAt;
      return {
        id: row.id,
        type: row.type,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        createdAt: row.createdAt.toISOString(),
      };
    });
  } catch (error) {
    // A transient DB hiccup answers empty with the SAME cursor, so the next
    // tick simply asks again — nothing is skipped and nothing is thrown at
    // the panel.
    console.error("[admin/events] poll failed:", error);
  }

  const body: AdminEventsPage = { events, cursor: cursor.toISOString() };
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
