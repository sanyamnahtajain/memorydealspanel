import "server-only";
import { redirect } from "next/navigation";

import type { Permission } from "@/lib/permissions";
import { getViewer } from "@/server/auth/viewer";
import {
  isAdmin,
  viewerHasPermission,
  type AdminViewer,
  type ViewerContext,
} from "@/server/types/viewer";

/**
 * RBAC enforcement helpers.
 *
 * Three layers, all built on `viewerHasPermission` (which honours the Owner
 * `"*"` wildcard):
 *   - `can`            — a pure boolean, for conditional UI / branching.
 *   - `assertPermission` — throws `ForbiddenError` in server actions / DAL.
 *   - `requirePermissionPage` — resolves + guards a page server component,
 *     redirecting unauthenticated/under-privileged viewers to the login.
 */

/**
 * Thrown by `assertPermission` when a viewer lacks the required permission.
 * Carries the offending `permission` so callers/loggers can act on it. Server
 * actions should catch this and translate it into their typed error result.
 */
export class ForbiddenError extends Error {
  readonly permission: Permission;

  constructor(permission: Permission) {
    super(`Forbidden: missing permission "${permission}".`);
    this.name = "ForbiddenError";
    this.permission = permission;
  }
}

/** Pure predicate: does this viewer hold `key`? Never throws. */
export function can(viewer: ViewerContext, key: Permission): boolean {
  return viewerHasPermission(viewer, key);
}

/**
 * Enforce `key`, throwing `ForbiddenError` when the viewer lacks it. Use inside
 * server actions and DAL functions after resolving the viewer.
 */
export function assertPermission(
  viewer: ViewerContext,
  key: Permission,
): void {
  if (!viewerHasPermission(viewer, key)) {
    throw new ForbiddenError(key);
  }
}

/**
 * Page-level guard: resolve the request viewer and redirect to `/admin/login`
 * unless it is an admin holding `key`. Returns the narrowed `AdminViewer` so
 * the page can read `viewer.permissions` / `viewer.adminId` without rechecking.
 *
 * Mirrors `requireAdminPage` but additionally enforces a specific permission.
 */
export async function requirePermissionPage(
  key: Permission,
): Promise<AdminViewer> {
  const viewer = await getViewer();
  if (!isAdmin(viewer) || !viewerHasPermission(viewer, key)) {
    redirect("/admin/login");
  }
  return viewer;
}
