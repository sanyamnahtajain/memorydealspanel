import Image from "next/image";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { catalogImageUrl } from "@/lib/image-loader";

/**
 * The top of a brand page. With owner cover artwork: a wide banner with a
 * round back button, the logo, name and tagline over a scrim. Without: one
 * compact row — back, logo, name, and the tagline or product count. Server component; the cover is the page's LCP
 * element, so it is eager, sized per breakpoint through the resizer.
 */
export function BrandHero({
  name,
  logo,
  coverImage,
  tagline,
  productCount,
}: {
  name: string;
  logo: string | null;
  coverImage: string | null;
  tagline: string | null;
  /** Visible products across the brand's categories. */
  productCount?: number;
}) {
  const subline =
    tagline ||
    (productCount ? `${productCount.toLocaleString("en-IN")} product${productCount === 1 ? "" : "s"}` : null);

  // A round back button, Blinkit's store header — it sits inline with the
  // logo and name instead of taking a line of its own.
  const back = (tone: "page" | "cover") => (
    <Link
      href="/brands"
      prefetch={false}
      aria-label="All brands"
      className={
        tone === "cover"
          ? "absolute top-3 left-3 z-10 inline-flex size-9 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur outline-none transition-colors hover:bg-black/50 focus-visible:ring-3 focus-visible:ring-white/60"
          : "inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      }
    >
      <ChevronLeft className="size-5" aria-hidden />
    </Link>
  );

  const logoChip = (size: "sm" | "lg") =>
    logo ? (
      <span
        className={
          size === "lg"
            ? "relative size-14 shrink-0 overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-black/5 md:size-16"
            : "relative size-11 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-border md:size-12"
        }
      >
        <Image src={logo} alt={`${name} logo`} fill sizes="64px" className="object-contain p-1" />
      </span>
    ) : null;

  if (coverImage) {
    return (
      <div className="mt-1 mb-4">
        <div className="relative overflow-hidden rounded-2xl bg-muted">
          {back("cover")}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={catalogImageUrl(coverImage, 1200)}
            srcSet={`${catalogImageUrl(coverImage, 750)} 750w, ${catalogImageUrl(coverImage, 1200)} 1200w, ${catalogImageUrl(coverImage, 1920)} 1920w`}
            sizes="(min-width: 1280px) 1200px, 100vw"
            alt=""
            fetchPriority="high"
            decoding="async"
            className="aspect-[2/1] w-full object-cover sm:aspect-[3/1]"
          />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4 md:p-6">
            {logoChip("lg")}
            <div className="min-w-0 pb-0.5 text-white">
              <h1 className="truncate font-heading text-xl leading-tight font-bold tracking-tight drop-shadow-sm md:text-3xl">
                {name}
              </h1>
              {subline ? <p className="mt-0.5 line-clamp-1 text-[13px] text-white/85 md:text-sm">{subline}</p> : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1 mb-4 flex items-center gap-3">
      {back("page")}
      {logoChip("sm")}
      <div className="min-w-0">
        <h1 className="truncate font-heading text-xl leading-tight font-bold tracking-tight text-foreground md:text-2xl">
          {name}
        </h1>
        {subline ? <p className="mt-0.5 line-clamp-1 text-[13px] text-muted-foreground">{subline}</p> : null}
      </div>
    </div>
  );
}
