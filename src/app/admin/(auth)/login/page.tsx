import type { Metadata } from "next";
import { AdminLoginRedirectForm } from "./AdminLoginRedirectForm";

export const metadata: Metadata = {
  title: "Admin sign in — MemoryDeals",
  robots: { index: false, follow: false },
};

/**
 * Admin login route (dark, standalone — no storefront/admin shell).
 *
 * The interactive form + redirect live in {@link AdminLoginRedirectForm}
 * (client), which receives the `adminLogin` server action. On success it
 * routes to /admin/dashboard.
 */
export default function AdminLoginPage() {
  return (
    <main className="dark relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground">
      {/* Ambient brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary),transparent_80%),transparent_70%)]"
      />
      <div className="relative w-full max-w-sm">
        <AdminLoginRedirectForm />
      </div>
    </main>
  );
}
