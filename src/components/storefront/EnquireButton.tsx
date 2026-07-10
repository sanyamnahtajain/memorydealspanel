"use client";

import * as React from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Admin WhatsApp number used for the "Enquire" deep link.
 *
 * Sourced from `NEXT_PUBLIC_WHATSAPP_NUMBER` (digits with country code, no
 * "+" or spaces, e.g. `919876543210`). Falls back to a sensible placeholder
 * so the storefront still renders in dev without configuration. `NEXT_PUBLIC_`
 * env vars are inlined at build time, so reading it in a client component is
 * safe and static.
 */
const RAW_ADMIN_NUMBER =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "919876543210";

/** Strips everything but digits — wa.me wants a bare international number. */
function normaliseNumber(input: string): string {
  return input.replace(/\D/g, "");
}

const ADMIN_NUMBER = normaliseNumber(RAW_ADMIN_NUMBER);

/**
 * Builds a wa.me deep link with the product name pre-filled. We intentionally
 * never include a price in the message — the enquiry is the mechanism by which
 * a non-approved buyer asks for one.
 */
function buildWaLink(productName: string, sku: string | null): string {
  const lines = [
    "Hi MemoryDeals, I'd like to enquire about:",
    productName,
    sku ? `(SKU: ${sku})` : null,
  ].filter((line): line is string => Boolean(line));
  const text = encodeURIComponent(lines.join("\n"));
  return `https://wa.me/${ADMIN_NUMBER}?text=${text}`;
}

export interface EnquireButtonProps {
  /** Product name, pre-filled into the WhatsApp message. */
  productName: string;
  /** Optional SKU, appended to the enquiry for easy lookup. */
  sku?: string | null;
  /** Full-width by default (mobile-first sticky CTA). */
  fullWidth?: boolean;
  className?: string;
}

/**
 * "Enquire on WhatsApp" call-to-action. Opens the admin's WhatsApp chat in a
 * new tab with the product name pre-filled. Client component only because it
 * reads the (build-time-inlined) public number; it has no interactive state.
 */
export function EnquireButton({
  productName,
  sku = null,
  fullWidth = true,
  className,
}: EnquireButtonProps) {
  const href = React.useMemo(
    () => buildWaLink(productName, sku),
    [productName, sku],
  );

  return (
    <Button
      size="lg"
      variant="default"
      className={cn("h-11 gap-2", fullWidth && "w-full", className)}
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
