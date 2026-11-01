"use client";

import * as React from "react";
import Link from "next/link";
import useEmblaCarousel from "embla-carousel-react";
import { useReducedMotion } from "motion/react";

import type { StorefrontBanner } from "@/lib/banners";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import { catalogImageUrl } from "@/lib/image-loader";

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
 *    affordance promising something that isn't there. The same goes for
 *    banners that all fit side by side (two 16:9 offers on a laptop).
 *  - EVERY BANNER IS SHOWN WHOLE, AT ITS OWN SHAPE. Owners upload whatever
 *    their design tool gives them (16:9, 3:2, 3:1, square). A fixed 3:1
 *    frame meant blurred filler beside a 16:9 offer, or a re-cut that looked
 *    stitched together. Slides share one height and take their own width
 *    (see .md-banners in globals.css); the server reads each file's shape.
 */

/** How long each slide holds. Long enough to read, short enough to cycle. */
const AUTOPLAY_MS = 5000;

/** The frame a banner of unknown shape gets (the old fixed strip). */
const FALLBACK_DESKTOP = 3;
const FALLBACK_PHONE = 2;

/**
 * Each slide's shape on a laptop (desktop art) and on a phone (the phone art
 * when there is one). The sizes themselves are CSS (.md-banners in
 * globals.css) — this only hands it the numbers.
 */
export function bannerShapes(banner: StorefrontBanner): { desktop: number; phone: number } {
  const desktop = banner.aspect ?? FALLBACK_DESKTOP;
  const phone = banner.mobileImageUrl
    ? (banner.mobileAspect ?? FALLBACK_PHONE)
    : (banner.aspect ?? FALLBACK_PHONE);
  return { desktop, phone };
}

/**
 * Roughly how wide a slide is drawn, as a fraction of the strip — the same
 * clamp the CSS does, minus the gaps. Only used for `sizes`, so the browser
 * picks a sharp-enough file without downloading a 1920 for a half-width slide.
 */
