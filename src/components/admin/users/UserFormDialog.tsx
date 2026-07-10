"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/components/common";
import { createUserAction, updateUserAction } from "@/server/actions/users";
import type { RoleOption, UserRowData } from "@/app/admin/users/page";

/** Sentinel Select value for "no role assigned" (empty string is reserved). */
const NO_ROLE = "__none__";

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The user being edited, or `null` for a create dialog. */
  user: UserRowData | null;
  roleOptions: RoleOption[];
  /** Called after a successful create/update so the caller can refresh. */
  onSaved: () => void;
}

interface FormBodyProps extends Omit<UserFormDialogProps, "open"> {
  footer: (buttons: {
    submit: React.ReactNode;
    cancel: React.ReactNode;
  }) => React.ReactNode;
}

function isValidEmail(value: string): boolean {
  // Light client-side check; the server zod schema is authoritative.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function FormBody({
  onOpenChange,
  user,
  roleOptions,
  onSaved,
  footer,
}: FormBodyProps) {
  const isEdit = user !== null;
  const [name, setName] = React.useState(user?.name ?? "");
  const [email, setEmail] = React.useState(user?.email ?? "");
  const [password, setPassword] = React.useState("");
  const [roleId, setRoleId] = React.useState<string>(
    user?.roleId ?? NO_ROLE,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const nameId = React.useId();
  const emailId = React.useId();
  const passwordId = React.useId();
  const roleLabelId = React.useId();

  // value→label map so the Select trigger shows the role NAME (not its id).
  const roleItems = React.useMemo(
    () => [
      { value: NO_ROLE, label: "No role (no access)" },
      ...roleOptions.map((r) => ({ value: r.id, label: r.name })),
    ],
    [roleOptions],
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    if (!name.trim()) {
      setError("Enter a name.");
      return;
    }
    if (!isValidEmail(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    if (!isEdit && password.length < 8) {
      setError("Temporary password must be at least 8 characters.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const resolvedRoleId = roleId === NO_ROLE ? null : roleId;
      const res = isEdit
        ? await updateUserAction({
            id: user.id,
            name: name.trim(),
            email: email.trim(),
            roleId: resolvedRoleId,
          })
        : await createUserAction({
            name: name.trim(),
            email: email.trim(),
            password,
            roleId: resolvedRoleId,
          });

      if (res.ok) {
        toast.success(isEdit ? "User updated" : "User created");
        onSaved();
        onOpenChange(false);
      } else {
        setError(res.error);
        toast.error(res.error);
      }
    } catch {
      const message = "Something went wrong. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const submit = (
    <Button
      type="submit"
      disabled={saving}
      data-loading={saving || undefined}
    >
      {saving ? <Spinner size="xs" label="" aria-hidden /> : null}
      {isEdit ? "Save changes" : "Create user"}
    </Button>
  );

  const cancel = (
    <Button
      type="button"
      variant="outline"
      disabled={saving}
      onClick={() => onOpenChange(false)}
    >
      Cancel
    </Button>
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jane Doe"
          autoComplete="off"
          disabled={saving}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId}>Email</Label>
        <Input
          id={emailId}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jane@company.com"
          autoComplete="off"
          disabled={saving}
        />
      </div>

      {!isEdit ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={passwordId}>Temporary password</Label>
          <Input
            id={passwordId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            Share this with the user; they can change it after signing in.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span id={roleLabelId} className="text-sm font-medium">
          Role
        </span>
        <Select
          value={roleId}
          onValueChange={(next) => setRoleId((next as string | null) ?? NO_ROLE)}
          items={roleItems}
          disabled={saving}
        >
          <SelectTrigger aria-labelledby={roleLabelId} className="w-full">
            <SelectValue placeholder="Select a role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_ROLE}>No role (no access)</SelectItem>
            {roleOptions.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The role decides which admin areas this user can reach.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {footer({ submit, cancel })}
    </form>
  );
}

/**
 * Create/edit dialog for an admin user. Renders a centered Dialog on desktop
 * and a bottom Sheet on mobile. Create mode collects a temp password; edit mode
 * omits it (use the row's "Reset password" action instead). Role assignment
 * uses the custom Select.
 */
export function UserFormDialog({
  open,
  onOpenChange,
  user,
  roleOptions,
  onSaved,
}: UserFormDialogProps) {
  const isMobile = useIsMobile();
  const isEdit = user !== null;
  const title = isEdit ? "Edit user" : "New user";
  const description = isEdit
    ? "Update this admin's name, email, and role."
    : "Invite a new admin and assign their role.";

  // Remount the body when the target/open changes so its local state resets.
  const bodyKey = `${open}:${user?.id ?? "new"}`;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="rounded-t-2xl pb-safe"
        >
          <div
            aria-hidden
            className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted"
          />
          <SheetHeader className="pb-0">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-2">
            <FormBody
              key={bodyKey}
              onOpenChange={onOpenChange}
              user={user}
              roleOptions={roleOptions}
              onSaved={onSaved}
              footer={({ submit, cancel }) => (
                <SheetFooter className="px-0 pt-1">
                  {submit}
                  {cancel}
                </SheetFooter>
              )}
            />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <FormBody
          key={bodyKey}
          onOpenChange={onOpenChange}
          user={user}
          roleOptions={roleOptions}
          onSaved={onSaved}
          footer={({ submit, cancel }) => (
            <DialogFooter>
              {cancel}
              {submit}
            </DialogFooter>
          )}
        />
      </DialogContent>
    </Dialog>
  );
}
