import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import {
  ADMIN_FEED_TYPES,
  ADMIN_EVENT_NAME,
  ADMIN_EVENTS_HEARTBEAT_MS,
  ADMIN_EVENTS_POLL_MS,
  resolveResumeCursor,
  type AdminEventDTO,
} from "@/lib/admin-events";

/**
 * GET /api/admin/events — a Server-Sent Events stream of admin notifications
 * (the "socket" for the open admin panel). ADMIN-ONLY.
 *
 * Design: SSE over a short-interval tail of the existing `Notification`
 * collection. Deliberately NOT a WebSocket/socket.io dependency — SSE is
 * plain HTTP (works through nginx and any Node host unchanged), reconnects
 * natively in the browser, and the collection is already written by every
 * event source (orders, access requests), so new event types stream with
 * zero changes here. Background delivery stays with Web Push; this stream is
 * for the live toast + ring while the panel is open.
 */

export const dynamic = "force-dynamic";

/**
 * Keep each stream alive longer than the default so reconnects stay rare.
 *
 * Deliberately 60, not higher: Vercel caps this PER PLAN and a value above the
 * cap fails the deployment outright. 60s is accepted on every plan, so this
 * cannot break a deploy. A shorter-lived stream only means more reconnects,
 * and the Last-Event-ID resume below now makes those lossless anyway.
 */
export const maxDuration = 60;

const encoder = new TextEncoder();

export async function GET(request: Request): Promise<Response> {
  const viewer = await resolveViewer();
  if (!isAdmin(viewer)) {
    return new Response("Admin access required.", { status: 403 });
  }

  /**
   * RESUME WHERE WE LEFT OFF — do not "simplify" this back to `new Date()`.
   *
   * This stream does not live forever: a serverless host kills it at the
   * function's max duration, and any network blip drops it too. The browser
   * then reconnects (see the `retry:` hint below), which used to restart the
   * cursor at the moment of reconnect — so every notification created during
   * the gap was skipped for good. No toast, no ring, and no `router.refresh()`,
   * so a new access request simply did not appear until an admin reloaded the
   * page by hand. That is the "requests take time to show up" complaint.
   *
   * EventSource replays the last `id:` we sent as the `Last-Event-ID` header on
   * reconnect, so we resume from exactly there and the gap closes.
   */
  // The browser sends `last-event-id` only on its OWN automatic reconnects.
  // The client also closes this stream while the tab is hidden (it is the
  // app's biggest function-hours consumer) and reopens a FRESH EventSource on
  // return — which sends no header — so the cursor is accepted as a query
  // param too. Same 10-minute bound either way; nothing is lost on resume.
  const cursorStart = resolveResumeCursor(
    request.headers.get("last-event-id") ??
      new URL(request.url).searchParams.get("lastEventId"),
  );
  let cursor = cursorStart;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // Reconnect hint for the browser's native EventSource retry.
      send("retry: 5000\n\n");

      const poll = setInterval(() => {
        void (async () => {
          try {
            const rows = await prisma.notification.findMany({
              // Staff-facing types only — the same table also holds rows
              // addressed to buyers and the nudge job's dedupe bookkeeping.
              where: {
                createdAt: { gt: cursor },
                type: { in: [...ADMIN_FEED_TYPES] },
              },
              orderBy: { createdAt: "asc" },
              take: 50,
              select: { id: true, type: true, payload: true, createdAt: true },
            });
            for (const row of rows) {
              cursor = row.createdAt > cursor ? row.createdAt : cursor;
              const dto: AdminEventDTO = {
                id: row.id,
                type: row.type,
                payload: (row.payload ?? {}) as Record<string, unknown>,
                createdAt: row.createdAt.toISOString(),
              };
              // The id IS the cursor: `createdAt`, which is what we resume
              // from. EventSource echoes the most recent one back to us as
              // Last-Event-ID after a drop.
              send(
                `id: ${dto.createdAt}\n` +
                  `event: ${ADMIN_EVENT_NAME}\n` +
                  `data: ${JSON.stringify(dto)}\n\n`,
              );
            }
          } catch {
            // Transient DB hiccup — the next tick retries; never kill the stream.
          }
        })();
      }, ADMIN_EVENTS_POLL_MS);

      const heartbeat = setInterval(() => send(": ping\n\n"), ADMIN_EVENTS_HEARTBEAT_MS);

      const cleanup = () => {
        closed = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // nginx: never buffer the stream
    },
  });
}
