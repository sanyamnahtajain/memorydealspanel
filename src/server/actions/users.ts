"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { PERMISSIONS } from "@/lib/permissions";
import { objectIdSchema } from "@/lib/schemas/shared";
import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { assertPermission, ForbiddenError } from "@/server/auth/permissions";
import { writeAudit } from "@/server/security/audit";
import {
  createUser,
  deleteUser,
  resetUserPassword,
  setUserActive,
  updateUser,
  DuplicateEmailError,
  LastOwnerError,
  type UserRecord,
} from "@/server/services/users";

/**
 * "use server" action wrappers for admin-user (RBAC) management.
 *
 * Every mutating action:
 *   1. resolves the viewer and enforces `users.manage` (Owner "*" passes) —
 *      never throws raw across the client boundary,
 *   2. validates input with zod,
 *   3. delegates to the service layer,
 *   4. writes an audit entry and revalidates /admin/users.
 *
 * Passwords never cross back to the client. The service hashes them; results
 * carry only the safe {@link UserRecord} projection.
 */

const USERS_PATH = "/admin/users";

export type ActionResult<T = void> = [T] extends [void]
  ? { ok: true } | { ok: false; error: string }
  : { ok: true; data: T } | { ok: false; error: string };

/** Resolves the current admin id after enforcing `users.manage`. */
async function requireUsersManage(): Promise<
  { ok: true; adminId: string } | { ok: false; error: string }
> {
  const viewer = await resolveViewer();
  if (!isAdmin(viewer)) {
    return { ok: false, error: "You must be signed in as an admin." };
  }
  try {
    assertPermission(viewer, PERMISSIONS.USERS_MANAGE);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You are not authorised to manage users." };
    }
    throw error;
  }
  return { ok: true, adminId: viewer.adminId };
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Formats the first zod issue into a human-readable message. */
function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

/**
 * Maps a thrown service error to a user-facing message. LastOwnerError and
 * DuplicateEmailError carry safe, specific copy; anything else is generic.
 */
function messageFor(error: unknown, fallback: string): string {
  if (error instanceof LastOwnerError || error instanceof DuplicateEmailError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

/* --------------------------------------------------------------------- */
/* Schemas                                                               */
/* --------------------------------------------------------------------- */

const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(120, "Name is too long.");

const emailSchema = z
  .email("Enter a valid email address.")
  .max(200, "Email is too long.");

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be at most 72 characters.");

/** Empty string / undefined => no role assigned. */
const roleIdSchema = z
  .union([objectIdSchema, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

const createSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  roleId: roleIdSchema,
});

const updateSchema = z.object({
  id: objectIdSchema,
  name: nameSchema.optional(),
  email: emailSchema.optional(),
  roleId: roleIdSchema,
  isActive: z.boolean().optional(),
});

const setActiveSchema = z.object({
  id: objectIdSchema,
  isActive: z.boolean(),
});

const resetPasswordSchema = z.object({
  id: objectIdSchema,
  password: passwordSchema,
});

const deleteSchema = z.object({ id: objectIdSchema });

/* --------------------------------------------------------------------- */
/* Create                                                                */
/* --------------------------------------------------------------------- */

export async function createUserAction(
  input: unknown,
): Promise<ActionResult<UserRecord>> {
  const auth = await requireUsersManage();
  if (!auth.ok) return auth;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  try {
    const user = await createUser({
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      roleId: parsed.data.roleId,
    });

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "user.create",
      entity: "Admin",
      entityId: user.id,
      diff: { name: user.name, email: user.email, roleId: user.roleId },
    });

    revalidatePath(USERS_PATH);
    return { ok: true, data: user };
  } catch (error) {
    return fail(messageFor(error, "Failed to create user."));
  }
}

/* --------------------------------------------------------------------- */
/* Update                                                                */
/* --------------------------------------------------------------------- */

export async function updateUserAction(
  input: unknown,
): Promise<ActionResult<UserRecord>> {
  const auth = await requireUsersManage();
  if (!auth.ok) return auth;

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const { id, ...patch } = parsed.data;
  try {
    const user = await updateUser(id, patch);

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "user.update",
      entity: "Admin",
      entityId: user.id,
      diff: {
        changed: Object.keys(patch),
        name: user.name,
        email: user.email,
        roleId: user.roleId,
        isActive: user.isActive,
      },
    });

    revalidatePath(USERS_PATH);
    return { ok: true, data: user };
  } catch (error) {
    return fail(messageFor(error, "Failed to update user."));
  }
}

/* --------------------------------------------------------------------- */
/* Activate / deactivate                                                 */
/* --------------------------------------------------------------------- */

export async function setUserActiveAction(
  input: unknown,
): Promise<ActionResult<UserRecord>> {
  const auth = await requireUsersManage();
  if (!auth.ok) return auth;

  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  try {
    const user = await setUserActive(parsed.data.id, parsed.data.isActive);

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: parsed.data.isActive ? "user.activate" : "user.deactivate",
      entity: "Admin",
      entityId: user.id,
      diff: { isActive: user.isActive },
    });

    revalidatePath(USERS_PATH);
    return { ok: true, data: user };
  } catch (error) {
    return fail(messageFor(error, "Failed to change user status."));
  }
}

/* --------------------------------------------------------------------- */
/* Reset password                                                        */
/* --------------------------------------------------------------------- */

export async function resetUserPasswordAction(
  input: unknown,
): Promise<ActionResult> {
  const auth = await requireUsersManage();
  if (!auth.ok) return auth;

  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  try {
    const user = await resetUserPassword(parsed.data.id, parsed.data.password);

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "user.resetPassword",
      entity: "Admin",
      entityId: user.id,
    });

    revalidatePath(USERS_PATH);
    return { ok: true };
  } catch (error) {
    return fail(messageFor(error, "Failed to reset password."));
  }
}

/* --------------------------------------------------------------------- */
/* Delete                                                                */
/* --------------------------------------------------------------------- */

export async function deleteUserAction(input: unknown): Promise<ActionResult> {
  const auth = await requireUsersManage();
  if (!auth.ok) return auth;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  try {
    await deleteUser(parsed.data.id);

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "user.delete",
      entity: "Admin",
      entityId: parsed.data.id,
    });

    revalidatePath(USERS_PATH);
    return { ok: true };
  } catch (error) {
    return fail(messageFor(error, "Failed to delete user."));
  }
}
