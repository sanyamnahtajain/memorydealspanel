import { afterEach, describe, expect, it } from "vitest";
import { OWNER_WILDCARD } from "@/lib/permissions";
import { prisma } from "@/server/db";
import {
  LastOwnerError,
  DuplicateEmailError,
  createUser,
  deleteUser,
  getUser,
  listUsers,
  setUserActive,
  updateUser,
} from "./users";

/**
 * Integration tests for the admin-user service against the SEEDED local
 * MongoDB. The focus is the last-Owner guard: the invariant that the install
 * can never be left with zero active Owner-role admins.
 *
 * Every test cleans up the rows it creates (admins first, then any throwaway
 * roles) so re-runs stay deterministic and the seed set is left untouched.
 */

const createdAdmins: string[] = [];
const createdRoles: string[] = [];

afterEach(async () => {
  if (createdAdmins.length > 0) {
    await prisma.admin.deleteMany({ where: { id: { in: createdAdmins } } });
    createdAdmins.length = 0;
  }
  if (createdRoles.length > 0) {
    await prisma.role.deleteMany({ where: { id: { in: createdRoles } } });
    createdRoles.length = 0;
  }
});

/** Resolves the seeded system Owner role (isSystem + wildcard grant). */
async function ownerRole(): Promise<{ id: string }> {
  const roles = await prisma.role.findMany({
    where: { isSystem: true },
    select: { id: true, permissions: true },
  });
  const owner = roles.find((r) => r.permissions.includes(OWNER_WILDCARD));
  if (!owner) throw new Error("Seed is missing the system Owner role");
  return { id: owner.id };
}

/**
 * The single active Owner admin the seed ships. `isActive` is filtered in JS,
 * not in the query: seed documents predate the field, and a Mongo `where`
 * filter on a missing field does not apply the schema default (a read does).
 */
async function activeSeedOwner(): Promise<{ id: string }> {
  const owner = await ownerRole();
  const admins = await prisma.admin.findMany({
    where: { role: { is: { id: owner.id } } },
    select: { id: true, isActive: true },
  });
  const active = admins.find((a) => a.isActive);
  if (!active) throw new Error("Seed is missing an active Owner admin");
  return { id: active.id };
}

/** Creates a throwaway Owner-role admin and tracks it for cleanup. */
async function makeOwnerAdmin(suffix: string) {
  const owner = await ownerRole();
  const user = await createUser({
    name: `Test Owner ${suffix}`,
    email: `owner-test-${suffix}-${Date.now()}@memorydeals.test`,
    password: "temp-password-123",
    roleId: owner.id,
  });
  createdAdmins.push(user.id);
  return user;
}

