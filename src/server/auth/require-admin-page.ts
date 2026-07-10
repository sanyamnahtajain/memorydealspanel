import "server-only";
import { redirect } from "next/navigation";

import { getViewer } from "@/server/auth/viewer";
import { isAdmin, type AdminViewer } from "@/server/types/viewer";

/**
 * requireAdminPage — the consistent guard for admin **page** server components.
 *
 * Resolves the request viewer (request-scoped memoized) and, when the caller is
 * not an admin, redirects to `/admin/login`. Otherwise it returns the narrowed
 * `AdminViewer` so the page can use `viewer.adminId` without re-checking.
 *
 * This centralises the `getViewer()` + `isAdmin()` + `redirect()` trio that was
 * copy-pasted across every admin page. Do NOT wire this into an
 * `admin/layout.tsx` — the `/admin/login` route lives under the same segment
 * and a layout guard would redirect-loop it.
 */
export async function requireAdminPage(): Promise<AdminViewer> {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }
  return viewer;
}
