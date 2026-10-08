import { ShieldCheck, ReceiptIndianRupee, MessageCircle, Store } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { CONTACT } from "@/lib/constants";

/**
 * TrustStrip (home) — four compact facts, each TRUE of this shop today and
 * already stated elsewhere on the site (TrustRow on the PDP, About, FAQ,
 * the contact constants). No numbers we cannot back, no warranty/returns
 * claims the shop does not make. Pure server component, price-free, ISR-safe.
 *
 * Not to be confused with components/access/TrustStrip, the per-viewer status
 * line in the shell — this one is the same for every visitor.
 */

interface Fact {
  icon: LucideIcon;
  title: string;
  detail: string;
}

const FACTS: Fact[] = [
  {
    icon: ShieldCheck,
    title: "Approved shops only",
    detail: "Retailers are verified before prices open.",
  },
  {
    icon: ReceiptIndianRupee,
    title: "Wholesale billing",
    detail: "Trade rates on approval, in bulk quantities.",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp enquiries",
    detail: "Send your list and talk to a person.",
  },
  {
    icon: Store,
    title: "Shop in Faridabad",
    detail: `HUDA Market, Sector 15 · ${CONTACT.hours}`,
  },
];

export function TrustStrip() {
  return (
    <ul
      aria-label="Why retailers buy here"
      className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-0 md:divide-x md:divide-foreground/5 md:rounded-2xl md:bg-card md:p-1 md:shadow-xs md:ring-1 md:ring-foreground/5"
    >
      {FACTS.map((fact) => (
        <li
          key={fact.title}
          // Phones: a compact icon + title row (the detail line is md+ only)
          // so the four facts cost ~2 short rows and categories stay on the
          // first screen.
          className="md-reveal flex items-center gap-2.5 rounded-2xl bg-card px-3 py-2.5 ring-1 ring-foreground/5 md:items-start md:gap-3 md:rounded-none md:bg-transparent md:px-4 md:py-3 md:ring-0"
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary md:size-9"
            aria-hidden
          >
            <fact.icon className="size-4 md:size-4.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] leading-tight font-semibold text-foreground">
              {fact.title}
            </p>
            <p className="mt-1 hidden line-clamp-2 text-xs leading-snug text-pretty text-muted-foreground md:block">
              {fact.detail}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