describe("createUser", () => {
  it("hashes the password and normalizes the email", async () => {
    const user = await createUser({
      name: "  Casey  ",
      email: "  Casey@Example.COM ",
      password: "temp-password-123",
      roleId: null,
    });
    createdAdmins.push(user.id);

    expect(user.email).toBe("casey@example.com");
    expect(user.name).toBe("Casey");
    expect(user.isActive).toBe(true);

    const row = await prisma.admin.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    expect(row?.passwordHash).toBeTruthy();
    expect(row?.passwordHash).not.toBe("temp-password-123");
  });

  it("rejects a duplicate email", async () => {
    const email = `dupe-${Date.now()}@memorydeals.test`;
    const first = await createUser({
      name: "First",
      email,
      password: "temp-password-123",
    });
    createdAdmins.push(first.id);

    await expect(
      createUser({ name: "Second", email, password: "temp-password-123" }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });
});

describe("last-Owner guard", () => {
  it("refuses to deactivate the seed's sole Owner (via setUserActive)", async () => {
    // The seed ships exactly one active Owner. Do NOT create another here —
    // we want to prove the guard blocks removing the final one.
    const seedOwner = await activeSeedOwner();

    await expect(setUserActive(seedOwner.id, false)).rejects.toBeInstanceOf(
      LastOwnerError,
    );

    // Guard must not have mutated the row.
    const after = await getUser(seedOwner.id);
    expect(after?.isActive).toBe(true);
  });

  it("refuses to delete the sole Owner", async () => {
    const seedOwner = await activeSeedOwner();
    await expect(deleteUser(seedOwner.id)).rejects.toBeInstanceOf(
      LastOwnerError,
    );
    expect(await getUser(seedOwner.id)).not.toBeNull();
  });

  it("refuses to move the sole Owner off the Owner role (via updateUser)", async () => {
    const seedOwner = await activeSeedOwner();

    // Pick any non-Owner role to move to.
    const otherRole = await prisma.role.findFirst({
      where: { isSystem: false },
      select: { id: true },
    });
    expect(otherRole).not.toBeNull();

    await expect(
      updateUser(seedOwner.id, { roleId: otherRole!.id }),
    ).rejects.toBeInstanceOf(LastOwnerError);

    const after = await getUser(seedOwner.id);
    expect(after?.isOwner).toBe(true);
  });

  it("ALLOWS deactivating an Owner when another active Owner remains", async () => {
    // Add a second active Owner, then deactivating the first is safe.
    const extra = await makeOwnerAdmin("guard-ok");
    expect(extra.isOwner).toBe(true);

    const updated = await setUserActive(extra.id, false);
    expect(updated.isActive).toBe(false);

    // Re-activate so cleanup + seed invariants are untouched by side effects.
    await setUserActive(extra.id, true);
  });

  it("ALLOWS deleting an Owner when another active Owner remains", async () => {
    const extra = await makeOwnerAdmin("delete-ok");
    await expect(deleteUser(extra.id)).resolves.toBeUndefined();
    // Already gone; drop from the cleanup list to avoid a redundant delete.
    const idx = createdAdmins.indexOf(extra.id);
    if (idx >= 0) createdAdmins.splice(idx, 1);
    expect(await getUser(extra.id)).toBeNull();
  });

  it("does not block deactivating a non-Owner admin", async () => {
    const user = await createUser({
      name: "Plain Admin",
      email: `plain-${Date.now()}@memorydeals.test`,
      password: "temp-password-123",
      roleId: null,
    });
    createdAdmins.push(user.id);

    const updated = await setUserActive(user.id, false);
    expect(updated.isActive).toBe(false);
  });
});

describe("updateUser", () => {
  it("updates name and role, and reflects Owner standing", async () => {
    const owner = await ownerRole();
    const user = await createUser({
      name: "Renamable",
      email: `rename-${Date.now()}@memorydeals.test`,
      password: "temp-password-123",
      roleId: null,
    });
    createdAdmins.push(user.id);
    expect(user.isOwner).toBe(false);

    const promoted = await updateUser(user.id, {
      name: "Renamed",
      roleId: owner.id,
    });
    expect(promoted.name).toBe("Renamed");
    expect(promoted.isOwner).toBe(true);
    expect(promoted.roleName).toBe("Owner");
  });

  it("rejects updating to an email already in use", async () => {
    const a = await createUser({
      name: "A",
      email: `a-${Date.now()}@memorydeals.test`,
      password: "temp-password-123",
    });
    const b = await createUser({
      name: "B",
      email: `b-${Date.now()}@memorydeals.test`,
      password: "temp-password-123",
    });
    createdAdmins.push(a.id, b.id);

    await expect(
      updateUser(b.id, { email: a.email }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });
});

describe("listUsers", () => {
  it("includes the seed Owner with a role name and active flag", async () => {
    const users = await listUsers();
    const seed = users.find((u) => u.email === "admin@memorydeals.test");
    expect(seed).toBeDefined();
    expect(seed?.roleName).toBe("Owner");
    expect(seed?.isOwner).toBe(true);
    expect(seed?.isActive).toBe(true);
  });
});