function slideFraction(ratio: number, sum: number, min: number, max: number): number {
  const height = Math.min(max, Math.max(min, 1 / sum));
  return Math.min(1, height * ratio);
}

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
    // Embla quietly turns looping off when the slides can't fill a loop.
    loop: multiple,
    duration: reducedMotion ? 0 : 24,
    align: "center",
    watchDrag: multiple,
  });

  const [selected, setSelected] = React.useState(0);
  // Stops, not banners: two banners side by side on a laptop are ONE stop —
  // no dots, no timer, nothing to swipe.
  const [stops, setStops] = React.useState(banners.length);
  const [paused, setPaused] = React.useState(false);
  const moves = stops > 1;

  React.useEffect(() => {
    if (!emblaApi) return;
    const sync = () => {
      setSelected(emblaApi.selectedScrollSnap());
      setStops(emblaApi.scrollSnapList().length);
    };
    emblaApi.on("select", sync);
    emblaApi.on("reInit", sync);
    sync();
    return () => {
      emblaApi.off("select", sync);
      emblaApi.off("reInit", sync);
    };
  }, [emblaApi]);

  // Auto-advance. Skipped entirely for one banner, for reduced motion, while
  // paused (hover/focus), and while the tab is hidden — a carousel spinning in
  // a background tab is pure waste.
  React.useEffect(() => {
    if (!emblaApi || !moves || reducedMotion || paused) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    // Without a loop the last stop wraps back to the first.
    const advance = () => (emblaApi.canScrollNext() ? emblaApi.scrollNext() : emblaApi.scrollTo(0));
    const start = () => {
      if (timer !== null) return;
      timer = setInterval(advance, AUTOPLAY_MS);
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
  }, [emblaApi, moves, reducedMotion, paused]);

  if (banners.length === 0) return null;

  const shapes = banners.map(bannerShapes);
  const sumDesktop = shapes.reduce((t, s) => t + s.desktop, 0);
  const sumPhone = shapes.reduce((t, s) => t + s.phone, 0);
  const rowStyle = {
    "--sum-d": sumDesktop,
    "--sum-m": sumPhone,
    "--gaps-d": `calc(${banners.length - 1} * var(--gap))`,
    "--gaps-m": `calc(${banners.length - 1} * var(--gap))`,
  } as React.CSSProperties;

  return (
    <section
      aria-label="Offers"
      aria-roledescription={multiple ? "carousel" : undefined}
      className={cn("md-banners relative", className)}
      style={rowStyle}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="md-banners-row">
        <div ref={emblaRef} className="overflow-hidden rounded-2xl">
          <div className="md-banners-track flex touch-pan-y">
            {banners.map((banner, index) => {
              const shape = shapes[index];
              const desktopPart = slideFraction(shape.desktop, sumDesktop, 1 / 4, 1 / 2.4);
              const phonePart = slideFraction(shape.phone, sumPhone, 1 / 2, 1 / 1.6);
              return (
                <div
                  key={banner.id}
                  className="md-banner-slide min-w-0 shrink-0 grow-0"
                  style={{ "--r-d": shape.desktop, "--r-m": shape.phone } as React.CSSProperties}
                  role={multiple ? "group" : undefined}
                  aria-roledescription={multiple ? "slide" : undefined}
                  aria-label={
                    multiple ? `${index + 1} of ${banners.length}` : undefined
                  }
                >
                  <BannerSlide
                    banner={banner}
                    priority={index === 0}
                    active={index === selected}
                    sizes={`(min-width: 1280px) ${Math.ceil(desktopPart * 1200)}px, (min-width: 640px) ${Math.ceil(desktopPart * 100)}vw, ${Math.ceil(phonePart * 100)}vw`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {moves ? (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {Array.from({ length: stops }, (_, index) => {
            const isActive = index === selected;
            // The active dot is a tiny progress bar: it fills over the hold
            // time, so the carousel never moves without warning. Keyed on the
            // slide so it restarts from zero each time a new slide is shown.
            const running = isActive && !paused && !reducedMotion;
            return (
              <button
                key={index}
                type="button"
                aria-label={`Show offer ${index + 1}`}
                aria-current={isActive}
                onClick={() => emblaApi?.scrollTo(index)}
                className={cn(
                  "relative h-1.5 overflow-hidden rounded-full transition-all duration-300 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  isActive ? "w-7 bg-foreground/20" : "w-1.5 bg-foreground/25 hover:bg-foreground/40",
                )}
              >
                {isActive ? (
                  <span
                    key={`${selected}-${running ? "run" : "hold"}`}
                    aria-hidden
                    className={cn("absolute inset-0 rounded-full bg-primary", running ? "md-progress" : "")}
                    style={running ? ({ "--md-progress-ms": `${AUTOPLAY_MS}ms` } as React.CSSProperties) : { transform: "scaleX(1)" }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function BannerSlide({
  banner,
  priority,
  active,
  sizes,
}: {
  banner: StorefrontBanner;
  priority: boolean;
  /** The slide currently showing — drives the slow drift on hero copy. */
  active: boolean;
  /** How wide this slide is drawn, for the browser's file pick. */
  sizes: string;
}) {
  // Artwork is on object storage, so it can fail independently of the page —
  // offline, a flaky phone connection, a deleted object. A broken-image icon
  // in a hero slot looks like a broken shop, so a failure degrades to the
  // banner's own words on a plain card instead.
  const [failed, setFailed] = React.useState(false);

  // `onError` alone is NOT enough. The markup is server-rendered, so the
  // browser can finish (and fail) the request before React hydrates and
  // attaches the handler — the error event is long gone by then, and the slot
  // is left showing the browser's own broken-image glyph. That is the NORMAL
  // case offline, which is precisely when this fallback has to work. So the
  // ref also asks the element directly: a finished image with no intrinsic
  // width is a failed one.
  const checkAlreadyFailed = React.useCallback((node: HTMLImageElement | null) => {
    if (node && node.complete && node.naturalWidth === 0) setFailed(true);
  }, []);

  // The slide's size is set by CSS from the banner's known shape, so the row
  // never reflows when the artwork arrives.
  const art = failed ? (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/40 px-6">
      <span className="line-clamp-2 text-center text-sm font-medium text-muted-foreground sm:text-base">
        {banner.alt}
      </span>
    </div>
  ) : (
    <>
      {/* AMBIENT FILL — only ever visible in the fallback cases: a banner
          whose shape couldn't be read (fixed 3:1 / 2:1 frame) or one wider
          than the strip (a 3:1 desktop file on a phone). Then the artwork is
          shown whole over a blurred copy of itself. A banner of known shape
          gets a slide of exactly its shape, and this sits hidden behind it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        aria-hidden
        src={catalogImageUrl(banner.imageUrl, 384)}
        alt=""
        draggable={false}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className="absolute inset-0 h-full w-full scale-125 object-cover opacity-80 blur-2xl saturate-125"
      />
    {/* The drift is for photo heroes with copy over them. Owner artwork is
        designed edge to edge — zooming it crops the price strip and the
        logos along its borders. */}
    <picture className={cn("relative block h-full w-full", active && banner.title ? "md-kenburns" : "")}>
      {banner.mobileImageUrl ? (
        <source
          // Same breakpoint as the phone sizing in globals.css (min-width: 640px).
          media="(max-width: 639.98px)"
          srcSet={`${catalogImageUrl(banner.mobileImageUrl, 640)} 640w, ${catalogImageUrl(banner.mobileImageUrl, 828)} 828w`}
          sizes="100vw"
        />
      ) : null}
      {/* Sized per breakpoint through the resizer (src/lib/image-loader.ts):
          the hero is the home page's LCP element, so it must never be the
          380 KB PNG that came out of the design tool. */}
      <img
        ref={checkAlreadyFailed}
        src={catalogImageUrl(banner.imageUrl, 1200)}
        srcSet={`${catalogImageUrl(banner.imageUrl, 750)} 750w, ${catalogImageUrl(banner.imageUrl, 1200)} 1200w, ${catalogImageUrl(banner.imageUrl, 1920)} 1920w`}
        sizes={sizes}
        alt={banner.alt}
        draggable={false}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding={priority ? "sync" : "async"}
        onError={() => setFailed(true)}
        // A hero (with copy over it) fills the frame like a photograph; an
        // image-only banner keeps its whole artwork visible (see AMBIENT FILL).
        className={cn("h-full w-full", banner.title ? "object-cover" : "object-contain")}
      />
    </picture>
    </>
  );

  // HERO COPY (owner-authored headline/line/button): drawn over the artwork
  // behind a left-to-right scrim so the words read on any picture. A banner
  // without copy renders exactly as before. The button is decorative here —
  // the whole slide is already the link — so it is a span, not a nested <a>.
  const hero = banner.title ? (
    <>
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/35 to-black/5 sm:from-black/65 sm:via-black/25"
      />
      <div className="absolute inset-y-0 left-0 flex w-full max-w-[34rem] flex-col justify-center gap-2 px-5 text-white sm:px-8 md:gap-3">
        <h2 className="text-balance font-heading text-xl leading-tight font-bold tracking-tight drop-shadow-sm sm:text-3xl md:text-4xl">
          {banner.title}
        </h2>
        {banner.subtitle ? (
          <p className="line-clamp-2 max-w-md text-sm text-white/85 sm:text-base">{banner.subtitle}</p>
        ) : null}
        {banner.href && banner.ctaLabel ? (
          <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm">
            {banner.ctaLabel}
            <ArrowRight aria-hidden className="size-4" />
          </span>
        ) : null}
      </div>
    </>
  ) : null;

  const frame = (
    <div className="md-banner-frame relative w-full overflow-hidden rounded-2xl bg-muted">
      {art}
      {hero}
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
        className="block rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {frame}
      </a>
    );
  }

  return (
    <Link
      href={banner.href}
      className="block rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {frame}
    </Link>
  );
}
