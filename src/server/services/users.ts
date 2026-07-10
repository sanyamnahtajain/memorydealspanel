import { Prisma } from "@prisma/client";
import { OWNER_WILDCARD } from "@/lib/permissions";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";

/**
 * Admin-user service layer — the single place that mutates `Admin` rows.
 *
 * These functions are transport-agnostic (no auth, no revalidation): the
 * server actions in `@/server/actions/users` own authorization
 * (`users.manage`), input validation (zod), and audit/revalidation. Keeping
 * the service free of those concerns makes the last-Owner guard easy to
 * unit-test against the seeded database.
 *
 * THE LAST-OWNER GUARD. The Owner role (`isSystem` with a `"*"` wildcard grant)
 * is the only role that can manage users/roles. If the final active Owner-role
 * admin could be deactivated or deleted, the install would lock itself out of
 * administration forever. Every write that could remove the last such admin
 * routes through {@link assertNotLastOwner}, which throws {@link LastOwnerError}.
 */

/** Thrown when an operation would leave zero active Owner-role admins. */
export class LastOwnerError extends Error {
  constructor(
    message = "This is the last active Owner. Assign the Owner role to another active admin before deactivating or removing this one.",
  ) {
    super(message);
    this.name = "LastOwnerError";
  }
}

/** Thrown when creating/updating an admin with an email already in use. */
export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`An admin with the email "${email}" already exists.`);
    this.name = "DuplicateEmailError";
  }
}

/** Serialized admin-user shape returned by the service (explicit allow-list). */
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  roleId: string | null;
  roleName: string | null;
  /** True when this admin holds the system Owner role. */
  isOwner: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  roleId: true,
  lastLoginAt: true,
  createdAt: true,
  role: {
    select: { id: true, name: true, permissions: true, isSystem: true },
  },
} satisfies Prisma.AdminSelect;

type UserRow = Prisma.AdminGetPayload<{ select: typeof USER_SELECT }>;

/** A role is the Owner role when it is a system role carrying the wildcard. */
function roleIsOwner(
  role: { isSystem: boolean; permissions: string[] } | null,
): boolean {
  return (
    role !== null &&
    role.isSystem &&
    role.permissions.includes(OWNER_WILDCARD)
  );
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isActive: row.isActive,
    roleId: row.roleId ?? null,
    roleName: row.role?.name ?? null,
    isOwner: roleIsOwner(row.role),
    lastLoginAt: row.lastLoginAt ?? null,
    createdAt: row.createdAt,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/* --------------------------------------------------------------------- */
/* Reads                                                                 */
/* --------------------------------------------------------------------- */

/** Lists admin users (with role name, active flag, last login) newest-first. */
export async function listUsers(): Promise<UserRecord[]> {
  const rows = await prisma.admin.findMany({
    select: USER_SELECT,
    orderBy: [{ createdAt: "desc" }],
  });
  return rows.map(toRecord);
}

/** Fetches a single admin user, or `null` when the id does not exist. */
export async function getUser(id: string): Promise<UserRecord | null> {
  const row = await prisma.admin.findUnique({
    where: { id },
    select: USER_SELECT,
  });
  return row ? toRecord(row) : null;
}

/* --------------------------------------------------------------------- */
/* Owner-guard helpers                                                   */
/* --------------------------------------------------------------------- */

/** The id of the system Owner role, or `null` if it somehow does not exist. */
async function ownerRoleId(): Promise<string | null> {
  const roles = await prisma.role.findMany({
    where: { isSystem: true },
    select: { id: true, permissions: true },
  });
  const owner = roles.find((r) => r.permissions.includes(OWNER_WILDCARD));
  return owner?.id ?? null;
}

/**
 * Counts admins who are active AND hold the Owner role, optionally excluding
 * one admin id (the subject of a deactivate/delete). Used to decide whether an
 * operation would strand the install with zero Owners.
 *
 * NOTE: `isActive` is filtered in JS rather than in the Mongo query. Documents
 * seeded before the field existed simply omit it; a Prisma `where` filter on a
 * missing field does not apply the schema default, so `isActive: true` would
 * miss them — while a plain read hydrates the default (`true`). Selecting and
 * checking in-memory gives the schema-default semantics on every row.
 */
async function activeOwnerCount(exceptId?: string): Promise<number> {
  const roleId = await ownerRoleId();
  if (!roleId) return 0;
  const owners = await prisma.admin.findMany({
    where: {
      role: { is: { id: roleId } },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, isActive: true },
  });
  return owners.filter((a) => a.isActive).length;
}

/**
 * Throws {@link LastOwnerError} when removing `subject`'s active-Owner standing
 * would leave zero active Owner admins. A no-op when `subject` is not currently
 * an active Owner (there is nothing to lose).
 */
async function assertNotLastOwner(subjectId: string): Promise<void> {
  const subject = await prisma.admin.findUnique({
    where: { id: subjectId },
    select: {
      isActive: true,
      role: { select: { isSystem: true, permissions: true } },
    },
  });
  if (!subject || !subject.isActive || !roleIsOwner(subject.role)) {
    return;
  }
  const remaining = await activeOwnerCount(subjectId);
  if (remaining === 0) {
    throw new LastOwnerError();
  }
}

/* --------------------------------------------------------------------- */
/* Create                                                                */
/* --------------------------------------------------------------------- */

export interface CreateUserData {
  name: string;
  email: string;
  password: string;
  roleId?: string | null;
}

/**
 * Creates an active admin user. The email is normalized and must be unique
 * (throws {@link DuplicateEmailError} on collision). The password is hashed
 * with bcrypt before it ever touches the database.
 */
export async function createUser(data: CreateUserData): Promise<UserRecord> {
  const email = normalizeEmail(data.email);
  const existing = await prisma.admin.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    throw new DuplicateEmailError(email);
  }

  const passwordHash = await hashPassword(data.password);
  const row = await prisma.admin.create({
    data: {
      name: data.name.trim(),
      email,
      passwordHash,
      isActive: true,
      ...(data.roleId ? { role: { connect: { id: data.roleId } } } : {}),
    },
    select: USER_SELECT,
  });
  return toRecord(row);
}

