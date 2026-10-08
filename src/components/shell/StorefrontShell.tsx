"use client"

import * as React from "react"
import { NoticeMarquee } from "@/components/storefront/NoticeMarquee";
import Link from "next/link"
import { usePathname } from "next/navigation"
import { CircleUserRound, Clapperboard, Search } from "lucide-react"
import { motion, useReducedMotion, type Transition } from "motion/react"

import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { TabBadge } from "@/components/shell/TabBadge"
import { Logo } from "@/components/brand/Logo"
import { IndependenceBadge } from "@/components/brand/IndependenceBadge"
import { StorefrontFooter } from "@/components/shell/StorefrontFooter"
import { AccessStatusBanner } from "@/components/access/AccessStatusBanner"
import { TrustStrip } from "@/components/access/TrustStrip"
import { SlabyPromoCard } from "@/components/slaby/SlabyPromoCard"
import { WishlistBadge } from "@/components/storefront/wishlist/WishlistBadge"
import { CartBadge } from "@/components/storefront/cart/CartBadge"
import { SearchOverlay } from "@/components/storefront/SearchOverlay"
import { PullToRefresh } from "@/components/pwa/PullToRefresh"
import { hapticTap } from "@/lib/haptics"
import { NotifyGate } from "@/components/notify/NotifyGate"
import { searchCategoryChips } from "@/components/storefront/search/actions"
import type { CategoryChip } from "@/components/storefront/search/types"
import {
  isNavItemActive,
  storefrontNav,
  type NavBadges,
} from "@/components/shell/nav"

const SNAPPY_SPRING: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 38,
  mass: 0.7,
}

/**
 * Layout metrics the rest of the storefront can size against. They are set
 * as inline CSS custom properties on the shell's root wrapper, so any
 * descendant (the reels feed, a sticky purchase bar, a bottom sheet) can read
 * them with `var(--md-tab-h)` / `var(--md-header-h)` instead of hard-coding
 * the numbers.
 *
 *  --md-tab-h     Height of the FIXED mobile bottom tab bar, EXCLUDING the
 *                 safe-area inset. Anything that must sit above the bar on a
 *                 phone uses `bottom: calc(var(--md-tab-h) + env(safe-area-inset-bottom))`.
 *                 The bar is `md:hidden`, so treat it as 0 on md+ yourself.
 *  --md-header-h  Height of the sticky header in its CONDENSED state (the
 *                 state it is in whenever the page has scrolled), EXCLUDING
 *                 the safe-area-top inset and the optional notice marquee.
 *
 * Keep these in step with the `h-12` / `min-h-14` classes below.
 */
export const SHELL_METRICS = {
  tabBarHeight: "3.5rem",
  condensedHeaderHeight: "3rem",
} as const

const SHELL_STYLE = {
  "--md-tab-h": SHELL_METRICS.tabBarHeight,
  "--md-header-h": SHELL_METRICS.condensedHeaderHeight,
} as React.CSSProperties

/** Shared look for every round icon button in the header action cluster. */
const HEADER_ICON =
  "relative inline-flex size-11 shrink-0 items-center md:size-10 justify-center rounded-full outline-none transition-[background-color,color,transform] duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-90"
const HEADER_ICON_ACTIVE = "bg-muted text-foreground"
const HEADER_ICON_IDLE = "text-foreground/70 hover:text-foreground"

function isReelsPath(pathname: string): boolean {
  return pathname === "/reels" || pathname.startsWith("/reels/")
}

/** Active-route check for a storefront destination, looked up by href (never by index). */
function isHrefActive(href: string, pathname: string): boolean {
  const item = storefrontNav.find((entry) => entry.href === href)
  return item ? isNavItemActive(item, pathname) : false
}

export interface StorefrontShellProps {
  /** Optional scrolling notice rendered ABOVE the header (NoticeMarquee). */
  topNotice?: string;
  children: React.ReactNode
  /** Badge counts keyed by nav href, e.g. `{ "/account": 1 }`. */
  badges?: NavBadges
  /**
   * Saved-products count for the current customer, resolved server-side and
   * threaded in so the header/tab Wishlist badge paints correctly on first
   * render. Undefined for anon (the heart entry point still links to the
   * wishlist page, which itself gates on login). Carries NO price.
   */
  wishlistCount?: number
  /**
   * Whether to show the Wishlist entry point at all. Defaults to true. Pass
   * false on surfaces where it's redundant (e.g. the wishlist page itself may
   * still show it — kept simple: always shown unless a page opts out).
   */
  showWishlist?: boolean
  /**
   * Cart item-count (sum of units) for the current APPROVED customer, resolved
   * server-side and threaded in so the header CartBadge paints correctly on
   * first render. UNDEFINED means "no cart entry point" — anon, admin, and
   * non-approved customers cannot cart, so the badge is not rendered for them.
   * Carries NO price.
   */
  cartCount?: number
}

