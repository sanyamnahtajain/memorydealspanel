"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { accessCopy } from "@/lib/access-status";
import { Button } from "@/components/ui/button";
import { ScaleTap } from "@/components/motion/primitives";
import {
  RenewAccessDialog,
  type RenewAccessState,
} from "@/components/access/RenewAccessDialog";
import { useAccessStatus } from "@/components/access/useAccessStatus";

export interface AccountRenewalButtonProps {
  /** Which lapsed state the customer is in — drives label + dialog copy. */
  state: RenewAccessState;
  /** Open the renewal dialog on mount (deep link: /account?renew=1). */
  autoOpen?: boolean;
}

/**
 * Client trigger for the one-tap {@link RenewAccessDialog} on the account
 * page. No form round-trip anymore: the dialog files a renewal from the
 * signed-in customer's existing record. Passed into `AccountStatus` as its
 * `renewalTrigger` for expired / rejected customers. Holds no pricing.
 */
export function AccountRenewalButton({
  state,
  autoOpen = false,
}: AccountRenewalButtonProps) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { refresh } = useAccessStatus();

  // Deep-linked open (?renew=1): scheduled, not sync-in-effect (repo lint).
  React.useEffect(() => {
    if (!autoOpen) return;
    const t = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(t);
  }, [autoOpen]);

  const onRequested = React.useCallback(() => {
    // Repaint every client surface (shell banner) AND the server-rendered
    // status card, which reads the open request from the DB.
    refresh();
    router.refresh();
  }, [refresh, router]);

  return (
    <>
      <ScaleTap className="mt-2 inline-block">
        <Button
          type="button"
          variant="outline"
          className="h-9"
          onClick={() => setOpen(true)}
        >
          {accessCopy(state).ctaLabel ?? "Request renewal"}
        </Button>
      </ScaleTap>
      <RenewAccessDialog
        open={open}
        onOpenChange={setOpen}
        state={state}
        onRequested={onRequested}
      />
    </>
  );
}
