import Image from "next/image";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { catalogImageUrl } from "@/lib/image-loader";

/**
 * The top of a brand page. With owner cover artwork: a wide banner with the
 * logo, name and tagline over a scrim. Without: the compact logo + name row
 * (and the tagline, if set). Server component; the cover is the page's LCP
 * element, so it is eager, sized per breakpoint through the resizer.
 */
export function BrandHero({
  name,
  logo,
  coverImage,
  tagline,
}: {
  name: string;
  logo: string | null;
  coverImage: string | null;
  tagline: string | null;
}) {
  const back = (
    <Link
      href="/brands"
      prefetch={false}
      className="inline-flex items-center gap-1 rounded-full py-1 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft className="size-4" aria-hidden />
      All brands
    </Link>
  );

  const logoChip = logo ? (
    <span className="relative size-12 shrink-0 overflow-hidden rounded-xl border border-border bg-white shadow-sm md:size-14">
      <Image src={logo} alt={`${name} logo`} fill sizes="56px" className="object-contain p-1.5" />
    </span>
  ) : null;

  if (coverImage) {
    return (
      <div className="mt-2 mb-5">
        {back}
        <div className="relative mt-2 overflow-hidden rounded-2xl bg-muted">
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
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4 md:p-6">
            {logoChip}
            <div className="min-w-0 text-white">
              <h1 className="font-heading text-xl leading-tight font-bold tracking-tight drop-shadow-sm md:text-3xl">
                {name}
              </h1>
              {tagline ? <p className="mt-0.5 line-clamp-2 text-sm text-white/85">{tagline}</p> : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 mb-5">
      {back}
      <div className="mt-2 flex items-center gap-3">
        {logoChip}
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground md:text-3xl">{name}</h1>
          {tagline ? <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{tagline}</p> : null}
        </div>
      </div>
    </div>
  );
}
