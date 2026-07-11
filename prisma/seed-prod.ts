/**
 * PRODUCTION seed — the minimum a fresh deployment needs, and nothing else.
 *
 * Unlike `prisma/seed.ts` (which fills the DB with demo customers, products,
 * and a well-known test admin `admin@memorydeals.test / admin1234`), this seeds
 * ONLY:
 *   1. the RBAC roles (Owner / Catalog Manager / Sales), and
 *   2. exactly ONE real admin, taken from env vars, assigned to Owner.
 *
 * It is idempotent (upserts) and FAILS CLOSED if the admin credentials are
 * missing — so it can never silently create a guessable account.
 *
 * Run against the production database:
 *   DATABASE_URL="<atlas-url>" \
 *   ADMIN_EMAIL="you@thememorydeals.com" \
 *   ADMIN_PASSWORD="<a-long-strong-password>" \
 *   ADMIN_NAME="Anchal" \
 *   npx tsx prisma/seed-prod.ts
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `Missing required env ${name}. Refusing to seed production without it.`,
    );
  }
  return v;
}

async function main(): Promise<void> {
  const adminEmail = requireEnv("ADMIN_EMAIL").toLowerCase();
  const adminPassword = requireEnv("ADMIN_PASSWORD");
  const adminName = process.env.ADMIN_NAME?.trim() || "Owner";

  if (adminPassword.length < 10) {
    throw new Error(
      "ADMIN_PASSWORD must be at least 10 characters for a production admin.",
    );
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  // 1. RBAC roles (upsert by unique name). Owner holds the "*" wildcard and is
  // a system role. Keys come from src/lib/permissions.ts — keep in sync with
  // prisma/seed.ts.
  const ownerRole = await prisma.role.upsert({
    where: { name: "Owner" },
    create: {
      name: "Owner",
      description: "Full access to everything. Cannot be edited or deleted.",
      permissions: ["*"],
      isSystem: true,
    },
    update: { permissions: ["*"], isSystem: true },
  });

  await prisma.role.upsert({
    where: { name: "Catalog Manager" },
    create: {
      name: "Catalog Manager",
      description:
        "Manages the product catalog, categories, brands, and imports/exports.",
      permissions: [
        "products.view",
        "products.edit",
        "products.delete",
        "categories.manage",
        "brands.manage",
        "import.run",
        "export.data",
        "dashboard.view",
      ],
      isSystem: false,
    },
    update: {},
  });

  await prisma.role.upsert({
    where: { name: "Sales" },
    create: {
      name: "Sales",
      description:
        "Handles customers and access requests; read-only on the catalog.",
      permissions: [
        "products.view",
        "customers.view",
        "customers.approve",
        "customers.edit",
        "customers.block",
        "dashboard.view",
      ],
      isSystem: false,
    },
    update: {},
  });

  // 2. The single real admin, assigned to Owner. Upsert by email so re-running
  // rotates the password rather than creating duplicates.
  await prisma.admin.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      passwordHash,
      name: adminName,
      totpSecret: null,
      isActive: true,
      roleId: ownerRole.id,
    },
    update: {
      passwordHash,
      name: adminName,
      isActive: true,
      roleId: ownerRole.id,
    },
  });

  console.log(
    `✓ Production seed complete: roles ready, admin ${adminEmail} assigned to Owner.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
