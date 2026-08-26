import { Search, SendHorizonal, BadgeCheck, IndianRupee } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * HowItWorks — the four-step onboarding strip:
 *   Browse → Request access → Approved → See prices.
 *
 * Carries no data and no prices, so it is a pure server component and safe on
 * the ISR home shell. The ordered list conveys the sequence semantically.
 *
 * Deliberately QUIET: with the hero, value props and closing CTA gone, this
 * is the one explainer left for a pending visitor. It lives last on the page
 * as a single compact card, not four shouting tiles — the home page is a
 * working tool now, not a pitch.
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

export function HowItWorks() {
  return (
    <ol className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-3xl border border-border bg-card p-5 shadow-sm ring-1 ring-foreground/5 sm:grid-cols-2 lg:grid-cols-4">
      {STEPS.map((step, index) => (
        <li key={step.title} className="flex items-start gap-3">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            aria-hidden
          >
            <step.icon className="size-4" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[0.7rem] font-semibold text-muted-foreground tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-sm font-semibold text-foreground">
                {step.title}
              </h3>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
              {step.description}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
