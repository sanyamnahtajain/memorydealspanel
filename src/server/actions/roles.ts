"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  ALL_PERMISSIONS,
  hasPermission,
  PERMISSIONS,
  type Permission,
} from "@/lib/permissions";
import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { writeAudit } from "@/server/security/audit";
import {
  createRole,
  deleteRole,
  updateRole,
  DuplicateRoleNameError,
  InvalidPermissionError,
  RoleInUseError,
  RoleNotFoundError,
  SystemRoleError,
  type RoleRecord,
} from "@/server/services/roles";

/**
 * "use server" action wrappers for role management.
 *
 * Every mutating action:
 *   1. resolves the viewer and requires the `roles.manage` permission (returns a
 *      typed error otherwise — never throws raw across the client boundary),
 *   2. validates input with zod,
 *   3. delegates to the role service (which owns the system-role / in-use /
 *      permission-catalog guards),
 *   4. writes an audit entry and revalidates /admin/roles.
 */

const ROLES_PATH = "/admin/roles";

export type ActionResult<T = void> = [T] extends [void]
  ? { ok: true } | { ok: false; error: string }
  : { ok: true; data: T } | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Formats the first zod issue into a human-readable message. */
function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

/**
 * Resolves the admin's effective permission set from their assigned role.
 * Returns an empty array for an admin without a role. The Owner role carries
 * the "*" wildcard which {@link hasPermission} treats as all permissions.
 */
async function permissionsForAdmin(adminId: string): Promise<string[]> {
  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { isActive: true, role: { select: { permissions: true } } },
  });
  if (!admin || !admin.isActive) return [];
  return admin.role?.permissions ?? [];
}

/**
 * Resolves the viewer, requires an admin with `required`, and returns the
 * admin id for auditing — or a typed forbidden result. Centralises the
 * permission gate so every action stays uniform.
 */
async function requirePermission(
  required: Permission,
): Promise<{ ok: true; adminId: string } | { ok: false; error: string }> {
  const viewer = await resolveViewer();
  if (!isAdmin(viewer)) {
    return fail("You must be signed in as an admin.");
  }
  const granted = await permissionsForAdmin(viewer.adminId);
  if (!hasPermission(granted, required)) {
    return fail("You don't have permission to manage roles.");
  }
  return { ok: true, adminId: viewer.adminId };
}

/* ---------------------------------------------------------------------- */
/* Schemas                                                                */
/* ---------------------------------------------------------------------- */

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id.");

const nameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters.")
  .max(60, "Name must be 60 characters or fewer.");

const descriptionSchema = z
  .string()
  .trim()
  .max(200, "Description must be 200 characters or fewer.")
  .optional()
  .nullable();

const permissionSchema = z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]);

const permissionsSchema = z
  .array(permissionSchema)
  .max(ALL_PERMISSIONS.length, "Too many permissions.");

const createSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
  permissions: permissionsSchema,
});

const updateSchema = z.object({
  id: objectId,
  name: nameSchema.optional(),
  description: descriptionSchema,
  permissions: permissionsSchema.optional(),
});

const deleteSchema = z.object({ id: objectId });

/** Maps a service-thrown error to a user-facing message. */
function messageFor(error: unknown, fallback: string): string {
  if (
    error instanceof SystemRoleError ||
    error instanceof RoleInUseError ||
    error instanceof DuplicateRoleNameError ||
    error instanceof RoleNotFoundError ||
    error instanceof InvalidPermissionError
  ) {
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}

/* ---------------------------------------------------------------------- */
/* Create                                                                 */
/* ---------------------------------------------------------------------- */

export async function createRoleAction(
  input: unknown,
): Promise<ActionResult<RoleRecord>> {
  const auth = await requirePermission(PERMISSIONS.ROLES_MANAGE);
  if (!auth.ok) return auth;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }

  try {
    const role = await createRole({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      permissions: parsed.data.permissions,
    });

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "role.create",
      entity: "Role",
      entityId: role.id,
      diff: { name: role.name, permissions: role.permissions },
    });

    revalidatePath(ROLES_PATH);
    return { ok: true, data: role };
  } catch (error) {
    return fail(messageFor(error, "Failed to create role."));
  }
}

/* ---------------------------------------------------------------------- */
/* Update                                                                 */
/* ---------------------------------------------------------------------- */

export async function updateRoleAction(
  input: unknown,
): Promise<ActionResult<RoleRecord>> {
  const auth = await requirePermission(PERMISSIONS.ROLES_MANAGE);
  if (!auth.ok) return auth;

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }

  const { id, ...patch } = parsed.data;

  try {
    const role = await updateRole(id, {
      name: patch.name,
      description: patch.description,
      permissions: patch.permissions,
    });

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "role.update",
      entity: "Role",
      entityId: role.id,
      diff: {
        changed: Object.keys(patch),
        name: role.name,
        permissions: role.permissions,
      },
    });

    revalidatePath(ROLES_PATH);
    return { ok: true, data: role };
  } catch (error) {
    return fail(messageFor(error, "Failed to update role."));
  }
}

/* ---------------------------------------------------------------------- */
/* Delete                                                                 */
/* ---------------------------------------------------------------------- */

export async function deleteRoleAction(input: unknown): Promise<ActionResult> {
  const auth = await requirePermission(PERMISSIONS.ROLES_MANAGE);
  if (!auth.ok) return auth;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error));
  }

  try {
    await deleteRole(parsed.data.id);

    await writeAudit({
      actorType: "admin",
      actorId: auth.adminId,
      action: "role.delete",
      entity: "Role",
      entityId: parsed.data.id,
    });

    revalidatePath(ROLES_PATH);
    return { ok: true };
  } catch (error) {
    return fail(messageFor(error, "Failed to delete role."));
  }
}
