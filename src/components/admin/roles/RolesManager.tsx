"use client";

import * as React from "react";
import {
  KeyRoundIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import { ALL_PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ConfirmSheet, EmptyState } from "@/components/common";
import { springs } from "@/components/motion/tokens";
import { deleteRoleAction } from "@/server/actions/roles";
import { RoleEditor, type RoleEditorTarget } from "./RoleEditor";

/** A role row as delivered by the page (server component). */
export interface RoleListItem {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  userCount: number;
}

interface RolesManagerProps {
  roles: RoleListItem[];
}

const BLANK_TARGET: RoleEditorTarget = {
  id: null,
  name: "",
  description: null,
  permissions: [],
  isSystem: false,
};

/**
 * Client roles manager: renders each role as a card (name, description,
 * permission count, user count, System badge) with edit / delete actions.
 * System roles are locked — their actions are disabled with an explanatory
 * tooltip. Creating and editing both open the {@link RoleEditor} matrix.
 */
export function RolesManager({ roles }: RolesManagerProps) {
  const reduced = useReducedMotion();
  const [editor, setEditor] = React.useState<RoleEditorTarget | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<RoleListItem | null>(
    null,
  );

  const openCreate = React.useCallback(() => {
    setEditor(BLANK_TARGET);
  }, []);

  const openEdit = React.useCallback((role: RoleListItem) => {
    setEditor({
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      isSystem: role.isSystem,
    });
  }, []);

  const confirmDelete = React.useCallback(async () => {
    if (!pendingDelete) return;
    const result = await deleteRoleAction({ id: pendingDelete.id });
    if (!result.ok) {
      toast.error(result.error);
      // Keep the sheet open by re-throwing so ConfirmSheet doesn't close.
      throw new Error(result.error);
    }
    toast.success("Role deleted.");
    setPendingDelete(null);
  }, [pendingDelete]);

  const isEmpty = roles.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {roles.length} {roles.length === 1 ? "role" : "roles"}
        </p>
        <Button onClick={openCreate}>
          <PlusIcon aria-hidden />
          New role
        </Button>
      </div>

      {isEmpty ? (
        <EmptyState
          illustration="locked"
          title="No roles yet"
          description="Create a role to define exactly what a group of users can do."
          action={
            <Button onClick={openCreate}>
              <PlusIcon aria-hidden />
              New role
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          <AnimatePresence initial={false}>
            {roles.map((role) => (
              <motion.li
                key={role.id}
                layout={reduced ? false : true}
                transition={reduced ? { duration: 0 } : springs.gentle}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
              >
                <RoleCard
                  role={role}
                  onEdit={() => openEdit(role)}
                  onDelete={() => setPendingDelete(role)}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {editor ? (
        <RoleEditor
          open={editor !== null}
          onOpenChange={(next) => {
            if (!next) setEditor(null);
          }}
          target={editor}
        />
      ) : null}

      <ConfirmSheet
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title={`Delete ${pendingDelete?.name ?? "role"}?`}
        description="This permanently removes the role. Users must be reassigned first."
        confirmLabel="Delete role"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function RoleCard({
  role,
  onEdit,
  onDelete,
}: {
  role: RoleListItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const permissionCount = role.isSystem
    ? ALL_PERMISSIONS.length
    : role.permissions.length;
  const systemLockReason =
    "System roles are built in — they can't be edited or deleted.";
  const inUseReason =
    role.userCount > 0
      ? `Reassign ${role.userCount} user${role.userCount === 1 ? "" : "s"} before deleting.`
      : undefined;

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4 text-card-foreground shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              role.isSystem
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            {role.isSystem ? (
              <ShieldCheckIcon className="size-4.5" aria-hidden />
            ) : (
              <KeyRoundIcon className="size-4.5" aria-hidden />
            )}
          </span>
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-heading text-base font-semibold tracking-tight">
                {role.name}
              </h2>
              {role.isSystem ? (
                <Badge variant="secondary" className="gap-1">
                  <LockIcon aria-hidden />
                  System
                </Badge>
              ) : null}
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {role.description ?? "No description."}
            </p>
          </div>
        </div>
      </div>

      <dl className="mt-4 flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <KeyRoundIcon className="size-4" aria-hidden />
          <dd className="font-medium tabular-nums text-foreground">
            {permissionCount}
          </dd>
          <dt>{permissionCount === 1 ? "permission" : "permissions"}</dt>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <UsersIcon className="size-4" aria-hidden />
          <dd className="font-medium tabular-nums text-foreground">
            {role.userCount}
          </dd>
          <dt>{role.userCount === 1 ? "user" : "users"}</dt>
        </div>
      </dl>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border/70 pt-3">
        {role.isSystem ? (
          <Tooltip content={systemLockReason}>
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <ShieldCheckIcon aria-hidden />
              View
            </Button>
          </Tooltip>
        ) : (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <PencilIcon aria-hidden />
            Edit
          </Button>
        )}

        {role.isSystem ? (
          <Tooltip content={systemLockReason}>
            {/* Wrapper span so the tooltip anchors a disabled control. */}
            <span className="inline-flex">
              <Button variant="ghost" size="sm" disabled>
                <Trash2Icon aria-hidden />
                Delete
              </Button>
            </span>
          </Tooltip>
        ) : inUseReason ? (
          <Tooltip content={inUseReason}>
            <span className="inline-flex">
              <Button variant="ghost" size="sm" disabled>
                <Trash2Icon aria-hidden />
                Delete
              </Button>
            </span>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2Icon aria-hidden />
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
