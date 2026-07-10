import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Logo } from "@/components/brand/Logo";
import { APP_NAME, APP_TAGLINE, APP_SLOGAN } from "@/lib/constants";

/**
 * BrandStrip — the closing brand / tagline band using the real brand.
 *
 * Reuses the shared {@link Logo} mark, pairs it with the real tagline and
 * slogan from constants, and repeats the access CTA. Token-driven gradient,
 * no prices, ISR-safe server component.
 */
export function BrandStrip() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-border bg-linear-to-br from-primary/10 via-card to-card p-6 text-center shadow-sm md:p-10">
      <div className="mx-auto flex max-w-xl flex-col items-center">
        <Logo size={56} chip />
        <h2 className="mt-4 font-heading text-xl font-bold tracking-tight text-foreground md:text-2xl">
          {APP_NAME}
        </h2>
        <p className="mt-1 text-sm text-primary font-medium">{APP_SLOGAN}</p>
        <p className="mt-3 max-w-md text-sm text-muted-foreground text-pretty">
          {APP_TAGLINE}
        </p>
        <Link
          href="/account"
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm outline-none transition-[background-color,transform] hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
        >
          Request price access
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
