"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Share2, ShoppingBag } from "lucide-react";

import type { StorefrontReel } from "@/lib/reels";
import { INSTAGRAM_HANDLE, INSTAGRAM_PROFILE_URL } from "@/lib/reels";
import { catalogImageUrl } from "@/lib/image-loader";
import { hapticTap } from "@/lib/haptics";
import { cn } from "@/lib/utils";

import { InstagramGlyph } from "./InstagramGlyph";

/**
 * ReelActions — everything around a clip that is not the clip.
 *
 * Two arrangements of the same four things (caption, "Shop this", Instagram,
 * Share):
 *
 *  - `overlay` (phones): the Instagram arrangement. A right-hand rail of round
 *    buttons the thumb already knows, caption + product chip bottom-left over
 *    a gradient scrim. Everything here is `pointer-events-auto` inside a
 *    `pointer-events-none` layer, so a tap on empty frame still reaches the
 *    clip's pause toggle underneath.
 *  - `column` (desktop stage): the same content as a calm side column beside
 *    the player — caption at reading size, product card, pill buttons.
 *
 * PRICE GATE: the product chip is image + name only. The price is read on
 * /p/{slug} like everywhere else.
 */

export type ReelActionsLayout = "overlay" | "column";

export function reelShareUrl(reelId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/reels?r=${encodeURIComponent(reelId)}`;
}

type CopyState = "idle" | "copied" | "failed";

/** Share with the system sheet; fall back to copying the link. */
function useShare(reel: StorefrontReel) {
  const [copy, setCopy] = React.useState<CopyState>("idle");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const flash = (state: CopyState) => {
    setCopy(state);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopy("idle"), 2200);
  };

  const share = async () => {
    hapticTap();
    const url = reelShareUrl(reel.id);
    const title = reel.caption;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Cancelled or refused. A cancel is not a request to copy; a refusal
        // (desktop browsers without a share target) is — tell them apart by
        // whether a clipboard exists, and copy only then.
        if (!navigator.clipboard) return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      flash("copied");
    } catch {
      flash("failed");
    }
  };

  return { share, copy };
}

export function ReelActions({
  reel,
  layout,
  index,
  total,
  className,
}: {
  reel: StorefrontReel;
  layout: ReelActionsLayout;
  /** Position in the feed — shown as "3 / 12" on the desktop column. */
  index?: number;
  total?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const { share, copy } = useShare(reel);
  const instagramHref = reel.instagramUrl ?? INSTAGRAM_PROFILE_URL;

  const copyNotice =
    copy === "copied" ? "Link copied" : copy === "failed" ? "Couldn't copy the link" : null;

  if (layout === "column") {
    return (
      <div className={cn("flex flex-col gap-6 text-white", className)}>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
            {typeof index === "number" && typeof total === "number"
              ? `Reel ${index + 1} of ${total}`
              : "Reel"}
            <span className="mx-2 text-white/30">·</span>@{INSTAGRAM_HANDLE}
          </p>
          <p className="mt-3 text-lg font-medium leading-snug tracking-tight text-white md:text-xl">
            {reel.caption}
          </p>
        </div>

        {reel.product ? <ProductCard product={reel.product} /> : null}

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={instagramHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={hapticTap}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-black outline-none transition-[transform,background-color] duration-150 hover:bg-white/90 focus-visible:ring-3 focus-visible:ring-white/60 active:scale-[0.98]"
          >
            <InstagramGlyph className="size-4" />
            View on Instagram
            <ArrowUpRight className="size-4 opacity-60" aria-hidden />
          </a>
          <button
            type="button"
            onClick={share}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-5 text-sm font-semibold text-white ring-1 ring-white/15 outline-none transition-[transform,background-color] duration-150 hover:bg-white/15 focus-visible:ring-3 focus-visible:ring-white/60 active:scale-[0.98]"
          >
            {copy === "copied" ? <Check className="size-4" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
            {copy === "copied" ? "Copied" : "Share"}
          </button>
        </div>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-white/60">
          {copyNotice}
        </p>
      </div>
    );
  }

  // ——— overlay (phones) ———
  return (
    <div className={cn("absolute inset-0 flex flex-col justify-end", className)}>
      {/* Scrim for legibility — bottom half, stronger at the very bottom. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/80 via-black/40 to-transparent"
      />

      {/* Right rail — the thumb's column. Sits above the caption block so the
          two never overlap, and clear of the mute button at the top. */}
      <div className="pointer-events-auto absolute bottom-28 right-2 flex flex-col items-center gap-4">
        <RailButton href={instagramHref} label="Instagram" icon={<InstagramGlyph className="size-6" />} />
        <RailButton
          onClick={share}
          label={copy === "copied" ? "Copied" : "Share"}
          icon={
            copy === "copied" ? (
              <Check className="size-6" aria-hidden />
            ) : (
              <Share2 className="size-6" aria-hidden />
            )
          }
        />
      </div>

      {/* Caption block — bottom-left, room left for the rail. */}
      <div className="pointer-events-auto relative flex flex-col gap-3 px-4 pb-5 pr-20">
        {reel.product ? <ProductChip product={reel.product} /> : null}
        <button
          type="button"
          onClick={() => {
            hapticTap();
            setExpanded((e) => !e);
          }}
          aria-expanded={expanded}
          className="block min-h-11 w-full text-left outline-none focus-visible:ring-3 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black/0 rounded-md"
        >
          <span
            className={cn(
              "block text-[15px] font-medium leading-snug text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]",
              expanded ? "" : "line-clamp-2",
            )}
          >
            {reel.caption}
          </span>
          {!expanded && reel.caption.length > 70 ? (
            <span className="mt-0.5 block text-xs font-medium text-white/60">more</span>
          ) : null}
        </button>
        <p role="status" aria-live="polite" className="sr-only">
          {copyNotice}
        </p>
        {copyNotice ? (
          <span
            aria-hidden
            className="absolute bottom-full left-4 mb-2 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black shadow-lg"
          >
            {copy === "copied" ? <Check className="size-3.5" /> : null}
            {copyNotice}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RailButton({
  href,
  onClick,
  label,
  icon,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  const className =
    "inline-flex size-11 items-center justify-center rounded-full bg-black/45 text-white outline-none backdrop-blur-sm transition-[background-color,transform] duration-150 hover:bg-black/60 focus-visible:ring-3 focus-visible:ring-white/60 active:scale-90";
  return (
    <span className="flex flex-col items-center gap-1">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={hapticTap}
          aria-label={`${label} — opens in a new tab`}
          className={className}
        >
          {icon}
        </a>
      ) : (
        <button type="button" onClick={onClick} aria-label={label} className={className}>
          {icon}
        </button>
      )}
      <span aria-hidden className="text-[11px] font-medium leading-none text-white/90 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
        {label}
      </span>
    </span>
  );
}

/** Phone chip: thumbnail + name in one pill, the shop's product page a tap away. */
function ProductChip({ product }: { product: NonNullable<StorefrontReel["product"]> }) {
  return (
    <Link
      href={`/p/${product.slug}`}
      onClick={hapticTap}
      className="inline-flex max-w-full items-center gap-2 self-start rounded-full bg-white/95 py-1 pl-1 pr-3.5 text-black shadow-lg outline-none ring-1 ring-black/5 transition-transform duration-150 focus-visible:ring-3 focus-visible:ring-white/60 active:scale-[0.97]"
    >
      <ProductThumb product={product} size={36} className="size-9 rounded-full" />
      <span className="min-w-0">
        <span className="block text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-black/50">
          Shop this
        </span>
        <span className="mt-0.5 block max-w-[52vw] truncate text-sm font-semibold leading-tight">
          {product.name}
        </span>
      </span>
    </Link>
  );
}

/** Desktop card: more air, same destination. */
function ProductCard({ product }: { product: NonNullable<StorefrontReel["product"]> }) {
  return (
    <Link
      href={`/p/${product.slug}`}
      onClick={hapticTap}
      className="group flex items-center gap-4 rounded-2xl bg-white/5 p-3 pr-4 outline-none ring-1 ring-white/10 transition-[background-color,transform] duration-150 hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-white/60 active:scale-[0.99]"
    >
      <ProductThumb product={product} size={64} className="size-16 rounded-xl" />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
          Shop this
        </span>
        <span className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-white">
          {product.name}
        </span>
      </span>
      <ArrowUpRight
        className="size-5 shrink-0 text-white/50 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        aria-hidden
      />
    </Link>
  );
}

function ProductThumb({
  product,
  size,
  className,
}: {
  product: NonNullable<StorefrontReel["product"]>;
  size: number;
  className?: string;
}) {
  if (!product.imageUrl) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center bg-muted text-muted-foreground", className)}>
        <ShoppingBag className="size-4" aria-hidden />
      </span>
    );
  }
  return (
    <span className={cn("block shrink-0 overflow-hidden bg-white", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={catalogImageUrl(product.imageUrl, size * 2)}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="h-full w-full object-contain p-0.5 mix-blend-multiply"
      />
    </span>
  );
}
