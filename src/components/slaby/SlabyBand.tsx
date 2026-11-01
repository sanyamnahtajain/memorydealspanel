"use client";

import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { slabyHref, slabyPlacementOn } from "@/lib/slaby/branding";
import { SlabyWordmark } from "./SlabyMark";
import { useSlabyBranding } from "./useSlabyBranding";

/**
 * Screens where the band would distract from a job in progress (cart, the
 * order-placed screen, sign-in and access forms) or has no "end" to sit at
 * (reels). Those screens carry their own quiet badge where it makes sense.
 */
export function isSlabyBandQuietPath(pathname: string): boolean {
  return (
    pathname.startsWith("/account/cart") ||
    pathname.startsWith("/account/orders/confirmation") ||
    pathname.startsWith("/account/login") ||
    pathname.startsWith("/account/renew") ||
    pathname.startsWith("/account/request-access") ||
    pathname.startsWith("/gate") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/reels") ||
    pathname.startsWith("/maintenance")
  );
}

/**
 * "Powered by Slaby" — one slim strip at the end of every browsing screen,
 * phones and laptops alike (owner request: Slaby visible everywhere). Drawn in
 * the shop's own ink — a dark strip with a white wordmark — so it reads as part
 * of the page instead of a blue ad on a green shop. Rendered once by the
 * storefront shell under the owner's "footer" toggle.
 *
 * Product pages on phones carry a fixed "See price / Enquire" bar above the
 * tab nav; there the strip keeps extra room below so the bar never covers it.
 */
export function SlabyBand({ className }: { className?: string }) {
  const on = slabyPlacementOn(useSlabyBranding(), "footer");
  const pathname = usePathname() ?? "";
  if (!on || isSlabyBandQuietPath(pathname)) return null;
  const clearProductBar = pathname.startsWith("/p/");

  return (
    <a
      href={slabyHref("footer", "band")}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Powered by Slaby — get a wholesale store like this one. Opens slaby.in"
      className={cn(
        "group flex items-center gap-3 rounded-2xl bg-foreground px-4 py-3.5 text-background outline-none transition-transform duration-200 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99] sm:px-5 sm:py-4",
        // The product page already ends with room for its bar; no extra gap.
        clearProductBar ? "mt-2 max-md:mb-24" : "mt-10",
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
        <span className="flex items-center gap-2">
          <span className="text-[11px] font-medium tracking-[0.12em] text-background/60 uppercase">
            Powered by
          </span>
          <SlabyWordmark className="h-5 translate-y-px text-background" />
        </span>
        <span className="truncate text-[13px] text-background/70 sm:text-sm">
          Wholesale stores for distributors
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-background/12 px-3 py-1.5 text-[13px] font-semibold text-background transition-colors group-hover:bg-background/20">
        Get yours
        <ArrowUpRight aria-hidden className="size-3.5" />
      </span>
    </a>
  );
}
