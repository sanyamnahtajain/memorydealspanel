import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface AttentionItem {
  key: string;
  label: string;
  /** Pre-formatted count. */
  value: string;
  href: string;
  icon: React.ReactNode;
  /** Accented when the count demands action. */
  urgent: boolean;
}

/**
 * "Needs attention" — the counts that mean work: requests to review, orders
 * to confirm, products out of stock, access expiring. One row of tappable
 * chips; on phones it scrolls sideways with the next chip peeking, so four
 * actions never cost four screens. Server component.
 */
export function AttentionStrip({ items }: { items: AttentionItem[] }) {
  return (
    <nav aria-label="Needs attention" className="-mx-4 sm:mx-0">
      <ul className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4 [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <li key={item.key} className="w-[12.5rem] shrink-0 snap-start sm:w-auto">
            <Link
              href={item.href}
              className={cn(
                "group flex min-h-[4.25rem] items-center gap-3 rounded-xl border px-3.5 py-3 outline-none transition-[background-color,border-color,transform] duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]",
                item.urgent
                  ? "border-primary/30 bg-primary/5 hover:bg-primary/10"
                  : "border-border bg-card hover:bg-muted/60",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
                  item.urgent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-tabular text-xl leading-none font-semibold text-foreground">
                  {item.value}
                </span>
                <span className="mt-1 line-clamp-2 block text-xs leading-snug text-muted-foreground">{item.label}</span>
              </span>
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
