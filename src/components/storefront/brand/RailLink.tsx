"use client";

import * as React from "react";
import Link from "next/link";

import { scrollListingIntoView } from "@/lib/scroll-listing";

/**
 * One brand-rail tile. Tapping a category used to scroll the WHOLE page back
 * to the top (Next's default on navigation) — the shopper lost the rail and
 * had to scroll down again to the products. Now the page stays put and only
 * the product list's top is brought under the header (if it was scrolled
 * past), Blinkit-style. The active tile is kept visible inside the rail itself
 * (never by moving the page) — e.g. a link straight to a category low in it.
 */
export function RailLink({
  href,
  active,
  className,
  children,
}: {
  href: string;
  active: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLAnchorElement>(null);

  React.useEffect(() => {
    if (!active) return;
    const item = ref.current;
    const rail = item?.closest("nav");
    if (!item || !rail || rail.scrollHeight <= rail.clientHeight) return;
    const top = item.getBoundingClientRect().top - rail.getBoundingClientRect().top + rail.scrollTop;
    const bottom = top + item.offsetHeight;
    if (top < rail.scrollTop || bottom > rail.scrollTop + rail.clientHeight) {
      rail.scrollTo({ top: Math.max(0, top - rail.clientHeight / 3), behavior: "instant" as ScrollBehavior });
    }
  }, [active]);

  return (
    <Link
      ref={ref}
      href={href}
      prefetch={false}
      scroll={false}
      aria-current={active ? "page" : undefined}
      onClick={() => scrollListingIntoView()}
      className={className}
    >
      {children}
    </Link>
  );
}
