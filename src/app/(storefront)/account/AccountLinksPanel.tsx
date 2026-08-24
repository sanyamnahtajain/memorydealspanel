import Link from "next/link";
import {
  BellRing,
  ChevronRight,
  Heart,
  HelpCircle,
  Package,
  Palette,
  ShoppingCart,
  Store,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The account hub menu.
 *
 * Two halves, because the customer comes here for two different reasons:
 *
 *  1. TILES — the three things they open every visit (cart, orders, saved),
 *     each showing a live count so the page answers "do I have anything
 *     waiting?" before they tap anything. Big touch targets: most of this
 *     shop's customers are on a phone, one-handed, in a busy market.
 *
 *  2. ROWS — everything else, including jumps to the settings sections
 *     further down this same page. Those used to be reachable only by
 *     scrolling past several cards, so in practice nobody found them.
 *
 * Server component; navigation only. Carries NO price — the cart tile shows a
 * unit count, never an amount. The cart entry appears only when the customer
 * can actually order (`canOrder`); a pending or expired customer still gets
 * their orders, saved products and settings.
 */
export interface AccountLinksPanelProps {
  /** Sum of units in the cart. Only meaningful when `canOrder`. */
  cartCount: number;
  /** Orders this customer has placed, all time. */
  orderCount: number;
  /** Products saved for later. */
  savedCount: number;
  /** Whether price access is live — gates the cart entry point. */
  canOrder: boolean;
  /**
   * Whether the business/GST card is on the page. It only renders when the
   * seller has GST switched on, and a menu row that jumps nowhere is worse
   * than no row at all.
   */
  hasBusinessSection: boolean;
}

interface Tile {
  href: string;
  label: string;
  icon: LucideIcon;
  count: number;
  /** Shown under the count when it is zero, instead of a bare "0". */
  emptyHint: string;
}

interface Row {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export function AccountLinksPanel({
  cartCount,
  orderCount,
  savedCount,
  canOrder,
  hasBusinessSection,
}: AccountLinksPanelProps) {
  const tiles: Tile[] = [
    ...(canOrder
      ? [
          {
            href: "/account/cart",
            label: "Cart",
            icon: ShoppingCart,
            count: cartCount,
            emptyHint: "Empty",
          } satisfies Tile,
        ]
      : []),
    {
      href: "/account/orders",
      label: "Orders",
      icon: Package,
      count: orderCount,
      emptyHint: "None yet",
    },
    {
      href: "/account/wishlist",
      label: "Saved",
      icon: Heart,
      count: savedCount,
      emptyHint: "None yet",
    },
  ];

  // Hash links land on sections of THIS page (see the ids in page.tsx).
  const settingsRows: Row[] = [
    {
      href: "#account-alerts",
      label: "Alerts",
      description: "Choose what we tell you about",
      icon: BellRing,
    },
    ...(hasBusinessSection
      ? [
          {
            href: "#account-business",
            label: "Business details",
            description: "Your GST number and billing state",
            icon: Store,
          } satisfies Row,
        ]
      : []),
    {
      href: "#account-appearance",
      label: "Appearance",
      description: "Theme, text size and layout",
      icon: Palette,
    },
  ];

  const helpRows: Row[] = [
    {
      href: "/contact",
      label: "Help and contact",
      description: "Talk to us about an order or your account",
      icon: HelpCircle,
    },
  ];

  return (
    <div className="space-y-4">
      {/* ——— the three things they came for ——— */}
      <nav aria-label="Your shopping">
        <ul
          className={cn(
            "grid gap-2.5",
            tiles.length === 3 ? "grid-cols-3" : "grid-cols-2",
          )}
        >
          {tiles.map((tile) => (
            <li key={tile.href}>
              <Link
                href={tile.href}
                className={cn(
                  "group flex h-full flex-col items-center gap-1.5 rounded-2xl border border-border bg-card px-2 py-4 text-center outline-none",
                  "shadow-sm ring-1 ring-foreground/5 transition-colors",
                  "hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50",
                )}
              >
                <span className="relative inline-flex size-10 items-center justify-center rounded-full bg-muted text-foreground transition-transform group-hover:scale-105">
                  <tile.icon aria-hidden className="size-5" />
                  {tile.count > 0 ? (
                    <span
                      aria-hidden
                      className="absolute -top-1 -right-1 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.625rem] leading-5 font-semibold text-primary-foreground tabular-nums"
                    >
                      {tile.count > 99 ? "99+" : tile.count}
                    </span>
                  ) : null}
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {tile.label}
                </span>
                {/* A bare "0" reads as an error to a non-fluent reader; words
                    are clearer than a number nobody wants to see. */}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {tile.count > 0
                    ? `${tile.count} ${tile.count === 1 ? "item" : "items"}`
                    : tile.emptyHint}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* ——— settings on this page ——— */}
      <MenuGroup title="Settings" rows={settingsRows} label="Account settings" />

      {/* ——— help ——— */}
      <MenuGroup title="More" rows={helpRows} label="Help" />
    </div>
  );
}

function MenuGroup({
  title,
  rows,
  label,
}: {
  title: string;
  rows: Row[];
  label: string;
}) {
  return (
    <nav aria-label={label} className="space-y-1.5">
      <p className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm ring-1 ring-foreground/5">
        {rows.map((row) => (
          <li key={row.href}>
            <Link
              href={row.href}
              className={cn(
                "group flex items-center gap-3.5 px-4 py-3.5 outline-none transition-colors sm:px-5",
                "hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
              )}
            >
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                <row.icon aria-hidden className="size-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">
                  {row.label}
                </span>
                <span className="block text-xs leading-snug text-muted-foreground">
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
