"use client";

import * as React from "react";
import Link from "next/link";

import { hapticTap } from "@/lib/haptics";

type HapticLinkProps = React.ComponentProps<typeof Link>;

/**
 * A `next/link` that buzzes on tap in the installed app (see lib/haptics —
 * best-effort, silent when unsupported, off under reduced motion). The one
 * tiny client island server-rendered CTAs reach for; everything else about
 * the link is passed straight through.
 */
export function HapticLink({ onClick, ...props }: HapticLinkProps) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        hapticTap();
        onClick?.(event);
      }}
    />
  );
}
