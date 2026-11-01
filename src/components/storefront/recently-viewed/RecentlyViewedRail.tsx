"use client";

import * as React from "react";
import Link from "next/link";
import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { catalogImageUrl } from "@/lib/image-loader";
import { brandName } from "@/lib/display-case";
import { Rail } from "@/components/storefront/Rail";
import { SectionHeading } from "@/components/storefront/home/SectionHeading";
import { loadRecentlyViewed, type RecentlyViewedItem } from "./store";

/**
 * "Recently viewed" — the shopper's own trail, read from the browser after
 * mount (it is per device, so the server can never render it). PRICE-FREE
 * BY DESIGN: the cards carry name, brand and picture only, like the "New &
 * featured" shelf; the price is one tap away on the product page. Renders
 * nothing until there are at least two items (one is just the page you are
 * on), so it never claims space it cannot fill.
 */
export function RecentlyViewedRail({
  excludeId,
  className,
}: {
  /** The product being viewed — left out so the rail is "other things you looked at". */
  excludeId?: string;
  className?: string;
}) {
  const [items, setItems] = React.useState<RecentlyViewedItem[]>([]);
  React.useEffect(() => {
    // Read after mount: localStorage is per device and absent on the server.
    const t = setTimeout(() => setItems(loadRecentlyViewed()), 0);
    return () => clearTimeout(t);
  }, [excludeId]);

  const shown = items.filter((x) => x.id !== excludeId);
  if (shown.length < 2) return null;

  return (
    <section aria-labelledby="recently-viewed-heading" className={className}>
      <SectionHeading id="recently-viewed-heading" title="Recently viewed" subtitle="Pick up where you left off." />
      <Rail
        ariaLabel="Recently viewed products"
        className="-mx-4 md:mx-0"
        listClassName="no-scrollbar grid snap-x snap-mandatory auto-cols-[min(42vw,10.5rem)] grid-flow-col gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 md:auto-cols-[minmax(10rem,12rem)] md:gap-4 md:scroll-px-0 md:px-0"
      >
        {shown.map((item) => (
          <li key={item.id} className="snap-start">
            <Link
              href={`/p/${item.slug}`}
              prefetch={false}
              className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card outline-none transition-[box-shadow,transform,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
            >
              <div className="relative aspect-square w-full overflow-hidden bg-muted/60 p-3">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={catalogImageUrl(item.imageUrl, 384)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-contain mix-blend-multiply transition-transform duration-300 ease-out group-hover:scale-[1.04]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageOff className="size-6" aria-hidden />
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                {item.brand ? (
                  <span className={cn("text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase")}>
                    {brandName(item.brand)}
                  </span>
                ) : null}
                <h3 className="line-clamp-2 text-[15px] leading-snug font-semibold text-foreground">{item.name}</h3>
              </div>
            </Link>
          </li>
        ))}
      </Rail>
    </section>
  );
}
