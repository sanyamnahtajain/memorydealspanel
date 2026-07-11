import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";

import { FadeUp } from "@/components/motion/primitives";

/**
 * Closing conversion band — the last nudge for an unapproved visitor to request
 * trade-price access. Price-free, token-styled, ISR-safe.
 */
export function HomeCTA() {
  return (
    <FadeUp>
      <section className="relative isolate overflow-hidden rounded-3xl border border-border bg-linear-to-br from-primary/15 via-card to-card px-6 py-10 text-center shadow-sm md:px-10 md:py-14">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 left-1/2 size-64 -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
        />
        <div className="relative mx-auto max-w-xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <LockKeyhole className="size-3.5" aria-hidden />
            Prices unlock on approval
          </span>
          <h2 className="mt-4 font-heading text-2xl font-bold tracking-tight text-balance text-foreground md:text-3xl">
            Ready to see wholesale prices?
          </h2>
          <p className="mt-3 text-pretty text-muted-foreground">
            Share your business details once. After a quick review, live trade
            pricing unlocks across the whole catalogue — and you can start placing
            orders.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/account/request-access"
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm outline-none transition-[background-color,transform] hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
            >
              Request price access
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/account/login"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-6 text-sm font-semibold text-foreground shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
            >
              I already have an account
            </Link>
          </div>
        </div>
      </section>
    </FadeUp>
  );
}
