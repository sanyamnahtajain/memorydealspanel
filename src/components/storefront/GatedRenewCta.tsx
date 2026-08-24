"use client";

import * as React from "react";

import {
  accessCopy,
  type AccessState,
} from "@/lib/access-status";
import { Button } from "@/components/ui/button";
import {
  StatusChip,
  type StatusChipVariant,
} from "@/components/common/StatusChip";
import { RenewAccessDialog } from "@/components/access/RenewAccessDialog";
import { cn } from "@/lib/utils";

/**
 * GatedRenewCta — the ONE action a signed-in customer whose access lapsed (or
 * whose request was declined) gets on every gated surface: a button that opens
 * {@link RenewAccessDialog}. Shared by PriceGateCard, ProductPriceArea,
 * VariantSelector, and StickyMobileBar so the renewal affordance is a single
 * piece of code.
 *
 * After the dialog reports a sent request (`onRequested`) the CTA swaps to the
 * canonical "Under review" chip once the dialog closes, so the surface never
 * invites a second request.
 *
 * The dialog is mounted lazily (first tap) — these CTAs can appear once per
 * card in a product grid.
 */

/** Maps a resolved (signed-in) access state to its StatusChip variant. */
export const ACCESS_CHIP_VARIANT: Record<
  Exclude<AccessState, "anon">,
  StatusChipVariant
> = {
  pending: "pending",
  rejected: "rejected",
  expired: "expired",
  expiring: "pending",
  active: "approved",
  blocked: "blocked",
};

export interface GatedRenewCtaProps {
  /** The gated state driving the label + dialog copy. */
  state: "expired" | "rejected";
  /** Button sizing: `sm` inline in cards, `lg` full-width hero surfaces. */
  size?: "sm" | "lg";
  /**
   * `button` (default) — outline Button; `text` — a compact tappable text
   * affordance (e.g. the sticky mobile bar's status word).
   */
  appearance?: "button" | "text";
  /** Overrides the canonical CTA label (e.g. "Access expired — renew"). */
  label?: string;
  className?: string;
}

export function GatedRenewCta({
  state,
  size = "sm",
  appearance = "button",
  label,
  className,
}: GatedRenewCtaProps) {
  const [open, setOpen] = React.useState(false);
  // Dialog mounts on first tap and stays mounted after, so its success state
  // survives while it is closing.
  const [hasOpened, setHasOpened] = React.useState(false);
  const [requested, setRequested] = React.useState(false);

  const openDialog = React.useCallback(() => {
    setHasOpened(true);
    setOpen(true);
  }, []);

  const copy = accessCopy(state);
  const ctaLabel = label ?? copy.ctaLabel ?? "Request renewal";

  const dialog = hasOpened ? (
    <RenewAccessDialog
      open={open}
      onOpenChange={setOpen}
      state={state}
      onRequested={() => setRequested(true)}
    />
  ) : null;

  // Request sent and dialog dismissed → the state is now effectively pending;
  // show the canonical chip instead of inviting another request.
  if (requested && !open) {
    return (
      <>
        <StatusChip
          variant={ACCESS_CHIP_VARIANT.pending}
          label={accessCopy("pending").chip}
          className={className}
        />
        {dialog}
      </>
    );
  }

  if (appearance === "text") {
    return (
      <>
        <button
          type="button"
          onClick={openDialog}
          className={cn(
            "inline-flex w-fit items-center rounded-sm text-left text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
            className,
          )}
        >
          {ctaLabel}
        </button>
        {dialog}
      </>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size === "lg" ? "lg" : "sm"}
        className={cn(size === "lg" ? "h-11 w-full" : "h-8", className)}
        onClick={openDialog}
      >
        {ctaLabel}
      </Button>
      {dialog}
    </>
  );
}
