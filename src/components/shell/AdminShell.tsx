"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useLinkStatus } from "next/link"
import { Bell, Ellipsis, Loader2, PanelLeft, PanelLeftClose } from "lucide-react"
import { motion, useReducedMotion, type Transition } from "motion/react"

import { cn } from "@/lib/utils"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Tooltip } from "@/components/ui/tooltip"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { SignOutButton } from "@/components/admin/SignOutButton"
import { TabBadge } from "@/components/shell/TabBadge"
import { Logo } from "@/components/brand/Logo"
import {
  adminMoreSections,
  adminNavSections,
  mobileAdminTabs,
  isNavItemActive,
  type NavBadges,
  type NavItem,
} from "@/components/shell/nav"

const SNAPPY_SPRING: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 38,
  mass: 0.7,
}

export interface AdminShellProps {
  children: React.ReactNode
  /** Page title rendered in the top bar (plain text or any node). */
  title?: React.ReactNode
  /** Count shown on the notification bell (animated on change). */
  notificationCount?: number
  /** Invoked when the notification bell is pressed. */
  onNotificationsClick?: () => void
  /** Badge counts keyed by nav href, e.g. `{ "/admin/requests": 5 }`. */
  badges?: NavBadges
}

/**
 * Admin app shell.
 *
 * The theme is driven globally by `<ThemeProvider>` on `<html>`. First-time
 * visitors always start in light; a user's Light/Dark choice via the header
 * `ThemeToggle` is persisted and honoured on every subsequent load.
 *
 * - Mobile: bottom tabs (Dashboard / Products / Requests / Customers) plus a
 *   "More" bottom sheet for Import / Trash / Settings.
 * - Desktop: collapsible sidebar with section labels and the full nav.
 * - Top bar with a page-title slot, a theme toggle, and a notification bell
 *   with an animated badge count.
 * - Content area owns its scrolling (`overflow-y-auto` + overscroll
 *   containment) so the chrome never moves.
 */
