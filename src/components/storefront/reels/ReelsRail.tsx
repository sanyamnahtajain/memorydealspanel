import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";

import { listHomeReels } from "@/server/services/reels";
import { INSTAGRAM_HANDLE, INSTAGRAM_PROFILE_URL, type StorefrontReel } from "@/lib/reels";
import { catalogImageUrl } from "@/lib/image-loader";
import { Rail } from "@/components/storefront/Rail";
import { cn } from "@/lib/utils";

/**
 * ReelsRail — the home page's "Reels" shelf: the page's one DARK feature
 * panel, a row of 9:16 posters that open the full-screen /reels feed at that
 * clip.
 *
 * SERVER component, no cookies, no headers: it reads through listHomeReels
 * (price-free, fails to []) and renders NOTHING when no reel is live, so the
 * ISR home page is byte-identical until the owner uploads the first clip.
 * Posters are plain images through the resizer — the rail carries no <video>,
 * so the home page never downloads a byte of footage.
 */
export async function ReelsRail({ className }: { className?: string }) {
  const reels = await listHomeReels();
  if (reels.length === 0) return null;

  return (
    <section
      aria-labelledby="home-reels"
      className={cn(
        "rounded-3xl bg-foreground p-4 text-background shadow-md ring-1 ring-foreground/10 md:p-6",
        className,
      )}
    >
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-background/60">
            From our Instagram
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="home-reels" className="font-heading text-2xl font-bold tracking-tight md:text-3xl">
              Reels
            </h2>
            <a
              href={INSTAGRAM_PROFILE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full text-sm font-medium text-background/60 outline-none transition-colors hover:text-background focus-visible:ring-3 focus-visible:ring-background/40"
            >
              @{INSTAGRAM_HANDLE}
            </a>
          </div>
        </div>
        <Link
          href="/reels"
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-background/10 px-4 text-sm font-semibold text-background outline-none ring-1 ring-background/15 transition-[background-color,transform] duration-150 hover:bg-background/20 focus-visible:ring-3 focus-visible:ring-background/40 active:scale-[0.98]"
        >
          See all
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      <Rail
        ariaLabel="Reels"
        listClassName="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {reels.map((reel, index) => (
          <li key={reel.id} className="md-reveal shrink-0 snap-start">
            <ReelTile reel={reel} priority={index < 2} />
          </li>
        ))}
        <li className="shrink-0 snap-start">
          <Link
            href="/reels"
            className="flex aspect-[9/16] w-32 flex-col items-center justify-center gap-3 rounded-2xl bg-background/5 text-background outline-none ring-1 ring-background/15 transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-background/10 focus-visible:ring-3 focus-visible:ring-background/40 active:scale-[0.98] md:w-40"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-background text-foreground">
              <ArrowRight className="size-5" aria-hidden />
            </span>
            <span className="text-sm font-semibold">See all</span>
          </Link>
        </li>
      </Rail>
    </section>
  );
}

function ReelTile({ reel, priority }: { reel: StorefrontReel; priority: boolean }) {
  const poster = reel.posterUrl;
  return (
    <Link
      href={`/reels?r=${encodeURIComponent(reel.id)}`}
      aria-label={`Play reel: ${reel.caption}`}
      className="group relative block aspect-[9/16] w-32 overflow-hidden rounded-2xl bg-neutral-900 text-white outline-none ring-1 ring-white/10 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-3 focus-visible:ring-background/40 active:scale-[0.98] md:w-40"
    >
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={catalogImageUrl(poster, 256)}
          srcSet={`${catalogImageUrl(poster, 256)} 256w, ${catalogImageUrl(poster, 384)} 384w`}
          sizes="(min-width: 768px) 10rem, 8rem"
          alt=""
          draggable={false}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,var(--color-neutral-700),var(--color-neutral-950)_70%)]"
        />
      )}

      {/* Play glyph: subtle at rest, confident on hover. */}
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-black shadow-md transition-transform duration-200 group-hover:scale-110"
      >
        <Play className="ml-0.5 size-5 fill-black" />
      </span>

      {/* Scrim + caption (+ product mini-chip) — never clipped, two lines max. */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
      />
      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-2.5">
        {reel.product ? (
          <span className="inline-flex max-w-full items-center gap-1.5 self-start rounded-full bg-white/95 py-0.5 pl-0.5 pr-2 text-[10px] font-semibold text-black">
            {reel.product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={catalogImageUrl(reel.product.imageUrl, 48)}
                alt=""
                width={18}
                height={18}
                loading="lazy"
                decoding="async"
                className="size-[18px] shrink-0 rounded-full bg-white object-contain mix-blend-multiply"
              />
            ) : (
              <span className="size-[18px] shrink-0 rounded-full bg-black/10" />
            )}
            <span className="truncate">{reel.product.name}</span>
          </span>
        ) : null}
        <span className="line-clamp-2 text-xs font-medium leading-snug text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]">
          {reel.caption}
        </span>
      </span>
    </Link>
  );
}
