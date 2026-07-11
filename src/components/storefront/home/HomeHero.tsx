import Link from "next/link";
import { ArrowRight, BadgeCheck, LockKeyhole, Sparkles } from "lucide-react";

import { FadeUp } from "@/components/motion/primitives";
import { Logo } from "@/components/brand/Logo";
import { APP_SLOGAN } from "@/lib/constants";
import { HeroSearch } from "./HeroSearch";

/**
 * HomeHero — the landing hero (price-free, ISR-safe).
 *
 * Two-column on desktop: the pitch + an integrated catalogue search + the two
 * primary CTAs on the left; a token-built "prices unlock on approval" visual on
 * the right that communicates the gated-wholesale model without any image asset.
 * Everything is semantic tokens, so it themes for light/dark and honours
 * reduced-motion via the single FadeUp wrapper.
 */
export function HomeHero({ suggestions = [] }: { suggestions?: string[] }) {
  return (
    <FadeUp>
      <section className="relative isolate mt-2 overflow-hidden rounded-3xl border border-border bg-linear-to-br from-primary/12 via-card to-card shadow-sm">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-primary/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 size-72 rounded-full bg-accent/40 blur-3xl"
        />

        <div className="relative grid items-center gap-8 px-6 py-10 md:grid-cols-[1.15fr_0.85fr] md:px-10 md:py-14 lg:gap-12">
          {/* ——— Left: pitch + search + CTAs ——— */}
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
              <Sparkles className="size-3.5 text-primary" aria-hidden />
              A hub of mobile accessories — {APP_SLOGAN}
            </span>

            <h1 className="mt-4 font-heading text-3xl font-bold tracking-tight text-balance text-foreground md:text-5xl">
              Wholesale mobile accessories,
              <span className="text-primary"> priced for retailers.</span>
            </h1>

            <p className="mt-4 max-w-xl text-pretty text-muted-foreground md:text-lg">
              Chargers, cables, power banks, audio, cases and more — from trusted
              brands. Get approved once to unlock live trade pricing across the
              entire catalogue.
            </p>

            <HeroSearch suggestions={suggestions} />

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/categories"
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm outline-none transition-[background-color,transform] hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
              >
                Browse catalogue
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link
                href="/account/request-access"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-6 text-sm font-semibold text-foreground shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
              >
                <LockKeyhole className="size-4 text-primary" aria-hidden />
                Request price access
              </Link>
            </div>

            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
              <BadgeCheck className="size-4 text-primary" aria-hidden />
              Trade-only pricing · GST optional · fast approval
            </p>
          </div>

          {/* ——— Right: "prices unlock on approval" visual ——— */}
          <div className="hidden md:block" aria-hidden>
            <div className="relative mx-auto max-w-xs">
              <div className="rotate-3 rounded-2xl border border-border bg-background p-4 shadow-lg">
                <div className="flex aspect-square items-center justify-center rounded-xl bg-muted">
                  <Logo size={92} />
                </div>
                <div className="mt-3 h-3 w-3/4 rounded-full bg-muted" />
                <div className="mt-2 flex items-center justify-between">
                  <div className="h-2.5 w-16 rounded-full bg-muted" />
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
                    <LockKeyhole className="size-3" />
                    See price
                  </span>
                </div>
              </div>
              <div className="absolute -bottom-5 -left-6 -rotate-6 rounded-2xl border border-border bg-background p-4 shadow-xl">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs font-medium text-muted-foreground">
                    Approved
                  </span>
                  <BadgeCheck className="size-4 text-primary" />
                </div>
                <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-foreground">
                  ₹499
                  <span className="ml-1 align-middle text-[11px] font-medium text-muted-foreground">
                    / unit
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </FadeUp>
  );
}
