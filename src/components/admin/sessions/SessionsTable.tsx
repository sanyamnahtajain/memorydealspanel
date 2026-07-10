"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import {
  StatusChip,
  EmptyState,
  ConfirmSheet,
  useIsMobile,
} from "@/components/common";
import { relativeTime } from "@/lib/audit-format";
import {
  revokeSessionAction,
  revokeAllForSubjectAction,
} from "@/server/actions/sessions";
import { DeviceIcon } from "./DeviceIcon";
import type { SessionRowData } from "./types";

/* --------------------------------------------------------------------- */
/* Formatting helpers                                                    */
/* --------------------------------------------------------------------- */

function fmtRelative(iso: string): string {
  return relativeTime(iso) || "—";
}

function fmtAbsolute(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Active | Revoked | Expired chip for a session row. */
function statusFor(row: SessionRowData): {
  variant: "active" | "blocked" | "expired";
  label: string;
} {
  if (row.revokedAt) return { variant: "blocked", label: "Signed out" };
  if (row.revoked) return { variant: "expired", label: "Expired" };
  return { variant: "active", label: "Active" };
}

/* --------------------------------------------------------------------- */
/* Shared action hook                                                    */
/* --------------------------------------------------------------------- */

function useSessionActions() {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const revokeOne = React.useCallback(
    async (row: SessionRowData) => {
      setBusyId(row.id);
      try {
        const res = await revokeSessionAction({ id: row.id });
        if (res.ok) {
          toast.success(`Signed out ${row.subjectName}'s session`);
          router.refresh();
        } else {
          toast.error(res.error);
        }
      } finally {
        setBusyId(null);
      }
    },
    [router],
  );

  const revokeAll = React.useCallback(
    async (row: SessionRowData) => {
      setBusyId(`all:${row.subjectId}`);
      try {
        const res = await revokeAllForSubjectAction({
          kind: row.kind,
          id: row.subjectId,
        });
        if (res.ok) {
          toast.success(
            res.count && res.count > 0
              ? `Signed out ${res.count} session${res.count === 1 ? "" : "s"} for ${row.subjectName}`
              : `No active sessions for ${row.subjectName}`,
          );
          router.refresh();
        } else {
          toast.error(res.error);
        }
      } finally {
        setBusyId(null);
      }
    },
    [router],
  );

  return { busyId, revokeOne, revokeAll };
}

/* --------------------------------------------------------------------- */
/* Row action affordances                                                */
/* --------------------------------------------------------------------- */

function RowActions({
  row,
  busyId,
  onRevokeOne,
  onRevokeAll,
}: {
  row: SessionRowData;
  busyId: string | null;
  onRevokeOne: (row: SessionRowData) => void;
  onRevokeAll: (row: SessionRowData) => void;
}) {
  const rowBusy = busyId === row.id;
  const allBusy = busyId === `all:${row.subjectId}`;

  return (
    <div className="flex items-center justify-end gap-0.5">
      {!row.revoked ? (
        <ConfirmSheet
          title={`Sign out this session?`}
          description={`${row.subjectName}'s ${row.device.label} session will be signed out immediately.`}
          confirmLabel="Sign out"
          destructive
          onConfirm={() => onRevokeOne(row)}
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Sign out ${row.subjectName}'s ${row.device.label} session`}
              disabled={rowBusy}
            >
              <LogOut aria-hidden />
            </Button>
          }
        />
      ) : null}
      <ConfirmSheet
        title={`Sign out all of ${row.subjectName}'s devices?`}
        description="Every active session for this account will be signed out. They will need to sign in again."
        confirmLabel="Sign out all"
        destructive
        onConfirm={() => onRevokeAll(row)}
        trigger={
          <Tooltip content="Sign out all devices">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Sign out all of ${row.subjectName}'s devices`}
              className="text-muted-foreground hover:text-destructive"
              disabled={allBusy}
            >
              <Users aria-hidden />
            </Button>
          </Tooltip>
        }
      />
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* Table                                                                 */
/* --------------------------------------------------------------------- */

export interface SessionsTableProps {
  rows: SessionRowData[];
  /** Whether the subject (Admin/Customer) column is shown. @default true */
  showSubject?: boolean;
  /** Copy for the empty state. */
  emptyTitle?: string;
  emptyDescription?: string;
}

/**
 * Responsive session listing: a semantic table on desktop, stacked cards on
 * mobile. Each row shows device, IP, last-seen, and status, with a "Sign out"
 * (revoke) affordance and a "Sign out all devices" for the subject — both
 * behind a ConfirmSheet.
 */
export function SessionsTable({
  rows,
  showSubject = true,
  emptyTitle = "No sessions",
  emptyDescription = "Sessions appear here once users sign in.",
}: SessionsTableProps) {
  const isMobile = useIsMobile();
  const { busyId, revokeOne, revokeAll } = useSessionActions();

  if (rows.length === 0) {
    return (
      <EmptyState
        illustration="empty-box"
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  if (isMobile) {
    return (
      <ul className="space-y-2">
        {rows.map((row) => {
          const status = statusFor(row);
          return (
            <li
              key={row.id}
              className="rounded-lg border border-border bg-card p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2.5">
                  <DeviceIcon
                    device={row.device.device}
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground [&_svg]:size-5"
                  />
                  <div className="min-w-0">
                    {showSubject ? (
                      <p className="truncate font-medium">{row.subjectName}</p>
                    ) : null}
                    <p
                      className={
                        showSubject
                          ? "truncate text-xs text-muted-foreground"
                          : "truncate font-medium"
                      }
                    >
                      {row.device.label}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {row.ipAddress ?? "—"} · seen {fmtRelative(row.lastSeenAt)}
                    </p>
                  </div>
                </div>
                <StatusChip variant={status.variant} label={status.label} />
              </div>
              <div className="mt-2 border-t border-border/60 pt-2">
                <RowActions
                  row={row}
                  busyId={busyId}
                  onRevokeOne={revokeOne}
                  onRevokeAll={revokeAll}
                />
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table>
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            {showSubject ? (
              <th className="px-3 py-2 text-left font-medium">Account</th>
            ) : null}
            <th className="px-3 py-2 text-left font-medium">Device</th>
            <th className="px-3 py-2 text-left font-medium">IP address</th>
            <th className="px-3 py-2 text-left font-medium">Last seen</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = statusFor(row);
            return (
              <tr key={row.id} className="border-t border-border">
                {showSubject ? (
                  <td className="px-3 py-2">
                    <span className="block font-medium">{row.subjectName}</span>
                    {row.subjectDetail ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.subjectDetail}
                      </span>
                    ) : null}
                  </td>
                ) : null}
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <DeviceIcon
                      device={row.device.device}
                      className="size-4 shrink-0 text-muted-foreground [&_svg]:size-4"
                    />
                    <span>{row.device.label}</span>
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground tabular-nums">
                  {row.ipAddress ?? "—"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  <Tooltip content={fmtAbsolute(row.lastSeenAt)}>
                    <span className="tabular-nums">
                      {fmtRelative(row.lastSeenAt)}
                    </span>
                  </Tooltip>
                </td>
                <td className="px-3 py-2">
                  <StatusChip variant={status.variant} label={status.label} />
                </td>
                <td className="px-3 py-2">
                  <RowActions
                    row={row}
                    busyId={busyId}
                    onRevokeOne={revokeOne}
                    onRevokeAll={revokeAll}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
