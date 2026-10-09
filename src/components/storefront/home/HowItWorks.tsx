import {
  ArrowRight,
  BadgeCheck,
  IndianRupee,
  Search,
  SendHorizonal,
  type LucideIcon,
} from "lucide-react";

import { HapticLink } from "./HapticLink";

/**
 * HowItWorks — the four-step onboarding explainer:
 *   Browse → Request access → Approved → See prices.
 *
 * A plain bordered card in the house style: icon badge + step number, a 2×2
 * grid on phones / 4 columns from md, and a single solid "Request access"
 * CTA pointing at the existing /account/request-access route.
 *
 * Carries no data and no prices, so it is a pure server component and safe on
 * the ISR home shell. Owns its own heading (id "home-how") so the page can
 * label the section with it. The ordered list conveys the sequence.
 */

interface Step {
  icon: LucideIcon;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    icon: Search,
    title: "Browse",
    description: "Explore the full catalog of mobile accessories.",
  },
  {
    icon: SendHorizonal,
    title: "Request access",
    description: "Send a quick request with your shop details.",
  },
  {
    icon: BadgeCheck,
    title: "Get approved",
    description: "We verify and approve your retailer account.",
  },
  {
    icon: IndianRupee,
    title: "See prices",
    description: "Unlock live wholesale pricing everywhere.",
  },
];

const REQUEST_ACCESS_HREF = "/account/request-access";

export function HowItWorks() {
  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-6 md:px-8 md:py-8">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-10">
        <div className="max-w-xl">
          <h2
            id="home-how"
            className="font-heading text-xl font-bold tracking-tight text-balance text-foreground md:text-2xl"
          >
            How it works
          </h2>
          <p className="mt-1 text-sm text-pretty text-muted-foreground">
            Browse freely. Prices open once your shop is approved.
          </p>
        </div>
        <HapticLink
          href={REQUEST_ACCESS_HREF}
          prefetch={false}
          className="group inline-flex min-h-11 w-fit shrink-0 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm outline-none transition-[transform,background-color] duration-200 hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
        >
          Request access
          <ArrowRight
            className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden
          />
        </HapticLink>
      </div>

      <ol className="mt-6 grid grid-cols-2 gap-x-5 gap-y-6 md:mt-8 md:grid-cols-4 md:gap-x-8">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.title} className="md-reveal min-w-0">
              <div className="flex items-center gap-2.5">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                  aria-hidden
                >
                  <Icon className="size-4.5" />
                </span>
                <span
                  className="font-heading text-sm font-bold text-muted-foreground tabular-nums"
                  aria-hidden
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-foreground md:text-[15px]">
                {step.title}
              </h3>
              <p className="mt-1 text-xs leading-snug text-pretty text-muted-foreground md:text-sm">
                {step.description}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
