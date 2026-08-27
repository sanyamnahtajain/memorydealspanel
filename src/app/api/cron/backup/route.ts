import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/server/security/cron-auth";
import { BACKUP_KEEP_DAYS, runBackup } from "@/server/services/backup";

/**
 * GET /api/cron/backup — the nightly database snapshot.
 *
 * The database tier has no backups of its own, so this is the ONLY restore
 * path that exists. It writes a gzipped archive of every durable collection
 * to a PRIVATE bucket and keeps a rolling window; see
 * src/server/services/backup.ts for what is included and why.
 *
 * Protected by CRON_SECRET exactly like the other crons, and fails closed.
 * A failure returns 500 ON PURPOSE — a backup that quietly does nothing is
 * worse than no backup, because it buys false confidence. Vercel surfaces a
 * failing cron in the dashboard.
 */

export const dynamic = "force-dynamic";

/** A full dump on a shared-CPU tier deserves room; well under Pro's ceiling. */
export const maxDuration = 300;

export async function GET(request: Request): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const result = await runBackup();
    return NextResponse.json({
      ok: true,
      key: result.key,
      bytes: result.bytes,
      keepDays: BACKUP_KEEP_DAYS,
      pruned: result.pruned.length,
      counts: result.counts,
      ranAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[cron/backup] FAILED:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Backup failed.",
      },
      { status: 500 },
    );
  }
}
