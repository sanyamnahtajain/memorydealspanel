"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { usePromptDialog } from "@/components/ui/prompt-dialog";
import {
  StatusChip,
  EmptyState,
  ConfirmSheet,
  useIsMobile,
} from "@/components/common";
import { UserFormDialog } from "./UserFormDialog";
import {
  setUserActiveAction,
  resetUserPasswordAction,
  deleteUserAction,
} from "@/server/actions/users";
import type { UserRowData, RoleOption } from "@/app/admin/users/page";

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function UserTable({
  rows,
  roleOptions,
}: {
  rows: UserRowData[];
  roleOptions: RoleOption[];
}) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const { prompt, element: promptElement } = usePromptDialog();

  const [dialogUser, setDialogUser] = React.useState<UserRowData | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  function openCreate() {
    setDialogUser(null);
    setDialogOpen(true);
  }
  function openEdit(user: UserRowData) {
    setDialogUser(user);
    setDialogOpen(true);
  }

  async function run(
    id: string,
    label: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    setBusyId(id);
    try {
      const res = await fn();
      if (res.ok) {
        toast.success(label);
        router.refresh();
      } else {
        toast.error(res.error ?? "Something went wrong.");
      }
    } finally {
      setBusyId(null);
    }
  }

  const toggleActive = (u: UserRowData) =>
    run(u.id, u.isActive ? "User deactivated" : "User activated", () =>
      setUserActiveAction({ id: u.id, isActive: !u.isActive }),
    );

  async function resetPassword(u: UserRowData) {
    const pw = await prompt({
      title: `Reset password for ${u.name}`,
      description: "The user will sign in with this new password.",
      kind: "password",
      validate: (v) => (v.length < 8 ? "At least 8 characters." : null),
    });
    if (!pw) return;
    await run(u.id, "Password reset", () =>
      resetUserPasswordAction({ id: u.id, password: pw }),
    );
  }

  const remove = (u: UserRowData) =>
    run(u.id, "User deleted", () => deleteUserAction({ id: u.id }));

  const header = (
    <div className="flex items-center justify-end">
      <Button onClick={openCreate}>
        <Plus aria-hidden />
        New user
      </Button>
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState
          illustration="empty-box"
          title="No admin users yet"
          description="Create the first user and assign them a role."
          action={
            <Button onClick={openCreate}>
              <Plus aria-hidden />
              New user
            </Button>
          }
        />
        <UserFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          user={dialogUser}
          roleOptions={roleOptions}
          onSaved={() => router.refresh()}
        />
        {promptElement}
      </div>
    );
  }

  const rowActions = (u: UserRowData) => (
    <div className="flex items-center justify-end gap-0.5">
      <Tooltip content="Edit user">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${u.name}`}
          disabled={busyId === u.id}
          onClick={() => openEdit(u)}
        >
          <Pencil aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip content="Reset password">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Reset ${u.name}'s password`}
          disabled={busyId === u.id}
          onClick={() => resetPassword(u)}
        >
          <KeyRound aria-hidden />
        </Button>
      </Tooltip>
      {/* The last active Owner cannot be deactivated/deleted — the server also
          enforces this, but we soften the UI for it. */}
      <ConfirmSheet
        title={u.isActive ? `Deactivate ${u.name}?` : `Activate ${u.name}?`}
        description={
          u.isActive
            ? "They will no longer be able to sign in."
            : "They will be able to sign in again."
        }
        confirmLabel={u.isActive ? "Deactivate" : "Activate"}
        destructive={u.isActive}
        onConfirm={() => toggleActive(u)}
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={u.isActive ? `Deactivate ${u.name}` : `Activate ${u.name}`}
            disabled={busyId === u.id}
          >
            <ShieldCheck
              aria-hidden
              className={u.isActive ? "text-success" : "text-muted-foreground"}
            />
          </Button>
        }
      />
      <ConfirmSheet
        title={`Delete ${u.name}?`}
        description="This permanently removes the admin user and their sessions."
        confirmLabel="Delete"
        destructive
        onConfirm={() => remove(u)}
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${u.name}`}
            className="text-muted-foreground hover:text-destructive"
            disabled={busyId === u.id}
          >
            <Trash2 aria-hidden />
          </Button>
        }
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {header}

      {isMobile ? (
        <ul className="space-y-2">
          {rows.map((u) => (
            <li
              key={u.id}
              className="rounded-lg border border-border bg-card p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-medium">
                    {u.name}
                    {u.isOwner && (
                      <Badge variant="secondary" className="text-[10px]">
                        Owner
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.email}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {u.roleName ?? "No role"} · last seen {formatDate(u.lastLoginAt)}
                  </p>
                </div>
                <StatusChip variant={u.isActive ? "active" : "inactive"} />
              </div>
              <div className="mt-2 border-t border-border/60 pt-2">
                {rowActions(u)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Email</th>
                <th className="px-3 py-2 text-left font-medium">Role</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Last login</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5 font-medium">
                      {u.name}
                      {u.isOwner && (
                        <Badge variant="secondary" className="text-[10px]">
                          Owner
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {u.roleName ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip variant={u.isActive ? "active" : "inactive"} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatDate(u.lastLoginAt)}
                  </td>
                  <td className="px-3 py-2">{rowActions(u)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <UserFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        user={dialogUser}
        roleOptions={roleOptions}
        onSaved={() => router.refresh()}
      />
      {promptElement}
    </div>
  );
}
