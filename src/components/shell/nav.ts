import {
  CircleUserRound,
  House,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  Package,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react"

/** A single navigation destination rendered by the app shells. */
export interface NavItem {
  /** Visible label (also used for accessible names). */
  label: string
  /** Route the item links to. Also the key used for badge counts. */
  href: string
  /** lucide-react icon component. */
  icon: LucideIcon
  /**
   * When true, the item is only active on an exact pathname match
   * (used for index routes like "/" and "/admin" so they don't
   * light up for every descendant route).
   */
  exact?: boolean
}

/** Badge counts keyed by `NavItem.href` (e.g. `{ "/admin/requests": 3 }`). */
export type NavBadges = Partial<Record<string, number>>

/** Storefront surface — mobile bottom tabs / desktop top nav. */
export const storefrontNav: readonly NavItem[] = [
  { label: "Home", href: "/", icon: House, exact: true },
  { label: "Categories", href: "/categories", icon: LayoutGrid },
  { label: "Search", href: "/search", icon: Search },
  { label: "Account", href: "/account", icon: CircleUserRound },
] as const

/** Admin surface — primary destinations (mobile bottom tabs + sidebar). */
export const adminPrimaryNav: readonly NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard, exact: true },
  { label: "Products", href: "/admin/products", icon: Package },
  { label: "Categories", href: "/admin/categories", icon: LayoutGrid },
  { label: "Requests", href: "/admin/requests", icon: Inbox },
  { label: "Customers", href: "/admin/customers", icon: Users },
] as const

/**
 * Admin surface — secondary destinations. Shown in the desktop sidebar
 * under their own section label and inside the mobile "More" sheet.
 */
export const adminSecondaryNav: readonly NavItem[] = [
  { label: "Import", href: "/admin/import", icon: Upload },
  { label: "Trash", href: "/admin/trash", icon: Trash2 },
  { label: "Settings", href: "/admin/settings", icon: Settings },
] as const

/**
 * Admin surface — access-control destinations (RBAC). Their own section so
 * "Users" and "Roles" read as a distinct concern from general System tools.
 */
export const adminAccessNav: readonly NavItem[] = [
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Roles", href: "/admin/roles", icon: ShieldCheck },
] as const

/** Sidebar sections with labels, in render order. */
export const adminNavSections: readonly {
  label: string
  items: readonly NavItem[]
}[] = [
  { label: "Manage", items: adminPrimaryNav },
  { label: "System", items: adminSecondaryNav },
  { label: "Access", items: adminAccessNav },
] as const

/**
 * Shared active-route matcher: exact items match only their own pathname,
 * everything else also matches nested routes ("/admin/products/123").
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
