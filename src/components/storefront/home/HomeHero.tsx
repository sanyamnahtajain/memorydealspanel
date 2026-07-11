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
          <div className="relative hidden md:block" aria-hidden>
            <div className="relative mx-auto w-full max-w-sm">
              {/* Catalogue product card (locked/gated state) */}
              <div className="rounded-3xl border border-border bg-card p-3 shadow-xl">
                <div className="relative flex aspect-[5/4] items-center justify-center overflow-hidden rounded-2xl bg-linear-to-br from-primary/15 via-muted to-accent/30">
                  <span className="absolute top-3 left-3 rounded-full bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur">
                    Power Banks
                  </span>
                  <Logo size={88} chip className="shadow-md" />
                </div>
                <div className="px-1.5 pt-4 pb-1">
                  <div className="h-2.5 w-2/3 rounded-full bg-muted" />
                  <div className="mt-2 h-2 w-2/5 rounded-full bg-muted/70" />
                  <div className="mt-4 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                      <LockKeyhole className="size-3.5 text-primary" />
                      See price
                    </span>
                    <span className="text-[11px] font-medium text-muted-foreground">
                      MOQ 10
                    </span>
                  </div>
                </div>
              </div>

              {/* Unlocked price chip — the "after approval" payoff */}
              <div className="absolute -right-4 -bottom-6 rounded-2xl border border-primary/30 bg-background p-4 shadow-2xl ring-1 ring-primary/10">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                  <BadgeCheck className="size-4" />
                  Approved
                </span>
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
