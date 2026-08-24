import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import {
  ADMIN_EVENT_NAME,
  ADMIN_EVENTS_HEARTBEAT_MS,
  ADMIN_EVENTS_POLL_MS,
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

const encoder = new TextEncoder();

export async function GET(request: Request): Promise<Response> {
  const viewer = await resolveViewer();
  if (!isAdmin(viewer)) {
    return new Response("Admin access required.", { status: 403 });
  }

  // Only events that happen AFTER connect — history lives in the bell.
  let cursor = new Date();
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
              where: { createdAt: { gt: cursor } },
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
              send(`event: ${ADMIN_EVENT_NAME}\ndata: ${JSON.stringify(dto)}\n\n`);
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
