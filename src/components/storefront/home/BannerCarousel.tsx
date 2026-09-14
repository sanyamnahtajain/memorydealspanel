"use client";

import * as React from "react";
import Link from "next/link";
import useEmblaCarousel from "embla-carousel-react";
import { useReducedMotion } from "motion/react";

import type { StorefrontBanner } from "@/lib/banners";
import { cn } from "@/lib/utils";

/**
 * The home promo carousel — the Flipkart/Amazon merchandising strip.
 *
 * A CLIENT component rendering SERVER-RESOLVED banners: the artwork, links and
 * order are decided on the server (and cached with the ISR page, since banners
 * are global and carry no viewer data), and this only handles swipe, dots and
 * auto-advance.
 *
 * Things that matter more than they look:
 *  - NO LAYOUT SHIFT. The strip reserves its aspect ratio before the image
 *    loads, so the page below never jumps — a banner that shoves the catalogue
 *    down as it loads is worse than no banner.
 *  - The FIRST slide is eager with high fetch priority: it is the home page's
 *    LCP element once banners exist. The rest are lazy.
 *  - Auto-advance PAUSES on hover, on focus, and when the tab is hidden, and
 *    is disabled entirely under prefers-reduced-motion. It never moves while
 *    a keyboard user is tabbing through the links.
 *  - A single banner renders as a plain image: no dots, no timer, no swipe
 *    affordance promising something that isn't there.
 */

/** How long each slide holds. Long enough to read, short enough to cycle. */
const AUTOPLAY_MS = 5000;

export function BannerCarousel({
  banners,
  className,
}: {
  banners: StorefrontBanner[];
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const multiple = banners.length > 1;

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: multiple,
    duration: reducedMotion ? 0 : 24,
    align: "center",
    watchDrag: multiple,
  });

  const [selected, setSelected] = React.useState(0);
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    if (!emblaApi) return;
    const sync = () => setSelected(emblaApi.selectedScrollSnap());
    emblaApi.on("select", sync);
    sync();
    return () => {
      emblaApi.off("select", sync);
    };
  }, [emblaApi]);

  // Auto-advance. Skipped entirely for one banner, for reduced motion, while
  // paused (hover/focus), and while the tab is hidden — a carousel spinning in
  // a background tab is pure waste.
  React.useEffect(() => {
    if (!emblaApi || !multiple || reducedMotion || paused) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => emblaApi.scrollNext(), AUTOPLAY_MS);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [emblaApi, multiple, reducedMotion, paused]);

  if (banners.length === 0) return null;

  return (
    <section
      aria-label="Offers"
      aria-roledescription={multiple ? "carousel" : undefined}
      className={cn("relative", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div ref={emblaRef} className="overflow-hidden rounded-2xl">
        <div className="flex touch-pan-y">
          {banners.map((banner, index) => (
            <div
              key={banner.id}
              className="min-w-0 shrink-0 grow-0 basis-full"
              role={multiple ? "group" : undefined}
              aria-roledescription={multiple ? "slide" : undefined}
              aria-label={
                multiple ? `${index + 1} of ${banners.length}` : undefined
              }
            >
              <BannerSlide banner={banner} priority={index === 0} />
            </div>
          ))}
        </div>
      </div>

      {multiple ? (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {banners.map((banner, index) => (
            <button
              key={banner.id}
              type="button"
              aria-label={`Show offer ${index + 1}`}
              aria-current={index === selected}
              onClick={() => emblaApi?.scrollTo(index)}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                index === selected
                  ? "w-5 bg-foreground"
                  : "w-1.5 bg-foreground/25 hover:bg-foreground/40",
              )}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function BannerSlide({
  banner,
  priority,
}: {
  banner: StorefrontBanner;
  priority: boolean;
}) {
  // Aspect ratio is reserved by the wrapper, so the row never reflows when the
  // artwork arrives. Wide on desktop, squarer on phones where a 3:1 strip
  // would be a sliver.
  const art = (
    <picture>
      {banner.mobileImageUrl ? (
        <source media="(max-width: 640px)" srcSet={banner.mobileImageUrl} />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={banner.imageUrl}
        alt={banner.alt}
        draggable={false}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        className="h-full w-full object-cover"
      />
    </picture>
  );

  const frame = (
    <div className="relative aspect-[2/1] w-full overflow-hidden bg-muted sm:aspect-[3/1]">
      {art}
    </div>
  );

  if (!banner.href) return frame;

  // Internal links go through next/link for client navigation; an absolute
  // campaign URL leaves the app, so it gets the usual new-tab hardening.
  const external = /^https?:\/\//i.test(banner.href);
  if (external) {
    return (
      <a
        href={banner.href}
        target="_blank"
        rel="noopener noreferrer"
        className="block outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {frame}
      </a>
    );
  }

  return (
    <Link
      href={banner.href}
      className="block outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {frame}
    </Link>
  );
}
