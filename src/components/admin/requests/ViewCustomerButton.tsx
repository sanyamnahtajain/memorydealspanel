"use client";

import * as React from "react";
import { UserRoundSearch } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * "View customer" — the quiet way out of the requests queue and into the full
 * customer profile (CustomerDetailModal).
 *
 * Deliberately SECONDARY: ghost + muted, so it never competes with the
 * Approve / Reject / Later decisions that own each row. It also says what it
 * does in words — an admin must never have to guess whether tapping it decides
 * anything.
 *
 * The accessible name carries the business name, because a queue shows many of
 * these and "View customer" on its own would read identically on every row.
 */
export function ViewCustomerButton({
  businessName,
  onClick,
  className,
}: {
  businessName: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-label={`View customer ${businessName}`}
      className={cn("shrink-0 text-muted-foreground", className)}
    >
      <UserRoundSearch aria-hidden />
      View customer
    </Button>
  );
}