/* --------------------------------------------------------------------- */
/* Update                                                                */
/* --------------------------------------------------------------------- */

export interface UpdateUserData {
  name?: string;
  email?: string;
  roleId?: string | null;
  isActive?: boolean;
}

/**
 * Partial update of an admin: only provided fields change. Renaming a duplicate
 * email throws {@link DuplicateEmailError}. Two Owner-safety rules apply:
 *   - deactivating (`isActive: false`) the last active Owner is refused;
 *   - moving the last active Owner off the Owner role is refused.
 */
export async function updateUser(
  id: string,
  data: UpdateUserData,
): Promise<UserRecord> {
  const current = await prisma.admin.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      isActive: true,
      roleId: true,
      role: { select: { isSystem: true, permissions: true } },
    },
  });
  if (!current) {
    throw new Error("Admin user not found.");
  }

  const patch: Prisma.AdminUpdateInput = {};

  if (data.name !== undefined) {
    patch.name = data.name.trim();
  }

  if (data.email !== undefined) {
    const email = normalizeEmail(data.email);
    if (email !== current.email) {
      const clash = await prisma.admin.findUnique({
        where: { email },
        select: { id: true },
      });
      if (clash && clash.id !== id) {
        throw new DuplicateEmailError(email);
      }
      patch.email = email;
    }
  }

  const isCurrentlyOwner = current.isActive && roleIsOwner(current.role);

  // Deactivation of the last active Owner.
  if (data.isActive === false && isCurrentlyOwner) {
    await assertNotLastOwner(id);
  }
  if (data.isActive !== undefined) {
    patch.isActive = data.isActive;
  }

  // Re-role: moving the last active Owner off the Owner role locks admin out.
  if (data.roleId !== undefined && data.roleId !== current.roleId) {
    const targetRole = data.roleId
      ? await prisma.role.findUnique({
          where: { id: data.roleId },
          select: { id: true, isSystem: true, permissions: true },
        })
      : null;
    if (data.roleId && !targetRole) {
      throw new Error("The selected role no longer exists.");
    }
    const staysOwner = roleIsOwner(targetRole);
    // Only a concern when the admin is (and remains) active but loses Owner.
    const staysActive = data.isActive ?? current.isActive;
    if (isCurrentlyOwner && staysActive && !staysOwner) {
      await assertNotLastOwner(id);
    }
    patch.role =
      data.roleId === null
        ? { disconnect: true }
        : { connect: { id: data.roleId } };
  }

  const row = await prisma.admin.update({
    where: { id },
    data: patch,
    select: USER_SELECT,
  });
  return toRecord(row);
}

/**
 * Toggles an admin's active flag. Deactivating the last active Owner is refused
 * (throws {@link LastOwnerError}).
 */
export async function setUserActive(
  id: string,
  isActive: boolean,
): Promise<UserRecord> {
  if (!isActive) {
    await assertNotLastOwner(id);
  }
  const row = await prisma.admin.update({
    where: { id },
    data: { isActive },
    select: USER_SELECT,
  });
  return toRecord(row);
}

/**
 * Sets a fresh password for an admin (bcrypt-hashed). Used by the "reset
 * password" action; the caller communicates the new temporary password to the
 * user out-of-band.
 */
export async function resetUserPassword(
  id: string,
  password: string,
): Promise<UserRecord> {
  const passwordHash = await hashPassword(password);
  const row = await prisma.admin.update({
    where: { id },
    data: { passwordHash },
    select: USER_SELECT,
  });
  return toRecord(row);
}

/* --------------------------------------------------------------------- */
/* Delete                                                                */
/* --------------------------------------------------------------------- */

/**
 * Permanently deletes an admin user. Refuses (throws {@link LastOwnerError})
 * when the subject is the last active Owner — otherwise the install would be
 * left with no one able to manage users/roles.
 */
export async function deleteUser(id: string): Promise<void> {
  await assertNotLastOwner(id);
  await prisma.admin.delete({ where: { id } });
}
