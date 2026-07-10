import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/server/db";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { listRoles } from "@/server/services/roles";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import {
  RolesManager,
  type RoleListItem,
} from "@/components/admin/roles/RolesManager";

export const metadata: Metadata = {
  title: "Roles — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Admin surface — always live so permission changes reflect immediately.
export const dynamic = "force-dynamic";

export default async function AdminRolesPage() {
  const viewer = await requireAdminPage();

  // Gate on the roles.manage permission. Resolve the admin's effective grants
  // from their assigned role; the Owner wildcard ("*") satisfies any check.
  const admin = await prisma.admin.findUnique({
    where: { id: viewer.adminId },
    select: { isActive: true, role: { select: { permissions: true } } },
  });
  const granted =
    admin?.isActive && admin.role ? admin.role.permissions : [];
  if (!hasPermission(granted, PERMISSIONS.ROLES_MANAGE)) {
    redirect("/admin");
  }

  const roles = await listRoles();
  const items: RoleListItem[] = roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    isSystem: role.isSystem,
    userCount: role.userCount,
  }));

  return (
    <AdminShell title="Roles">
      <div className="space-y-6">
        <PageHeader
          title="Roles"
          description="Define reusable sets of permissions, then assign them to admin users."
        />
        <RolesManager roles={items} />
      </div>
    </AdminShell>
  );
}
