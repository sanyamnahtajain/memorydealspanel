import Link from "next/link";
import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";

import { FadeUp } from "@/components/motion/primitives";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

/**
 * HomeHero — the landing hero.
 *
 * A price-free, ISR-safe banner: strong headline, subcopy and the two primary
 * CTAs ("Browse catalog" + "Request price access"). The background is built
 * purely from semantic tokens (gradient over `card`/`primary`) so it themes for
 * light + dark and never hardcodes a colour. Entrance is a single FadeUp, so it
 * stays a lightweight client boundary and honours reduced-motion for free.
 */
export function HomeHero() {
  return (
    <FadeUp>
      <section className="relative isolate mt-2 overflow-hidden rounded-3xl border border-border bg-linear-to-br from-primary/12 via-card to-card shadow-sm">
        {/* Decorative token-driven glow — purely cosmetic, hidden from AT. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-primary/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 size-72 rounded-full bg-accent/40 blur-3xl"
        />

        <div className="relative px-6 py-10 md:px-10 md:py-14">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
              <Sparkles className="size-3.5 text-primary" aria-hidden />
              {APP_NAME} — {APP_TAGLINE}
            </span>

            <h1 className="mt-4 font-heading text-3xl font-bold tracking-tight text-balance text-foreground md:text-5xl">
              Wholesale mobile accessories,
              <span className="text-primary"> priced for retailers.</span>
            </h1>

            <p className="mt-4 max-w-xl text-pretty text-muted-foreground md:text-lg">
              Browse the full range of cases, chargers, cables, audio and more.
              Get approved once to unlock live trade pricing across every
              product.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/search"
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm outline-none transition-[background-color,transform] hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
              >
                Browse catalog
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link
                href="/account"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-6 text-sm font-semibold text-foreground shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
              >
                <LockKeyhole className="size-4 text-primary" aria-hidden />
                Request price access
              </Link>
            </div>
          </div>
        </div>
      </section>
    </FadeUp>
  );
}
