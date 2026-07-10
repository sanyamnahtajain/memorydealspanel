"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { ScaleTap } from "@/components/motion/primitives";
import { RequestAccessSheet } from "@/components/storefront/RequestAccessSheet";

export interface AccountRenewalButtonProps {
  /** Button label; varies by state ("Request renewal" vs "Request access"). */
  label?: string;
}

/**
 * Client trigger for the {@link RequestAccessSheet} on the account page.
 *
 * The sheet is a controlled surface (open/onOpenChange), so this thin wrapper
 * owns the open state and renders the CTA. Passed into `AccountStatus` as its
 * `renewalTrigger` for expired / rejected / lapsed customers. Holds no pricing.
 */
export function AccountRenewalButton({
  label = "Request access / renewal",
}: AccountRenewalButtonProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <ScaleTap className="mt-2 inline-block">
        <Button
          type="button"
          variant="outline"
          className="h-9"
          onClick={() => setOpen(true)}
        >
          {label}
        </Button>
      </ScaleTap>
      <RequestAccessSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
