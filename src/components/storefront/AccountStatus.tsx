import * as React from "react";
import Link from "next/link";

import type { CustomerStatus } from "@/lib/schemas/shared";
import {
  accessCopy,
  resolveAccessState,
  type AccessSnapshot,
  type AccessState,
} from "@/lib/access-status";
import { cn } from "@/lib/utils";
import { StatusChip, type StatusChipVariant } from "@/components/common";
import { Button } from "@/components/ui/button";

/** Chip variant per resolved access state (anon never reaches this card). */
const STATE_TO_CHIP: Record<AccessState, StatusChipVariant> = {
  anon: "inactive",
  pending: "pending",
  rejected: "rejected",
  expired: "expired",
  expiring: "approved",
  active: "approved",
  blocked: "blocked",
};

export interface AccountStatusProps {
  status: CustomerStatus;
  /** The live price-gate verdict (`canSeePrices(viewer)`). */
  hasLivePrices: boolean;
  /** Optional formatted expiry line for approved customers (no price). */
  expiryLabel?: string | null;
  /** Effective grant expiry (ISO) — drives the "expiring soon" state. */
  expiresAt?: string | null;
  /** An open (PENDING/SNOOZED) request exists — shows "Under review". */
  hasOpenRequest?: boolean;
  /** Where the "browse" CTA points. Defaults to the catalog home. */
  browseHref?: string;
  /**
   * The renewal trigger element rendered for `renew` states — typically an
   * `<AccountRenewalButton/>`. When omitted, a link to `renewHref` is shown
   * instead, so the card is always actionable.
   */
  renewalTrigger?: React.ReactNode;
  /** Fallback renewal link used when `renewalTrigger` is not provided. */
  renewHref?: string;
  className?: string;
}

/**
 * Presentational status card for the account area: a StatusChip, contextual
 * heading/body, and the right CTA for the customer's state — ALL copy from
 * the shared `accessCopy`/`resolveAccessState` source of truth, so this card
 * always says exactly what the shell banner and price gates say.
 *
 * PRICE GATE: renders NO price anywhere. `expiryLabel` (when supplied) is a
 * date string only. Server component — the interactive renewal dialog is
 * passed in as `renewalTrigger` so this stays presentation-only.
 */
export function AccountStatus({
  status,
  hasLivePrices,
  expiryLabel,
  expiresAt = null,
  hasOpenRequest = false,
  browseHref = "/",
  renewalTrigger,
  renewHref = "/account?renew=1",
  className,
}: AccountStatusProps) {
  const snapshot: AccessSnapshot = {
    signedIn: true,
    status,
    priceAccess: hasLivePrices,
    expiresAt,
    hasOpenRequest,
  };
  const state = resolveAccessState(snapshot);
  const copy = accessCopy(state, snapshot);

  // Live access with a known expiry keeps the concrete date in the body
  // (the shared copy is date-less so every surface can reuse it).
  const body =
    state === "active" && expiryLabel
      ? `Wholesale pricing is unlocked until ${expiryLabel}.`
      : copy.body;

  // Active customers keep their catalog shortcut even though the shared copy
  // carries no CTA for them (the banner shows nothing; this card should).
  const showBrowse = copy.cta === "browse" || state === "active";

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border border-border bg-muted/40 p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{copy.title}</p>
        <StatusChip variant={STATE_TO_CHIP[state]} label={copy.chip} />
      </div>
      <p className="text-sm text-muted-foreground">{body}</p>

      {showBrowse ? (
        <Button className="mt-2 h-9" render={<Link href={browseHref} />}>
          {copy.ctaLabel ?? "Browse catalog with prices"}
        </Button>
      ) : null}

      {copy.cta === "renew" ? (
        renewalTrigger ?? (
          <Button
            variant="outline"
            className="mt-2 h-9"
            render={<Link href={renewHref} />}
          >
            {copy.ctaLabel ?? "Request renewal"}
          </Button>
        )
      ) : null}
    </div>
  );
}
