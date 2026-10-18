"use client";

import { cn } from "@/lib/utils";
import { slabyPlacementOn } from "@/lib/slaby/branding";
import { SlabyBadge } from "./SlabyMark";
import { useSlabyBranding } from "./useSlabyBranding";

/**
 * "Powered by Slaby" at the end of a storefront screen. The footer carries
 * the mark on laptops, but the footer is hidden on phones (owner request), so
 * on a phone the platform was invisible on every page but the gate. This is
 * the phone's footer line: one centred badge, governed by the same "footer"
 * toggle. `phoneOnly` hides it from md: up where the real footer takes over.
 */
export function SlabyPoweredBy({
  phoneOnly = false,
  className,
}: {
  phoneOnly?: boolean;
  className?: string;
}) {
  const on = slabyPlacementOn(useSlabyBranding(), "footer");
  if (!on) return null;
  return (
    <div
      className={cn(
        "flex items-center justify-center py-6",
        phoneOnly && "md:hidden",
        className,
      )}
    >
      <SlabyBadge placement="footer" prefix="Powered by" />
    </div>
  );
}
