import { Wallet, PackageSearch, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * ValueProps — a compact reassurance row (wholesale pricing, wide range, fast
 * enquiry). Static, price-free, ISR-safe server component.
 */

interface Prop {
  icon: LucideIcon;
  title: string;
  description: string;
}

const PROPS: Prop[] = [
  {
    icon: Wallet,
    title: "Wholesale pricing",
    description: "Trade rates unlocked the moment you're approved.",
  },
  {
    icon: PackageSearch,
    title: "Wide range",
    description: "Cases, chargers, cables, audio and more in one place.",
  },
  {
    icon: Zap,
    title: "Fast enquiry",
    description: "Build an enquiry in a tap and hear back quickly.",
  },
];

export function ValueProps() {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {PROPS.map((prop) => (
        <li
          key={prop.title}
          className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-sm"
        >
          <span
            className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"
            aria-hidden
          >
            <prop.icon className="size-5" />
          </span>
          <h3 className="mt-1 text-sm font-semibold text-foreground">
            {prop.title}
          </h3>
          <p className="text-xs text-muted-foreground text-pretty">
            {prop.description}
          </p>
        </li>
      ))}
    </ul>
  );
}
