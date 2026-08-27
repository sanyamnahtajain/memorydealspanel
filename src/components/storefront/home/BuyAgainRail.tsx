"use client";

/**
 * BuyAgainRail — one-tap re-order rail: the products THIS customer orders
 * most, first thing on the home page. For wholesale, repeat purchase is the
 * whole business.
 *
 * ISR CONTRACT: the home page is a PUBLIC cached shell. This component keeps
 * it that way by fetching /api/buy-again in the BROWSER after mount — the
 * viewer is resolved server-side inside that route, never here. Until data
 * arrives (and for anon / admin / error / no-history responses) it renders
 * NOTHING AT ALL — no skeleton, no reserved space — so a logged-out visitor's
 * home page is pixel-identical to the cached shell, exactly like
 * AccessStatusBanner's progressive enhancement.
 *
 * PRICE-GATE CONTRACT: the payload never contains a raw money number. A
 * price-authorised viewer gets `priceLabel` as a pre-formatted string; every
 * other viewer gets `null` and sees the same masked "₹•,•••" chip the product
 * cards use. Nothing in this file computes or reveals entitlement.
 */

import * as React from "react";

import {
  getViewerContext,
  needSlice,
  subscribe,
} from "@/components/storefront/viewer-context-client";
import { CONTEXT_SLICES } from "@/lib/viewer-context";
import Link from "next/link";
import Image from "next/image";
import { ImageOff, Lock } from "lucide-react";

import { SectionHeading } from "./SectionHeading";

interface BuyAgainItem {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  priceLabel: string | null;
}


export function BuyAgainRail() {
  const [items, setItems] = React.useState<BuyAgainItem[]>([]);

  React.useEffect(() => {
    // Registers with the SHARED per-viewer request rather than fetching its
    // own endpoint — see viewer-context-client for why one call, not four.
    const update = () => {
      const items = getViewerContext().buyAgain;
      if (items.length > 0) setItems(items);
    };
    const unsubscribe = subscribe(update);
    needSlice(CONTEXT_SLICES.buyAgain);
    update();
    return unsubscribe;
  }, []);

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="home-buy-again" className="mt-8">
      <SectionHeading
        id="home-buy-again"
        title="Buy again"
        seeAllHref="/account/orders"
        seeAllLabel="Your orders"
      />
      <ul className="grid auto-cols-[minmax(8.5rem,10.5rem)] grid-flow-col gap-3 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x snap-mandatory md:gap-4">
        {items.map((item) => (
          <li key={item.id} className="snap-start">
            <BuyAgainCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function BuyAgainCard({ item }: { item: BuyAgainItem }) {
  return (
    <Link
      href={`/p/${item.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50 hover:shadow-md active:scale-[0.99]"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="(min-width: 640px) 20vw, 40vw"
            className="object-cover transition-transform duration-300 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-7" aria-hidden />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {item.brand ? (
          <span className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
            {item.brand}
          </span>
        ) : null}
        <h3 className="line-clamp-2 text-sm font-semibold text-foreground">
          {item.name}
        </h3>
        <div className="mt-auto pt-2">
          {item.priceLabel ? (
            <span className="text-sm font-bold text-foreground">
              {item.priceLabel}
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground"
              aria-label="Price locked — sign in with approved access to see it"
            >
              <Lock className="size-3.5" aria-hidden />
              <span aria-hidden className="blur-[4px]">
                ₹•,•••
              </span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
