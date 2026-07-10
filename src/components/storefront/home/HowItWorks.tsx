import { Search, SendHorizonal, BadgeCheck, IndianRupee } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * HowItWorks — the four-step onboarding strip:
 *   Browse → Request access → Approved → See prices.
 *
 * Carries no data and no prices, so it is a pure server component and safe on
 * the ISR home shell. Chevrons between steps are decorative and hidden from AT;
 * the ordered list conveys the sequence semantically.
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
    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {STEPS.map((step, index) => (
        <li
          key={step.title}
          className="relative flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
        >
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            aria-hidden
          >
            <step.icon className="size-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-sm font-semibold text-foreground">
                {step.title}
              </h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground text-pretty">
              {step.description}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
