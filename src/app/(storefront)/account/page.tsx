import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { FadeUp } from "@/components/motion/primitives";
import { AccountStatus } from "@/components/storefront/AccountStatus";
import { ExpiryBanner } from "@/components/storefront/ExpiryBanner";
import { PreferencesPanel } from "@/components/preferences/PreferencesPanel";
import { AccountLogoutButton } from "./AccountLogoutButton";
import { AccountRenewalButton } from "./AccountRenewalButton";

export const metadata: Metadata = {
  title: "Your account — MemoryDeals",
  robots: { index: false, follow: false },
};

// Session state is per-request; never cache this page.
export const dynamic = "force-dynamic";

function formatExpiry(date: Date): string {
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Account overview (server component).
 *
 * Resolves the authoritative viewer via {@link resolveViewer} — the same
 * price-gate verdict the DAL uses — then renders the customer's current status
 * (Pending / Approved+expiry / Rejected / Expired / Blocked) with the right
 * CTA. Approved customers whose grant is close to lapsing also see a
 * dismissible {@link ExpiryBanner}. Admins and anonymous visitors are
 * redirected away — this page is customer-only.
 *
 * PRICE GATE: this page shows NO prices. It reads only status + grant expiry.
 */
export default async function AccountPage() {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) {
    // Admins land on their own dashboard; anon goes to login.
    redirect(viewer.kind === "admin" ? "/admin/dashboard" : "/account/login");
  }

  const customer = await prisma.customer.findUnique({
    where: { id: viewer.customerId },
    select: {
      businessName: true,
      contactName: true,
      phone: true,
      accessGrants: {
        where: {
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { approvedAt: "desc" },
        take: 1,
        select: { expiresAt: true },
      },
    },
  });

  if (!customer) {
    redirect("/account/login");
  }

  const status = viewer.status;
  const hasLivePrices = canSeePrices(viewer);
  const grantExpiry = customer.accessGrants[0]?.expiresAt ?? null;

  return (
    <StorefrontShell>
      <div className="mx-auto w-full max-w-lg space-y-4 py-8 sm:py-12">
        {hasLivePrices && grantExpiry ? (
          <FadeUp>
            <ExpiryBanner expiresAt={grantExpiry} />
          </FadeUp>
        ) : null}

        <FadeUp delay={hasLivePrices ? 0.05 : 0}>
          <div className="space-y-6 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm ring-1 ring-foreground/5 sm:p-7">
            <div className="space-y-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Account
              </p>
              <h1 className="font-heading text-xl font-semibold tracking-tight">
                {customer.businessName}
              </h1>
              <p className="text-sm text-muted-foreground">
                {customer.contactName} · {customer.phone}
              </p>
            </div>

            <AccountStatus
              status={status}
              hasLivePrices={hasLivePrices}
              expiryLabel={grantExpiry ? formatExpiry(grantExpiry) : null}
              renewalTrigger={
                <AccountRenewalButton
                  label={
                    status === "REJECTED"
                      ? "Request access again"
                      : "Request renewal"
                  }
                />
              }
            />

            <div className="flex justify-end border-t border-border pt-4">
              <AccountLogoutButton />
            </div>
          </div>
        </FadeUp>

        {/* Appearance & preferences — theme, density, default view, motion.
            Applies instantly and is remembered on this device. */}
        <FadeUp delay={0.1}>
          <div className="space-y-4 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm ring-1 ring-foreground/5 sm:p-7">
            <div className="space-y-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Preferences
              </p>
              <h2 className="font-heading text-lg font-semibold tracking-tight">
                Appearance
              </h2>
              <p className="text-sm text-muted-foreground">
                Personalise how the catalogue looks and feels. Saved on this
                device.
              </p>
            </div>
            <PreferencesPanel />
          </div>
        </FadeUp>
      </div>
    </StorefrontShell>
  );
}
