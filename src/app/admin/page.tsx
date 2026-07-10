import { redirect } from "next/navigation";

/**
 * Admin index (`/admin`).
 *
 * The admin surface's home is the dashboard, which lives at `/admin/dashboard`.
 * The primary nav's "Dashboard" item and the shell's logo both link to
 * `/admin`, and post-login redirects also aim here, so this route simply
 * forwards to the dashboard. Auth is enforced by the dashboard page itself
 * (and the admin middleware) — this redirect runs before any gated content.
 */
export default function AdminIndexPage(): never {
  redirect("/admin/dashboard");
}
