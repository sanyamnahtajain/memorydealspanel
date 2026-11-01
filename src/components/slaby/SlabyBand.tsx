"use client";

import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { slabyHref, slabyPlacementOn } from "@/lib/slaby/branding";
import { SLABY_BLUE_TEXT, SlabyWordmark } from "./SlabyMark";
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
 * "This store runs on Slaby" — the platform's band at the end of every
 * browsing screen, phones and laptops alike (owner request: more Slaby
 * presence). Rendered once by the storefront shell, governed by the same
 * owner toggle as the footer mark, so turning "footer" off removes it too.
 */
export function SlabyBand({ className }: { className?: string }) {
  const on = slabyPlacementOn(useSlabyBranding(), "footer");
  const pathname = usePathname() ?? "";
  if (!on || isSlabyBandQuietPath(pathname)) return null;

  return (
    <a
      href={slabyHref("footer", "band")}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="This store runs on Slaby. Get your own wholesale store — opens slaby.in"
      className={cn(
        "group relative isolate mt-12 flex flex-col gap-4 overflow-hidden rounded-2xl border border-[#2563EB]/15 bg-linear-to-br from-[#2563EB]/[0.08] via-[#2563EB]/[0.03] to-transparent p-5 outline-none transition-[border-color,box-shadow] duration-200 hover:border-[#2563EB]/30 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:justify-between sm:p-6 dark:border-[#60A5FA]/20 dark:from-[#60A5FA]/[0.12] dark:via-[#60A5FA]/[0.04] dark:hover:border-[#60A5FA]/35",
        className,
      )}
    >
      {/* A faint oversized wordmark in the corner — the brand as texture. */}
      <SlabyWordmark
        className={cn(
          "pointer-events-none absolute -right-6 -bottom-8 -z-10 h-32 opacity-[0.07] sm:h-40",
          SLABY_BLUE_TEXT,
        )}
      />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          This store runs on
        </p>
        <SlabyWordmark className={cn("mt-1.5 h-9 sm:h-10", SLABY_BLUE_TEXT)} />
        <p className="mt-2 max-w-md text-sm text-pretty text-muted-foreground">
          Catalogue, trade prices, orders and reels in one app, built for
          distributors and wholesalers.
        </p>
      </div>
      <span className="inline-flex h-10 w-fit shrink-0 items-center gap-1.5 rounded-full bg-[#2563EB] px-4 text-sm font-semibold text-white shadow-sm transition-transform duration-200 group-hover:-translate-y-0.5 group-active:scale-[0.97] dark:bg-[#3B82F6]">
        Get your store
        <ArrowUpRight aria-hidden className="size-4" />
      </span>
    </a>
  );
}