/**
 * Storefront app shell (light surface).
 *
 * - Sticky header that condenses on scroll (logo + search / reels / account
 *   actions). Desktop adds inline nav pills with a sliding active indicator.
 * - Mobile: fixed bottom tab bar (exactly the 5 `storefrontNav` items) with a
 *   spring-animated active pill. Reels is an icon in the header, NOT a tab.
 * - Safe-area padding on both the header and the tab bar.
 * - Publishes `--md-tab-h` / `--md-header-h` (see SHELL_METRICS).
 */
export function StorefrontShell({
  children,
  badges,
  wishlistCount,
  showWishlist = true,
  cartCount,
  topNotice,
}: StorefrontShellProps) {
  const pathname = usePathname()
  const reducedMotion = useReducedMotion()
  const spring: Transition = reducedMotion ? { duration: 0 } : SNAPPY_SPRING
  const [condensed, setCondensed] = React.useState(false)

  // Full-screen search overlay, opened from the header search button. Category
  // chips are fetched lazily on first open (they carry no pricing) and cached.
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchCategories, setSearchCategories] = React.useState<CategoryChip[]>([])
  const chipsLoaded = React.useRef(false)

  const openSearch = React.useCallback(() => {
    setSearchOpen(true)
    if (chipsLoaded.current) return
    chipsLoaded.current = true
    searchCategoryChips()
      .then(setSearchCategories)
      .catch(() => {
        // Non-fatal: the overlay still works without chips. Allow a retry.
        chipsLoaded.current = false
      })
  }, [])

  React.useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(() => {
        setCondensed(window.scrollY > 24)
        ticking = false
      })
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  // Desktop affordance: ⌘K / Ctrl+K opens search from anywhere on the page.
  // Ignored while typing in a field so it never hijacks a form.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return
      e.preventDefault()
      openSearch()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [openSearch])

  const reelsActive = isReelsPath(pathname)

  return (
    <div
      className="flex min-h-dvh flex-col bg-background text-foreground"
      style={SHELL_STYLE}
      data-shell="storefront"
    >
      {topNotice ? <NoticeMarquee text={topNotice} /> : null}
      {/* ——— Sticky condensing header ——— */}
      <header
        className={cn(
          "sticky top-0 z-40 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl supports-backdrop-filter:bg-background/75 transition-shadow duration-200",
          condensed ? "shadow-[0_1px_0_0_var(--border)]" : "shadow-none"
        )}
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-6xl items-center gap-1 px-4 transition-[height] duration-200 ease-out md:px-6",
            condensed ? "h-12" : "h-16"
          )}
        >
          <Link
            href="/"
            className="-ml-1 flex min-h-11 items-center rounded-lg px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
            aria-label="The Memory Deals home"
          >
            <Logo
              size={condensed ? 28 : 34}
              withWordmark
              wordmarkClassName={cn(
                "hidden text-foreground transition-[font-size] duration-200 sm:inline",
                condensed ? "text-sm" : "text-base",
              )}
            />
          </Link>

          {/* Seasonal: compact animated tricolor beside the logo (self-gated
              to the Independence Day window; renders nothing otherwise). */}
          <IndependenceBadge className="ml-1.5" />

          {/* Desktop top nav (replaces bottom tabs). Account is intentionally
              omitted here — it's the person icon in the right-hand cluster on
              desktop (and a bottom tab on mobile), so listing it as a pill too
              would be a duplicate link. */}
          <nav aria-label="Primary" className="ml-6 hidden md:block">
            <ul className="flex items-center gap-0.5">
              {storefrontNav
                .filter((item) => item.href !== "/account")
                .map((item) => {
                const active = isNavItemActive(item, pathname)
                const count = badges?.[item.href]
                return (
                  <li key={item.href} className="relative">
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex min-h-10 items-center rounded-full px-4 text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
                        active
                          ? "text-background"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="storefront-desktop-active"
                          transition={spring}
                          className="absolute inset-x-0 inset-y-0.5 rounded-full bg-foreground shadow-sm"
                          aria-hidden
                        />
                      )}
                      <span className="relative z-10">
                        {item.label}
                        <TabBadge
                          count={count}
                          label={`${item.label} updates`}
                          className="-top-1.5 -right-4"
                        />
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* Action cluster — every button is a round target, 44px on phones
              (size-11) and size-10 from md, with a
              hover surface. Order: theme (sm+), search, reels, wishlist,
              cart, account. */}
          <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
            <ThemeToggle variant="compact" className="mr-1 hidden sm:inline-flex" />
            <Tooltip content="Search (⌘K)">
              <button
                type="button"
                onClick={openSearch}
                aria-label="Search"
                aria-haspopup="dialog"
                aria-expanded={searchOpen}
                className={cn(
                  HEADER_ICON,
                  searchOpen || isHrefActive("/search", pathname)
                    ? HEADER_ICON_ACTIVE
                    : HEADER_ICON_IDLE,
                )}
              >
                <Search className="size-5" aria-hidden />
              </button>
            </Tooltip>
            {/* Reels entry point — an icon on ALL widths (it is not one of the
                five bottom tabs). */}
            <HeaderIconLink href="/reels" label="Reels" active={reelsActive}>
              <Clapperboard className="size-5" aria-hidden />
            </HeaderIconLink>
            {showWishlist ? (
              <WishlistBadge
                initialCount={wishlistCount}
                className={cn(
                  "size-11 transition-[background-color,color,transform] active:scale-90 md:size-10",
                  pathname.startsWith("/account/wishlist") && HEADER_ICON_ACTIVE,
                )}
              />
            ) : null}
            {cartCount !== undefined ? (
              <CartBadge
                initialCount={cartCount}
                className={cn(
                  "size-11 transition-[background-color,color,transform] active:scale-90 md:size-10",
                  pathname.startsWith("/account/cart") && HEADER_ICON_ACTIVE,
                )}
              />
            ) : null}
            <HeaderIconLink
              href="/account"
              label="Account"
              active={isHrefActive("/account", pathname)}
            >
              <span className="relative flex items-center justify-center">
                <CircleUserRound className="size-5" aria-hidden />
                <TabBadge count={badges?.["/account"]} label="account updates" />
              </span>
            </HeaderIconLink>
          </div>
        </div>
      </header>

      {/* ——— Access status strip (renders nothing for anon/active) ——— */}
      <AccessStatusBanner />
      {/* Healthy-state counterpart: renders ONLY for "active", so the two
          share this slot and never show together. */}
      <TrustStrip />

      {/* ——— Content ——— */}
      {/* Bottom padding clears the FIXED mobile tab bar (--md-tab-h + safe
          area + breathing room) — the footer is desktop-only, so main owns it. */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(var(--md-tab-h)+1rem+env(safe-area-inset-bottom))] md:px-6 md:pb-12">
        {children}
      </main>

      {/* ——— Footer — desktop only; the app-like mobile view ends at the
          bottom tab bar (owner request: no footer on mobile). ——— */}
      <div className="hidden md:block">
        <StorefrontFooter />
        {/* Occasional "runs on Slaby" promo (owner-toggleable, self-gating,
            frequency-capped; never on cart/checkout paths). */}
        <SlabyPromoCard />
      </div>

      {/* Installed-app gesture: pull down from the top to refresh (no-op in a
          browser tab, which already has its own). */}
      <PullToRefresh />

      {/* ——— Mobile bottom tab bar ——— exactly the 5 storefrontNav items. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-foreground/8 bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl supports-backdrop-filter:bg-background/80 md:hidden"
      >
        <ul className="grid grid-cols-5">
          {storefrontNav.map((item) => {
            const active = isNavItemActive(item, pathname)
            const count = badges?.[item.href]
            const Icon = item.icon
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={hapticTap}
                  className="group relative flex min-h-14 flex-col items-center justify-center gap-0.5 outline-none focus-visible:bg-muted/60"
                >
                  <span className="relative flex h-8 w-16 items-center justify-center">
                    {active && (
                      <motion.span
                        layoutId="storefront-tab-active"
                        transition={spring}
                        className="absolute inset-0 rounded-full bg-primary/12"
                        aria-hidden
                      />
                    )}
                    <motion.span
                      className="relative flex items-center justify-center transition-transform duration-150 ease-out group-active:scale-90"
                      animate={{ scale: active ? 1.08 : 1 }}
                      transition={spring}
                    >
                      <Icon
                        className={cn(
                          "size-5 transition-colors duration-150",
                          active ? "text-primary" : "text-muted-foreground"
                        )}
                        strokeWidth={active ? 2.3 : 2}
                        fill={active ? "currentColor" : "none"}
                        fillOpacity={active ? 0.18 : 0}
                        aria-hidden
                      />
                    </motion.span>
                    <TabBadge count={count} label={`${item.label} updates`} />
                  </span>
                  <span
                    className={cn(
                      "text-[11px] leading-none transition-colors duration-150",
                      active ? "font-semibold text-primary" : "font-medium text-muted-foreground"
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* ——— Full-screen search overlay ——— */}
      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        categories={searchCategories}
      />

      {/* ——— Notification ask ———
          Sibling of the global <InstallPrompt /> (mounted in the root layout).
          Self-gating: it only appears when the usage algorithm says the moment
          is right, and it sits above the fixed mobile tab bar. */}
      <NotifyGate variant="storefront" />
    </div>
  )
}

function HeaderIconLink({
  href,
  label,
  active,
  children,
}: {
  href: string
  label: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip content={label}>
      <Link
        href={href}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(HEADER_ICON, active ? HEADER_ICON_ACTIVE : HEADER_ICON_IDLE)}
      >
        {children}
      </Link>
    </Tooltip>
  )
}
