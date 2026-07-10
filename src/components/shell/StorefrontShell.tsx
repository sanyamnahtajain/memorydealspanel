"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { CircleUserRound, Search } from "lucide-react"
import { motion, useReducedMotion, type Transition } from "motion/react"

import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { TabBadge } from "@/components/shell/TabBadge"
import { Logo } from "@/components/brand/Logo"
import { StorefrontFooter } from "@/components/shell/StorefrontFooter"
import { SearchOverlay } from "@/components/storefront/SearchOverlay"
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

export interface StorefrontShellProps {
  children: React.ReactNode
  /** Badge counts keyed by nav href, e.g. `{ "/account": 1 }`. */
  badges?: NavBadges
}

/**
 * Storefront app shell (light surface).
 *
 * - Sticky header that condenses on scroll (logo + search / account actions).
 * - Mobile: fixed bottom tab bar with a spring-animated active indicator.
 * - Desktop: inline top nav instead of bottom tabs.
 * - Safe-area padding on both the header and the tab bar.
 */
export function StorefrontShell({ children, badges }: StorefrontShellProps) {
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

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* ——— Sticky condensing header ——— */}
      <header
        className={cn(
          "sticky top-0 z-40 border-b bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur supports-backdrop-filter:bg-background/75 transition-colors duration-200",
          condensed ? "border-border shadow-xs" : "border-transparent"
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

          {/* Desktop top nav (replaces bottom tabs) */}
          <nav aria-label="Primary" className="ml-6 hidden md:block">
            <ul className="flex items-center gap-1">
              {storefrontNav.map((item) => {
                const active = isNavItemActive(item, pathname)
                const count = badges?.[item.href]
                return (
                  <li key={item.href} className="relative">
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex min-h-11 items-center rounded-full px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
                        active
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="storefront-desktop-active"
                          transition={spring}
                          className="absolute inset-1 rounded-full bg-muted"
                          aria-hidden
                        />
                      )}
                      <span className="relative">
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

          <div className="ml-auto flex items-center gap-0.5">
            <ThemeToggle variant="compact" className="mr-1 hidden sm:inline-flex" />
            <Tooltip content="Search">
              <button
                type="button"
                onClick={openSearch}
                aria-label="Search"
                aria-haspopup="dialog"
                aria-expanded={searchOpen}
                className={cn(
                  "inline-flex size-11 items-center justify-center rounded-full outline-none transition-[background-color,color,transform] duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-90",
                  searchOpen || isNavItemActive(storefrontNav[2], pathname)
                    ? "bg-muted text-foreground"
                    : "text-foreground/70 hover:text-foreground",
                )}
              >
                <Search className="size-5" aria-hidden />
              </button>
            </Tooltip>
            <HeaderIconLink
              href="/account"
              label="Account"
              active={isNavItemActive(storefrontNav[3], pathname)}
            >
              <span className="relative flex items-center justify-center">
                <CircleUserRound className="size-5" aria-hidden />
                <TabBadge count={badges?.["/account"]} label="account updates" />
              </span>
            </HeaderIconLink>
          </div>
        </div>
      </header>

      {/* ——— Content ——— */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-8 md:px-6 md:pb-12">
        {children}
      </main>

      {/* ——— Footer (clears the fixed mobile tab bar) ——— */}
      <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <StorefrontFooter />
      </div>

      {/* ——— Mobile bottom tab bar ——— */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-backdrop-filter:bg-background/85 md:hidden"
      >
        <ul className="grid grid-cols-4">
          {storefrontNav.map((item) => {
            const active = isNavItemActive(item, pathname)
            const count = badges?.[item.href]
            const Icon = item.icon
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className="group relative flex min-h-14 flex-col items-center justify-center gap-1 outline-none focus-visible:bg-muted/60"
                >
                  <span className="relative flex h-8 w-14 items-center justify-center transition-transform duration-150 ease-out group-active:scale-90">
                    {active && (
                      <motion.span
                        layoutId="storefront-tab-active"
                        transition={spring}
                        className="absolute inset-0 rounded-full bg-primary/10"
                        aria-hidden
                      />
                    )}
                    <Icon
                      className={cn(
                        "relative size-5 transition-colors duration-150",
                        active ? "text-primary" : "text-muted-foreground"
                      )}
                      strokeWidth={active ? 2.3 : 2}
                      aria-hidden
                    />
                    <TabBadge count={count} label={`${item.label} updates`} />
                  </span>
                  <span
                    className={cn(
                      "text-[11px] leading-none font-medium transition-colors duration-150",
                      active ? "text-primary" : "text-muted-foreground"
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
        className={cn(
          "inline-flex size-11 items-center justify-center rounded-full outline-none transition-[background-color,color,transform] duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-90",
          active ? "bg-muted text-foreground" : "text-foreground/70 hover:text-foreground"
        )}
      >
        {children}
      </Link>
    </Tooltip>
  )
}