export function AdminShell({
  children,
  title,
  notificationCount,
  onNotificationsClick,
  badges,
}: AdminShellProps) {
  const pathname = usePathname()
  const reducedMotion = useReducedMotion()
  const spring: Transition = reducedMotion ? { duration: 0 } : SNAPPY_SPRING

  const [collapsed, setCollapsed] = React.useState(false)
  const [moreOpen, setMoreOpen] = React.useState(false)

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  const moreActive = adminMoreSections.some((section) =>
    section.items.some((item) => isNavItemActive(item, pathname))
  )

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {/* ——— Desktop sidebar ——— */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out md:flex",
          collapsed ? "w-16" : "w-60"
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center border-b border-sidebar-border",
            collapsed ? "justify-center px-0" : "px-4"
          )}
        >
          <Link
            href="/admin"
            aria-label="The Memory Deals admin home"
            className="flex min-h-11 items-center gap-2 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/50 active:scale-[0.97]"
          >
            <Logo size={28} chip />
            {!collapsed && (
              <span className="truncate font-heading text-sm font-bold tracking-tight">
                The Memory Deals
                <span className="ml-1.5 font-normal text-sidebar-foreground/60">
                  Admin
                </span>
              </span>
            )}
          </Link>
        </div>

        <nav aria-label="Admin" className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
          {adminNavSections.map((section, sectionIndex) => (
            <div key={section.label} className={cn(sectionIndex > 0 && "mt-6")}>
              {collapsed ? (
                <div
                  className="mx-2 mb-2 border-t border-sidebar-border"
                  aria-hidden
                />
              ) : (
                <p className="mb-1.5 px-3 text-[11px] font-medium tracking-wider text-sidebar-foreground/50 uppercase">
                  {section.label}
                </p>
              )}
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <SidebarNavLink
                    key={item.href}
                    item={item}
                    active={isNavItemActive(item, pathname)}
                    collapsed={collapsed}
                    count={badges?.[item.href]}
                    spring={spring}
                  />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-1 border-t border-sidebar-border p-3">
          <SignOutButton variant="sidebar" collapsed={collapsed} />
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className={cn(
              "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/70 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-3 focus-visible:ring-sidebar-ring/50 active:scale-[0.98]",
              collapsed && "justify-center px-0"
            )}
          >
            {collapsed ? (
              <PanelLeft className="size-5" aria-hidden />
            ) : (
              <>
                <PanelLeftClose className="size-5" aria-hidden />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* ——— Main column ——— */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="z-30 shrink-0 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-backdrop-filter:bg-background/85">
          <div className="flex h-14 items-center gap-3 px-4 md:px-6">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground md:hidden">
              M
            </span>
            <h1 className="min-w-0 truncate font-heading text-base font-semibold">
              {title}
            </h1>
            <ThemeToggle variant="compact" className="ml-auto" />
            <Tooltip
              content={
                notificationCount && notificationCount > 0
                  ? `${notificationCount} unread notification${notificationCount === 1 ? "" : "s"}`
                  : "Notifications"
              }
            >
              <button
                type="button"
                onClick={onNotificationsClick}
                aria-label={
                  notificationCount && notificationCount > 0
                    ? `Notifications (${notificationCount} unread)`
                    : "Notifications"
                }
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-foreground/70 outline-none transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-90"
              >
                <span className="relative flex items-center justify-center">
                  <Bell className="size-5" aria-hidden />
                  <TabBadge count={notificationCount} label="unread notifications" />
                </span>
              </button>
            </Tooltip>
          </div>
        </header>

        {/* Scroll-contained content area. Tagged so ScrollToTop resets it on
            route change (Next only resets the window, not nested scrollers). */}
        <main
          data-scroll-container
          className="flex-1 overflow-y-auto overscroll-contain"
        >
          <div className="mx-auto w-full max-w-7xl px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-6 md:pt-6 md:pb-8">
            {children}
          </div>
        </main>

        {/* ——— Mobile bottom tabs ——— */}
        <nav
          aria-label="Admin"
          className="shrink-0 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-backdrop-filter:bg-background/85 md:hidden"
        >
          <ul className="grid grid-cols-5">
            {mobileAdminTabs.map((item) => {
              const active = isNavItemActive(item, pathname)
              const Icon = item.icon
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className="group relative flex min-h-14 flex-col items-center justify-center gap-1 outline-none focus-visible:bg-muted/60"
                  >
                    <MobileTabIcon
                      icon={Icon}
                      active={active}
                      count={badges?.[item.href]}
                      label={item.label}
                      spring={spring}
                    />
                    <TabLabel active={active}>{item.label}</TabLabel>
                  </Link>
                </li>
              )
            })}

            {/* More — bottom sheet with the secondary nav */}
            <li>
              <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
                <SheetTrigger
                  aria-label="More"
                  className="group relative flex min-h-14 w-full flex-col items-center justify-center gap-1 outline-none focus-visible:bg-muted/60"
                >
                  <MobileTabIcon
                    icon={Ellipsis}
                    active={moreActive}
                    label="More"
                    spring={spring}
                  />
                  <TabLabel active={moreActive}>More</TabLabel>
                </SheetTrigger>
                <SheetContent
                  side="bottom"
                  showCloseButton={false}
                  className="rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]"
                >
                  <div
                    className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30"
                    aria-hidden
                  />
                  <SheetHeader className="pb-0">
                    <SheetTitle>More</SheetTitle>
                  </SheetHeader>
                  <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-4">
                    {adminMoreSections.map((section) => (
                      <div key={section.label}>
                        <p className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                          {section.label}
                        </p>
                        <ul className="flex flex-col gap-1">
                          {section.items.map((item) => {
                            const active = isNavItemActive(item, pathname)
                            const Icon = item.icon
                            return (
                              <li key={item.href}>
                                <Link
                                  href={item.href}
                                  aria-current={active ? "page" : undefined}
                                  onClick={() => setMoreOpen(false)}
                                  className={cn(
                                    "flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium outline-none transition-[background-color,color,transform] duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]",
                                    active
                                      ? "bg-accent text-accent-foreground"
                                      : "text-foreground/80 hover:bg-muted hover:text-foreground"
                                  )}
                                >
                                  <span className="relative flex items-center justify-center">
                                    <Icon className="size-5" aria-hidden />
                                    <TabBadge
                                      count={badges?.[item.href]}
                                      label={`${item.label} updates`}
                                    />
                                  </span>
                                  {item.label}
                                  <NavPendingSpinner className="ml-auto" />
                                </Link>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 border-t border-border px-4 pt-2">
                    <SignOutButton
                      variant="sheet"
                      onSignedOut={() => setMoreOpen(false)}
                    />
                  </div>
                </SheetContent>
              </Sheet>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  )
}

function SidebarNavLink({
  item,
  active,
  collapsed,
  count,
  spring,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  count?: number
  spring: Transition
}) {
  const Icon = item.icon
  return (
    <li className="relative">
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className={cn(
          "relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-sidebar-ring/50 active:scale-[0.98]",
          collapsed && "justify-center px-0",
          active
            ? "text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
        )}
      >
        {active && (
          <motion.span
            layoutId="admin-sidebar-active"
            transition={spring}
            className="absolute inset-0 rounded-lg bg-sidebar-accent"
            aria-hidden
          />
        )}
        <span className="relative flex shrink-0 items-center justify-center">
          <Icon className="size-5" strokeWidth={active ? 2.3 : 2} aria-hidden />
          <NavPendingSpinner className="absolute inset-0 z-10 m-auto text-primary" />
          {collapsed && (
            <TabBadge count={count} label={`${item.label} updates`} />
          )}
        </span>
        {!collapsed && (
          <>
            <span className="relative truncate">{item.label}</span>
            {typeof count === "number" && count > 0 && (
              <span className="relative ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar-primary px-1.5 text-[11px] leading-none font-semibold tabular-nums text-sidebar-primary-foreground">
                {count > 99 ? "99+" : count}
              </span>
            )}
          </>
        )}
      </Link>
    </li>
  )
}

function MobileTabIcon({
  icon: Icon,
  active,
  count,
  label,
  spring,
}: {
  icon: NavItem["icon"]
  active: boolean
  count?: number
  label: string
  spring: Transition
}) {
  return (
    <span className="relative flex h-8 w-14 items-center justify-center transition-transform duration-150 ease-out group-active:scale-90">
      {active && (
        <motion.span
          layoutId="admin-tab-active"
          transition={spring}
          className="absolute inset-0 rounded-full bg-primary/15"
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
      <NavPendingSpinner className="absolute inset-0 z-10 m-auto text-primary" />
      <TabBadge count={count} label={`${label} updates`} />
    </span>
  )
}

/**
 * Instant click feedback for navigation. Rendered INSIDE a <Link>, it reads the
 * link's pending state (Next's `useLinkStatus`) and shows a spinner the moment
 * the user taps — so navigations that need a server round-trip no longer feel
 * dead until the next page paints. Renders nothing when idle (no layout shift);
 * safe to render outside a Link too (it simply stays idle).
 */
function NavPendingSpinner({ className }: { className?: string }) {
  const { pending } = useLinkStatus()
  if (!pending) return null
  return (
    <Loader2 className={cn("size-4 animate-spin", className)} aria-hidden />
  )
}

function TabLabel({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "text-[11px] leading-none font-medium transition-colors duration-150",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      {children}
    </span>
  )
}
