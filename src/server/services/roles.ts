import { Prisma } from "@prisma/client";

import { ALL_PERMISSIONS, OWNER_WILDCARD } from "@/lib/permissions";
import { prisma } from "@/server/db";

/**
 * Role service layer — the single place that reads and mutates RBAC roles.
 *
 * These functions are transport-agnostic (no auth, no revalidation): the server
 * actions in `@/server/actions/roles` own authorization (roles.manage), input
 * validation (zod) and audit/revalidation. Keeping the service pure of those
 * concerns makes the guard logic straightforward to unit-test against the
 * seeded database.
 *
 * Guards enforced here (throw typed errors the action layer maps to messages):
 *  - `isSystem` roles (e.g. Owner) can never be edited or deleted.
 *  - A role still assigned to any admin cannot be deleted.
 *  - Every permission key is validated against the central catalog, so a role
 *    can never persist a stale/unknown permission. The Owner wildcard ("*") is
 *    reserved for system roles and is never accepted from the editor.
 */

/** Serialized role shape returned by the service (explicit allow-list). */
export interface RoleRecord {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
}

/** A role plus the number of admins currently assigned to it. */
export interface RoleWithUserCount extends RoleRecord {
  userCount: number;
}

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  permissions: true,
  isSystem: true,
} satisfies Prisma.RoleSelect;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;

function toRecord(row: RoleRow): RoleRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    permissions: row.permissions,
    isSystem: row.isSystem,
  };
}

/* ---------------------------------------------------------------------- */
/* Typed errors                                                           */
/* ---------------------------------------------------------------------- */

/** Thrown when a system role (isSystem) is edited or deleted. */
export class SystemRoleError extends Error {
  constructor(message = "System roles cannot be modified or deleted.") {
    super(message);
    this.name = "SystemRoleError";
  }
}

/** Thrown when a role cannot be deleted because admins still use it. */
export class RoleInUseError extends Error {
  /** Number of admins still assigned to the role. */
  readonly userCount: number;
  constructor(userCount: number) {
    super(
      `Cannot delete: ${userCount} user${userCount === 1 ? "" : "s"} still ${
        userCount === 1 ? "has" : "have"
      } this role. Reassign them first.`,
    );
    this.name = "RoleInUseError";
    this.userCount = userCount;
  }
}

/** Thrown when a role name collides with an existing role. */
export class DuplicateRoleNameError extends Error {
  constructor(name: string) {
    super(`A role named “${name}” already exists.`);
    this.name = "DuplicateRoleNameError";
  }
}

/** Thrown when the requested role does not exist. */
export class RoleNotFoundError extends Error {
  constructor() {
    super("Role not found.");
    this.name = "RoleNotFoundError";
  }
}

/** Thrown when a permission key is not part of the central catalog. */
export class InvalidPermissionError extends Error {
  constructor(unknownKeys: string[]) {
    super(
      `Unknown permission${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(
        ", ",
      )}.`,
    );
    this.name = "InvalidPermissionError";
  }
}

/* ---------------------------------------------------------------------- */
/* Validation helpers                                                     */
/* ---------------------------------------------------------------------- */

const ALLOWED_PERMISSIONS = new Set<string>(ALL_PERMISSIONS);

/**
 * De-duplicates and validates a permission list from the editor. Rejects the
 * Owner wildcard (reserved for system roles) and any key not in the catalog,
 * so a configurable role can never hold a stale or over-broad grant.
 */
function normalizePermissions(permissions: string[]): string[] {
  const unique = Array.from(new Set(permissions));
  const unknown = unique.filter(
    (key) => key !== OWNER_WILDCARD && !ALLOWED_PERMISSIONS.has(key),
  );
  if (unique.includes(OWNER_WILDCARD) || unknown.length > 0) {
    throw new InvalidPermissionError(
      unique.includes(OWNER_WILDCARD) ? [OWNER_WILDCARD, ...unknown] : unknown,
    );
  }
  // Keep the persisted order stable and catalog-aligned.
  return ALL_PERMISSIONS.filter((key) => unique.includes(key));
}

