import { prisma } from "@/server/db";
import { ForbiddenError } from "@/server/dal/guard";
import { isAdmin } from "@/server/types/viewer";
import type { ViewerContext } from "@/server/types/viewer";
import { hasPermission, type Permission } from "@/lib/permissions";

/**
 * RBAC permission gate for admin server actions.
 *
 * INTEGRATOR NOTE: this is a self-contained thin wrapper so the enforcement
 * retrofit in the admin action modules type-checks and runs before the shared
 * `@/server/auth/permissions` module (built on a parallel track) lands. Once
 * that module exports an equivalent `assertPermission` / `can`, re-point the
 * imports in the retrofitted action files (products, categories, customers,
 * import, bulk-images, access) at `@/server/auth/permissions` and delete this
 * file — the semantics here (Owner "*" passes everything, throw ForbiddenError
 * otherwise) are intentionally identical so the swap is behaviour-preserving.
 *
 * Resolution: the viewer only carries `adminId`, so the admin's granted
 * permissions are read live from the assigned Role on every call. An admin with
 * no role (roleId null) has no permissions. The Owner role holds the "*"
 * wildcard and therefore satisfies every check — the seeded admin keeps full
 * access, so ADDING these gates never changes Owner behaviour.
 */

/** Loads the live permission set for an admin from their assigned role. */
async function loadAdminPermissions(adminId: string): Promise<string[]> {
  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { isActive: true, role: { select: { permissions: true } } },
  });
  if (!admin || !admin.isActive) {
    return [];
  }
  return admin.role?.permissions ?? [];
}

/**
 * Resolves whether the viewer holds `permission`. Non-admins never pass.
 * Owner ("*") passes everything via `hasPermission`.
 */
export async function can(
  viewer: ViewerContext,
  permission: Permission,
): Promise<boolean> {
  if (!isAdmin(viewer)) {
    return false;
  }
  const granted = await loadAdminPermissions(viewer.adminId);
  return hasPermission(granted, permission);
}

/**
 * Asserts the viewer holds `permission`, throwing `ForbiddenError` otherwise.
 * Meant to sit right next to `assertAdmin(viewer)` in an admin action: the
 * admin check narrows the type, this check gates the specific capability.
 * `guarded(...)` wrappers already map `ForbiddenError` to a typed
 * `{ ok: false, error }`, so callers surface a clean toast.
 */
export async function assertPermission(
  viewer: ViewerContext,
  permission: Permission,
): Promise<void> {
  if (!(await can(viewer, permission))) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}
