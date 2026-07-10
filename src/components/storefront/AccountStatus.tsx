import * as React from "react";
import Link from "next/link";

import type { CustomerStatus } from "@/lib/schemas/shared";
import { cn } from "@/lib/utils";
import { StatusChip, type StatusChipVariant } from "@/components/common";
import { Button } from "@/components/ui/button";

const STATUS_TO_CHIP: Record<CustomerStatus, StatusChipVariant> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXPIRED: "expired",
  BLOCKED: "blocked",
};

/**
 * How the account CTA should behave for a given status:
 *   - `browse`   — approved with live prices: link into the priced catalog.
 *   - `renew`    — expired / rejected / lapsed-approved: needs a renewal
 *                  request. The page supplies the actual trigger (a
 *                  RequestAccessSheet) via `renewalTrigger`.
 *   - `none`     — pending / blocked: nothing actionable from here.
 */
export type AccountCtaKind = "browse" | "renew" | "none";

interface StatusView {
  heading: string;
  body: string;
  cta: AccountCtaKind;
}

/**
 * Resolves the display copy + CTA kind from the authoritative status and the
 * live price-gate verdict. `hasLivePrices` disambiguates an APPROVED customer
 * whose grant has lapsed (approved-but-no-access → treat as a renewal).
 */
export function resolveAccountView(
  status: CustomerStatus,
  hasLivePrices: boolean,
): StatusView {
  switch (status) {
    case "APPROVED":
      return hasLivePrices
        ? {
            heading: "You're approved",
            body: "Wholesale pricing is unlocked across the catalog.",
            cta: "browse",
          }
        : {
            heading: "Access expired",
            body: "Your account is approved but the access window has lapsed. Request a renewal to see wholesale pricing again.",
            cta: "renew",
          };
    case "PENDING":
      return {
        heading: "Under review",
        body: "Your access request is being reviewed. We'll notify you as soon as it's approved — usually within a business day.",
        cta: "none",
      };
    case "REJECTED":
      return {
        heading: "Request not approved",
        body: "Your last access request wasn't approved. You can submit a fresh request and we'll take another look.",
        cta: "renew",
      };
    case "EXPIRED":
      return {
        heading: "Access expired",
        body: "Your wholesale access has expired. Request a renewal to unlock pricing again.",
        cta: "renew",
      };
    case "BLOCKED":
      return {
        heading: "Account blocked",
        body: "Access to wholesale pricing has been revoked. Please contact us to resolve this.",
        cta: "none",
      };
  }
}

export interface AccountStatusProps {
  status: CustomerStatus;
  /** The live price-gate verdict (`canSeePrices(viewer)`). */
  hasLivePrices: boolean;
  /** Optional formatted expiry line for approved customers (no price). */
  expiryLabel?: string | null;
  /** Where the "browse" CTA points. Defaults to the catalog home. */
  browseHref?: string;
  /**
   * The renewal trigger element rendered for `renew` states — typically a
   * `<RequestAccessSheet trigger={<Button/>} .../>`. When omitted, a link to
   * `renewHref` is shown instead, so the card is always actionable.
   */
  renewalTrigger?: React.ReactNode;
  /** Fallback renewal link used when `renewalTrigger` is not provided. */
  renewHref?: string;
  className?: string;
}

/**
 * Presentational status card for the account area: a StatusChip, contextual
 * heading/body, and the right CTA for the customer's state.
 *
 * PRICE GATE: renders NO price anywhere. `expiryLabel` (when supplied) is a
 * date string only. Server component — the interactive renewal sheet is passed
 * in as `renewalTrigger` so this stays presentation-only.
 */
export function AccountStatus({
  status,
  hasLivePrices,
  expiryLabel,
  browseHref = "/",
  renewalTrigger,
  renewHref = "/account/renew",
  className,
}: AccountStatusProps) {
  const view = resolveAccountView(status, hasLivePrices);
  const body =
    view.cta === "browse" && expiryLabel
      ? `Wholesale pricing is unlocked until ${expiryLabel}.`
      : view.body;

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border border-border bg-muted/40 p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{view.heading}</p>
        <StatusChip variant={STATUS_TO_CHIP[status]} />
      </div>
      <p className="text-sm text-muted-foreground">{body}</p>

      {view.cta === "browse" ? (
        <Button className="mt-2 h-9" render={<Link href={browseHref} />}>
          Browse catalog with prices
        </Button>
      ) : null}

      {view.cta === "renew" ? (
        renewalTrigger ?? (
          <Button
            variant="outline"
            className="mt-2 h-9"
            render={<Link href={renewHref} />}
          >
            Request access / renewal
          </Button>
        )
      ) : null}
    </div>
  );
}
