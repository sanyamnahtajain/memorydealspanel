"use client";

import * as React from "react";
import { LockIcon, MessageCircle } from "lucide-react";

import type { CustomerStatus } from "@/lib/schemas/shared";
import { Button } from "@/components/ui/button";
import { RequestAccessSheet } from "@/components/storefront/RequestAccessSheet";
import { cn } from "@/lib/utils";

export interface WhatsAppEnquireProps {
  /**
   * The wa.me deep link, minted SERVER-SIDE per viewer by
   * `whatsappEnquiryHrefForViewer` — `null` whenever the WhatsApp gate is
   * closed. On `null` this renders the gated affordance instead of a link, so
   * a gated page carries no number to leak.
   */
  href: string | null;
  /** Product name, for the accessible label. */
  productName: string;
  /** Present when the viewer is a logged-in customer; drives the gated copy. */
  status?: CustomerStatus;
  /** Google-only access gate: when set, "Request access" routes to Google. */
  googleGateHref?: string | null;
  /** Full-width by default (mobile-first CTA). */
  fullWidth?: boolean;
  size?: "sm" | "lg";
  className?: string;
}

/** Why a signed-in customer can't message yet — shown on the locked CTA. */
export function gatedEnquiryLabel(status: CustomerStatus | undefined): string {
  switch (status) {
    case "PENDING":
      return "WhatsApp unlocks once approved";
    case "EXPIRED":
    case "APPROVED":
      return "Renew access to WhatsApp us";
    case "REJECTED":
      return "WhatsApp is for approved buyers";
    case "BLOCKED":
      return "Account blocked";
    default:
      return "Request access to WhatsApp us";
  }
}

/**
 * "Enquire on WhatsApp" CTA — the ONLY way the storefront reaches the shop's
 * WhatsApp (owner request: no access ⇒ no way to reach Raghav).
 *
 * - Gate OPEN (`href` set): a real wa.me anchor, product + SKU pre-filled.
 * - Gate CLOSED (`href` null): a locked button. Anonymous visitors get the
 *   request-access sheet; a signed-in customer whose access isn't live sees
 *   their status (it's not something they can act on from here).
 */
export function WhatsAppEnquire({
  href,
  productName,
  status,
  googleGateHref = null,
  fullWidth = true,
  size = "lg",
  className,
}: WhatsAppEnquireProps) {
  const [open, setOpen] = React.useState(false);
  const classes = cn(size === "lg" && "h-11", "gap-2", fullWidth && "w-full", className);

  if (href) {
    return (
      <Button
        size={size}
        variant="default"
        className={classes}
        render={
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Enquire about ${productName} on WhatsApp`}
          />
        }
      >
        <MessageCircle aria-hidden />
        Enquire on WhatsApp
      </Button>
    );
  }

  // Anonymous (no status) → can request access right here.
  const requestable = status === undefined;

  return (
    <>
      <Button
        type="button"
        size={size}
        variant="outline"
        className={classes}
        disabled={!requestable}
        onClick={requestable ? () => setOpen(true) : undefined}
        aria-label={`${gatedEnquiryLabel(status)} — ${productName}`}
      >
        <LockIcon aria-hidden />
        {gatedEnquiryLabel(status)}
      </Button>
      {requestable ? (
        <RequestAccessSheet open={open} onOpenChange={setOpen} googleGateHref={googleGateHref} />
      ) : null}
    </>
  );
}