/* ---------------------------------------------------------------------- */
/* Reads                                                                  */
/* ---------------------------------------------------------------------- */

/**
 * Lists every role with a live count of assigned admins. System roles sort
 * first, then alphabetically — so Owner always heads the list.
 */
export async function listRoles(): Promise<RoleWithUserCount[]> {
  const rows = await prisma.role.findMany({
    select: { ...ROLE_SELECT, _count: { select: { admins: true } } },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
  return rows.map((row) => ({
    ...toRecord(row),
    userCount: row._count.admins,
  }));
}

/** Fetches a single role, or null when it does not exist. */
export async function getRole(id: string): Promise<RoleWithUserCount | null> {
  const row = await prisma.role.findUnique({
    where: { id },
    select: { ...ROLE_SELECT, _count: { select: { admins: true } } },
  });
  if (!row) return null;
  return { ...toRecord(row), userCount: row._count.admins };
}

/* ---------------------------------------------------------------------- */
/* Mutations                                                              */
/* ---------------------------------------------------------------------- */

export interface CreateRoleData {
  name: string;
  description?: string | null;
  permissions: string[];
}

/**
 * Creates a configurable (non-system) role. The permission list is validated
 * against the catalog before persistence. A name collision surfaces as a
 * typed {@link DuplicateRoleNameError}.
 */
export async function createRole(data: CreateRoleData): Promise<RoleRecord> {
  const permissions = normalizePermissions(data.permissions);
  const name = data.name.trim();

  try {
    const row = await prisma.role.create({
      data: {
        name,
        description: data.description?.trim() || null,
        permissions,
        isSystem: false,
      },
      select: ROLE_SELECT,
    });
    return toRecord(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateRoleNameError(name);
    }
    throw error;
  }
}

export interface UpdateRoleData {
  name?: string;
  description?: string | null;
  permissions?: string[];
}

/**
 * Partial update of a configurable role: only the provided fields change.
 * Refuses to touch a system role ({@link SystemRoleError}). Permission lists
 * are validated; a rename that collides surfaces as
 * {@link DuplicateRoleNameError}.
 */
export async function updateRole(
  id: string,
  data: UpdateRoleData,
): Promise<RoleRecord> {
  const current = await prisma.role.findUnique({
    where: { id },
    select: { id: true, isSystem: true },
  });
  if (!current) {
    throw new RoleNotFoundError();
  }
  if (current.isSystem) {
    throw new SystemRoleError();
  }

  const patch: Prisma.RoleUpdateInput = {};
  if (data.name !== undefined) {
    patch.name = data.name.trim();
  }
  if (data.description !== undefined) {
    patch.description = data.description?.trim() || null;
  }
  if (data.permissions !== undefined) {
    patch.permissions = { set: normalizePermissions(data.permissions) };
  }

  try {
    const row = await prisma.role.update({
      where: { id },
      data: patch,
      select: ROLE_SELECT,
    });
    return toRecord(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateRoleNameError(String(patch.name ?? ""));
    }
    throw error;
  }
}

/**
 * Deletes a configurable role. Refuses to delete a system role
 * ({@link SystemRoleError}) or one still assigned to any admin
 * ({@link RoleInUseError}) — so a delete can never orphan a user's access.
 */
export async function deleteRole(id: string): Promise<void> {
  const role = await prisma.role.findUnique({
    where: { id },
    select: { id: true, isSystem: true },
  });
  if (!role) {
    throw new RoleNotFoundError();
  }
  if (role.isSystem) {
    throw new SystemRoleError();
  }

  const userCount = await prisma.admin.count({ where: { roleId: id } });
  if (userCount > 0) {
    throw new RoleInUseError(userCount);
  }

  await prisma.role.delete({ where: { id } });
}

/** True when a Prisma error is the P2002 unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
