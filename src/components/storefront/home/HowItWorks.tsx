import { ArrowRight } from "lucide-react";

import { HapticLink } from "./HapticLink";

/**
 * HowItWorks — the four-step onboarding explainer:
 *   Browse → Request access → Approved → See prices.
 *
 * The page's ONE dark feature panel: near-black surface (md-panel-dark —
 * a local section, not a theme switch), big numerals in muted contrast, a
 * 2×2 grid on phones / 4 columns from md, and a single "Request access" CTA
 * pointing at the existing /account/request-access route.
 *
 * Carries no data and no prices, so it is a pure server component and safe on
 * the ISR home shell. Owns its own heading (id "home-how") so the page can
 * label the section with it. The ordered list conveys the sequence.
 */

interface Step {
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    title: "Browse",
    description: "Explore the full catalog of mobile accessories.",
  },
  {
    title: "Request access",
    description: "Send a quick request with your shop details.",
  },
  {
    title: "Get approved",
    description: "We verify and approve your retailer account.",
  },
  {
    title: "See prices",
    description: "Unlock live wholesale pricing everywhere.",
  },
];

const REQUEST_ACCESS_HREF = "/account/request-access";

export function HowItWorks() {
  return (
    <div className="md-panel-dark relative overflow-hidden rounded-3xl px-5 py-7 md:px-10 md:py-10">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-10">
        <div className="max-w-xl">
          <p className="text-[11px] leading-4 font-semibold tracking-[0.18em] text-background/55 uppercase">
            How it works
          </p>
          <h2
            id="home-how"
            className="mt-2 font-heading text-2xl font-bold tracking-tight text-balance md:text-3xl"
          >
            From first look to trade prices in four steps.
          </h2>
          <p className="mt-2 text-sm text-pretty text-background/65 md:text-[15px]">
            Browse freely. Prices open once your shop is approved.
          </p>
        </div>
        <HapticLink
          href={REQUEST_ACCESS_HREF}
          prefetch={false}
          className="group inline-flex min-h-12 w-fit shrink-0 items-center gap-2 rounded-full bg-background px-6 text-sm font-semibold text-foreground outline-none transition-[transform,background-color] duration-200 hover:bg-background/90 focus-visible:ring-3 focus-visible:ring-background/40 active:scale-[0.97]"
        >
          Request access
          <ArrowRight
            className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden
          />
        </HapticLink>
      </div>

      <ol className="mt-8 grid grid-cols-2 gap-x-5 gap-y-7 md:mt-10 md:grid-cols-4 md:gap-x-8">
        {STEPS.map((step, index) => (
          <li key={step.title} className="md-reveal min-w-0">
            <span
              className="block font-heading text-4xl leading-none font-bold tracking-tighter text-background/20 tabular-nums md:text-5xl"
              aria-hidden
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="mt-3 block h-px w-8 bg-background/20" aria-hidden />
            <h3 className="mt-3 text-sm font-semibold text-background md:text-base">
              {step.title}
            </h3>
            <p className="mt-1 text-xs leading-snug text-pretty text-background/60 md:text-sm">
              {step.description}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
