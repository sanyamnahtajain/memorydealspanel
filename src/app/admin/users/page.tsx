import type { Metadata } from "next";

import { PERMISSIONS } from "@/lib/permissions";
import { requirePermissionPage } from "@/server/auth/permissions";
import { listUsers, type UserRecord } from "@/server/services/users";
import { listRoles } from "@/server/services/roles";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader } from "@/components/common";
import { UserTable } from "@/components/admin/users/UserTable";

export const metadata: Metadata = {
  title: "Users — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

// Admin surface — always live so role/status changes reflect immediately.
export const dynamic = "force-dynamic";

/** Serialisable admin row handed to the client table (Dates -> ISO strings). */
export interface UserRowData {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  roleId: string | null;
  roleName: string | null;
  isOwner: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** A role option for the assignment Select. */
export interface RoleOption {
  id: string;
  name: string;
  isSystem: boolean;
}

function toRow(u: UserRecord): UserRowData {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    isActive: u.isActive,
    roleId: u.roleId,
    roleName: u.roleName,
    isOwner: u.isOwner,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

export default async function AdminUsersPage() {
  await requirePermissionPage(PERMISSIONS.USERS_MANAGE);

  const [users, roles] = await Promise.all([listUsers(), listRoles()]);

  const rows = users.map(toRow);
  const roleOptions: RoleOption[] = roles.map((r) => ({
    id: r.id,
    name: r.name,
    isSystem: r.isSystem,
  }));

  const activeCount = rows.filter((r) => r.isActive).length;

  return (
    <AdminShell title="Users">
      <div className="space-y-6">
        <PageHeader
          title="Users"
          description={`${rows.length} admin ${
            rows.length === 1 ? "user" : "users"
          } · ${activeCount} active. Assign roles to control what each can do.`}
        />
        <UserTable rows={rows} roleOptions={roleOptions} />
      </div>
    </AdminShell>
  );
}
