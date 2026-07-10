import * as React from "react";
import { MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildWhatsAppEnquiryLink } from "./whatsapp";

export interface WhatsAppEnquireProps {
  /** Product name, pre-filled into the WhatsApp message. */
  productName: string;
  /** Optional SKU, appended to the enquiry for easy lookup. */
  sku?: string | null;
  /** Full-width by default (mobile-first CTA). */
  fullWidth?: boolean;
  size?: "sm" | "lg";
  className?: string;
}

/**
 * "Enquire on WhatsApp" call-to-action for the product detail page.
 *
 * A plain server component: it renders an anchor to the wa.me deep link built
 * from `CONTACT.whatsappNumber` with the product name/SKU pre-filled. No
 * client state, no price — safe for every viewer.
 */
export function WhatsAppEnquire({
  productName,
  sku = null,
  fullWidth = true,
  size = "lg",
  className,
}: WhatsAppEnquireProps) {
  const href = buildWhatsAppEnquiryLink({ productName, sku });

  return (
    <Button
      size={size}
      variant="default"
      className={cn(size === "lg" && "h-11", "gap-2", fullWidth && "w-full", className)}
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
