import Link from "next/link";
import { ChevronRight, Heart, Package, ShoppingCart } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * AccountLinksPanel — the customer's quick links to their Cart, Orders and
 * saved products, rendered on the account overview.
 *
 * Server component (no interactivity beyond navigation). Carries NO price — the
 * cart link shows only a unit-count bubble, never an amount. The Cart row is
 * rendered only when the customer can order (`canOrder`, i.e. approved + live
 * grant); a pending/expired customer still sees Orders + Saved.
 */
export interface AccountLinksPanelProps {
  /** Sum of units in the cart (badge). Only meaningful when `canOrder`. */
  cartCount: number;
  /** Whether price access is live — gates the cart entry point. */
  canOrder: boolean;
}

interface LinkRow {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Optional count bubble. */
  count?: number;
}

export function AccountLinksPanel({ cartCount, canOrder }: AccountLinksPanelProps) {
  const rows: LinkRow[] = [
    ...(canOrder
      ? [
          {
            href: "/account/cart",
            label: "Your cart",
            description: "Review items and place a purchase request",
            icon: ShoppingCart,
            count: cartCount > 0 ? cartCount : undefined,
          } satisfies LinkRow,
        ]
      : []),
    {
      href: "/account/orders",
      label: "Your orders",
      description: "Track the status of past purchase requests",
      icon: Package,
    },
    {
      href: "/account/wishlist",
      label: "Saved products",
      description: "Products you've hearted for later",
      icon: Heart,
    },
  ];

  return (
    <nav
      aria-label="Account sections"
      className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm ring-1 ring-foreground/5"
    >
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.href}>
            <Link
              href={row.href}
              className={cn(
                "group flex items-center gap-4 px-6 py-4 outline-none transition-colors",
                "hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
              )}
            >
              <span className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                <row.icon aria-hidden className="size-5" />
                {typeof row.count === "number" ? (
                  <span
                    aria-hidden
                    className="absolute -top-1 -right-1 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.625rem] font-semibold leading-5 text-primary-foreground tabular-nums"
                  >
                    {row.count > 99 ? "99+" : row.count}
                  </span>
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">
                  {row.label}
                  {typeof row.count === "number" ? (
                    <span className="sr-only"> ({row.count} items)</span>
                  ) : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {row.description}
                </span>
              </span>
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
