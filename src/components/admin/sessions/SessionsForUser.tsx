import * as React from "react";

import type { SessionKind } from "@/server/services/sessions";
import {
  listSessionsForSubject,
  type SessionRecord,
} from "@/server/services/sessions";
import { SkeletonRow } from "@/components/common";
import { SessionsTable } from "./SessionsTable";
import type { SessionRowData } from "./types";

/**
 * Server component: a compact "active devices" panel for a single subject,
 * embeddable in the Users page or a customer drawer. Reads via the session
 * service (call from an already admin-guarded parent) and renders the shared
 * {@link SessionsTable} with the subject column suppressed.
 */
export async function SessionsForUser({
  kind,
  id,
  title = "Active sessions",
}: {
  kind: SessionKind;
  id: string;
  title?: string;
}) {
  const sessions = await listSessionsForSubject(kind, id);
  const rows = sessions.map(toRow);
  const activeCount = rows.filter((r) => !r.revoked).length;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {activeCount} active
        </span>
      </div>
      <SessionsTable
        rows={rows}
        showSubject={false}
        emptyTitle="No sessions"
        emptyDescription="This account has no sign-in history yet."
      />
    </section>
  );
}

/** Loading fallback for a `<Suspense>`-wrapped {@link SessionsForUser}. */
export function SessionsForUserSkeleton() {
  return (
    <section className="space-y-3">
      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </section>
  );
}

/** Serialise a {@link SessionRecord} for the client table. */
export function toRow(s: SessionRecord): SessionRowData {
  return {
    id: s.id,
    kind: s.kind,
    subjectId: s.subjectId,
    subjectName: s.subjectName,
    subjectDetail: s.subjectDetail,
    ipAddress: s.ipAddress,
    device: s.device,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    revoked: s.revoked,
    revokedAt: s.revokedAt ? s.revokedAt.toISOString() : null,
  };
}
