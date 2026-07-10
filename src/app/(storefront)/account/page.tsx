import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { prisma } from "@/server/db";
import { getViewer } from "@/server/auth/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";
import type { CustomerStatus } from "@/lib/schemas/shared";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { StatusChip, type StatusChipVariant } from "@/components/common";
import { FadeUp } from "@/components/motion/primitives";
import { Button } from "@/components/ui/button";
import { AccountLogoutButton } from "./AccountLogoutButton";

export const metadata: Metadata = {
  title: "Your account — MemoryDeals",
  robots: { index: false, follow: false },
};

// Session state is per-request; never cache this page.
export const dynamic = "force-dynamic";

const STATUS_TO_CHIP: Record<CustomerStatus, StatusChipVariant> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXPIRED: "expired",
  BLOCKED: "blocked",
};

interface StatusCopy {
  heading: string;
  body: string;
  cta?: { label: string; href: string };
}

function statusCopy(
  status: CustomerStatus,
  hasLivePrices: boolean,
  expiresAt: Date | null,
): StatusCopy {
  switch (status) {
    case "APPROVED":
      return hasLivePrices
        ? {
            heading: "You're approved",
            body: expiresAt
              ? `Wholesale pricing is unlocked until ${expiresAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.`
              : "Wholesale pricing is unlocked across the catalog.",
            cta: { label: "Browse catalog", href: "/" },
          }
        : {
            heading: "Access expired",
            body: "Your account is approved but the access window has lapsed. Request a renewal to see wholesale pricing again.",
            cta: { label: "Request renewal", href: "/account/renew" },
          };
    case "PENDING":
      return {
        heading: "Under review",
        body: "Your access request is being reviewed. We'll notify you as soon as it's approved — usually within a business day.",
      };
    case "REJECTED":
      return {
        heading: "Request not approved",
        body: "Your access request wasn't approved. If you think this is a mistake, get in touch and we'll take another look.",
      };
    case "EXPIRED":
      return {
        heading: "Access expired",
        body: "Your wholesale access has expired. Request a renewal to unlock pricing again.",
        cta: { label: "Request renewal", href: "/account/renew" },
      };
    case "BLOCKED":
      return {
        heading: "Account blocked",
        body: "Access to wholesale pricing has been revoked. Please contact us to resolve this.",
      };
  }
}

/**
 * Account overview (server component).
 *
 * Uses the shared {@link getViewer} resolver for the authoritative price-gate
 * verdict (`canSeePrices`), then reads display fields + the current grant's
 * expiry for the contextual CTA. Admins and anonymous visitors are redirected
 * away — this page is customer-only.
 */
export default async function AccountPage() {
  const viewer = await getViewer();
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
  const copy = statusCopy(status, hasLivePrices, grantExpiry);

  return (
    <StorefrontShell>
      <div className="mx-auto w-full max-w-lg py-8 sm:py-12">
        <FadeUp>
          <div className="space-y-6 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm ring-1 ring-foreground/5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
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
              <StatusChip variant={STATUS_TO_CHIP[status]} />
            </div>

            <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-4">
              <p className="font-medium">{copy.heading}</p>
              <p className="text-sm text-muted-foreground">{copy.body}</p>
              {copy.cta ? (
                <Button
                  className="mt-2 h-9"
                  render={<Link href={copy.cta.href} />}
                >
                  {copy.cta.label}
                </Button>
              ) : null}
            </div>

            <div className="flex justify-end border-t border-border pt-4">
              <AccountLogoutButton />
            </div>
          </div>
        </FadeUp>
      </div>
    </StorefrontShell>
  );
}
