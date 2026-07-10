"use client";

import * as React from "react";
import { ChevronDownIcon, Loader2Icon, LockIcon, ShieldCheckIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  type Permission,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { springs } from "@/components/motion/tokens";
import {
  createRoleAction,
  updateRoleAction,
} from "@/server/actions/roles";
import { PermissionCheckbox } from "./PermissionCheckbox";

/** The shape the editor needs about a role. `null` id => create mode. */
export interface RoleEditorTarget {
  id: string | null;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
}

interface RoleEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The role being edited, or a blank target for creation. */
  target: RoleEditorTarget;
}

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

/**
 * Role editor with the permission matrix.
 *
 * Renders {@link PERMISSION_GROUPS} as collapsible sections, each with a
 * "select all in group" tri-state control and individually toggleable, custom
 * token-styled checkboxes. Name + description live above the matrix, with a
 * live count of selected permissions. System (Owner) roles render fully
 * read-only with an explanatory banner — their "*" wildcard is never editable.
 * Group expand/collapse is animated (respecting reduced-motion).
 */
export function RoleEditor({ open, onOpenChange, target }: RoleEditorProps) {
  const reduced = useReducedMotion();
  const isCreate = target.id === null;
  const readOnly = target.isSystem;

  const [name, setName] = React.useState(target.name);
  const [description, setDescription] = React.useState(target.description ?? "");
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(target.permissions.filter((p) => PERMISSION_SET.has(p))),
  );
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(PERMISSION_GROUPS.map((g) => g.key)),
  );
  const [pending, startTransition] = React.useTransition();

  // Re-seed local state whenever a different target is opened.
  const [syncedKey, setSyncedKey] = React.useState<string | null>(null);
  const targetKey = `${target.id ?? "new"}:${open}`;
  if (open && syncedKey !== targetKey) {
    setSyncedKey(targetKey);
    setName(target.name);
    setDescription(target.description ?? "");
    setSelected(new Set(target.permissions.filter((p) => PERMISSION_SET.has(p))));
    setExpanded(new Set(PERMISSION_GROUPS.map((g) => g.key)));
  }

  const togglePermission = React.useCallback(
    (key: Permission, next: boolean) => {
      setSelected((prev) => {
        const draft = new Set(prev);
        if (next) draft.add(key);
        else draft.delete(key);
        return draft;
      });
    },
    [],
  );

  const toggleGroup = React.useCallback(
    (keys: Permission[], next: boolean) => {
      setSelected((prev) => {
        const draft = new Set(prev);
        for (const key of keys) {
          if (next) draft.add(key);
          else draft.delete(key);
        }
        return draft;
      });
    },
    [],
  );

  const toggleExpanded = React.useCallback((groupKey: string) => {
    setExpanded((prev) => {
      const draft = new Set(prev);
      if (draft.has(groupKey)) draft.delete(groupKey);
      else draft.add(groupKey);
      return draft;
    });
  }, []);

  const selectedCount = selected.size;

  const handleSave = React.useCallback(() => {
    if (readOnly) return;
    const permissions = ALL_PERMISSIONS.filter((p) => selected.has(p));
    startTransition(async () => {
      const trimmedName = name.trim();
      const trimmedDescription = description.trim();
      const result = isCreate
        ? await createRoleAction({
            name: trimmedName,
            description: trimmedDescription || null,
            permissions,
          })
        : await updateRoleAction({
            id: target.id,
            name: trimmedName,
            description: trimmedDescription || null,
            permissions,
          });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(isCreate ? "Role created." : "Role updated.");
      onOpenChange(false);
    });
  }, [
    readOnly,
    selected,
    name,
    description,
    isCreate,
    target.id,
    onOpenChange,
  ]);

  const canSave =
    !readOnly && !pending && name.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={!pending}
        className="flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogHeader className="gap-1 border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            {readOnly ? (
              <ShieldCheckIcon className="size-4 text-primary" aria-hidden />
            ) : null}
            {isCreate
              ? "New role"
              : readOnly
                ? target.name
                : `Edit ${target.name}`}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? "This is a built-in system role. Its permissions are fixed and cannot be changed."
              : "Name the role and choose exactly what it can do. Users inherit these permissions."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
          {readOnly ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                System roles always retain full access and are protected from
                edits and deletion. To grant tailored access, create a new role
                instead.
              </p>
            </div>
          ) : null}

          {/* Identity fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Catalog Manager"
                disabled={readOnly || pending}
                maxLength={60}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-description">
                Description
                <span className="ml-1 font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="role-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this role is for"
                disabled={readOnly || pending}
                maxLength={200}
                autoComplete="off"
              />
            </div>
          </div>

          {/* Permission matrix */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">
                Permissions
              </h3>
              <span
                className="text-xs font-medium tabular-nums text-muted-foreground"
                aria-live="polite"
              >
                {readOnly
                  ? "All permissions"
                  : `${selectedCount} of ${ALL_PERMISSIONS.length} selected`}
              </span>
            </div>

            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {PERMISSION_GROUPS.map((group) => {
                const keys = group.permissions.map((p) => p.key);
                const selectedInGroup = keys.filter(
                  (k) => readOnly || selected.has(k),
                ).length;
                const allSelected = selectedInGroup === keys.length;
                const someSelected =
                  selectedInGroup > 0 && !allSelected;
                const isOpen = expanded.has(group.key);

                return (
                  <div key={group.key}>
                    {/* Group header row */}
                    <div className="flex items-center gap-3 bg-muted/30 px-3 py-2.5">
                      <PermissionCheckbox
                        checked={readOnly || allSelected}
                        indeterminate={someSelected}
                        disabled={readOnly || pending}
                        aria-label={`Select all ${group.label} permissions`}
                        onChange={(next) => toggleGroup(keys, next)}
                      />
                      <button
                        type="button"
                        onClick={() => toggleExpanded(group.key)}
                        aria-expanded={isOpen}
                        className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {group.label}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {readOnly
                              ? `${keys.length} permissions`
                              : `${selectedInGroup} of ${keys.length}`}
                          </span>
                        </span>
                        <ChevronDownIcon
                          className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform",
                            isOpen && "rotate-180",
                          )}
                          aria-hidden
                        />
                      </button>
                    </div>

                    {/* Group body — animated expand/collapse */}
                    <AnimatePresence initial={false}>
                      {isOpen ? (
                        <motion.div
                          key="body"
                          initial={reduced ? false : { height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                          transition={reduced ? { duration: 0 } : springs.gentle}
                          className="overflow-hidden"
                        >
                          <ul className="divide-y divide-border/60">
                            {group.permissions.map((permission) => {
                              const isChecked =
                                readOnly || selected.has(permission.key);
                              const inputId = `perm-${permission.key}`;
                              const descId = `${inputId}-desc`;
                              return (
                                <li
                                  key={permission.key}
                                  className="flex items-start gap-3 px-3 py-2.5 pl-6"
                                >
                                  <span className="mt-0.5">
                                    <PermissionCheckbox
                                      id={inputId}
                                      checked={isChecked}
                                      disabled={readOnly || pending}
                                      aria-describedby={descId}
                                      onChange={(next) =>
                                        togglePermission(permission.key, next)
                                      }
                                    />
                                  </span>
                                  <label
                                    htmlFor={inputId}
                                    className={cn(
                                      "min-w-0 flex-1 select-none",
                                      readOnly
                                        ? "cursor-default"
                                        : "cursor-pointer",
                                    )}
                                  >
                                    <span className="block text-sm font-medium text-foreground">
                                      {permission.label}
                                    </span>
                                    <span
                                      id={descId}
                                      className="block text-xs text-muted-foreground"
                                    >
                                      {permission.description}
                                    </span>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {readOnly ? null : (
            <Button onClick={handleSave} disabled={!canSave}>
              {pending ? (
                <Loader2Icon className="animate-spin" aria-hidden />
              ) : null}
              {isCreate ? "Create role" : "Save changes"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
