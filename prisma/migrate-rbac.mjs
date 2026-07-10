/**
 * Idempotent RBAC bootstrap: creates the built-in Owner role (full access) and
 * a couple of useful preset roles, then assigns every existing admin without a
 * role to Owner. Safe to run repeatedly.
 *
 * Run: DATABASE_URL=... node prisma/migrate-rbac.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Kept in sync with src/lib/permissions.ts (duplicated here so the migration
// has no TS build step).
const CATALOG = [
  "products.view", "products.edit", "products.delete", "categories.manage",
  "brands.manage", "import.run", "export.data",
  "customers.view", "customers.approve", "customers.edit", "customers.block",
  "dashboard.view", "users.manage", "roles.manage", "settings.manage",
];

async function upsertRole(name, data) {
  const existing = await prisma.role.findUnique({ where: { name } });
  if (existing) {
    return prisma.role.update({ where: { name }, data });
  }
  return prisma.role.create({ data: { name, ...data } });
}

const owner = await upsertRole("Owner", {
  description: "Full access to everything. Cannot be edited or deleted.",
  permissions: ["*"],
  isSystem: true,
});

await upsertRole("Catalog Manager", {
  description: "Manages products, categories, brands, import/export.",
  permissions: [
    "dashboard.view", "products.view", "products.edit", "products.delete",
    "categories.manage", "brands.manage", "import.run", "export.data",
  ],
  isSystem: false,
});

await upsertRole("Sales", {
  description: "Handles customers and access approvals; read-only catalog.",
  permissions: [
    "dashboard.view", "products.view",
    "customers.view", "customers.approve", "customers.edit", "customers.block",
  ],
  isSystem: false,
});

// Assign any admin without a role to Owner. NOTE: on MongoDB an ABSENT field is
// not matched by `{ roleId: null }`, so fetch all and assign the roleless ones.
const admins = await prisma.admin.findMany({ select: { id: true, roleId: true } });
let assigned = 0;
for (const a of admins) {
  if (!a.roleId) {
    await prisma.admin.update({ where: { id: a.id }, data: { roleId: owner.id } });
    assigned++;
  }
}
const orphanAdmins = { count: assigned };

const roleCount = await prisma.role.count();
const adminCount = await prisma.admin.count();
console.log(
  `RBAC bootstrap: ${roleCount} roles present, ${orphanAdmins.count} admin(s) assigned to Owner (${adminCount} admins total). Catalog has ${CATALOG.length} permissions.`,
);

await prisma.$disconnect();
