import {
  CircleUserRound,
  History,
  House,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  MonitorSmartphone,
  Package,
  ShoppingCart,
  Search,
  Settings,
  ShieldCheck,
  Percent,
  Tag,
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
  { label: "Brands", href: "/brands", icon: Tag },
  { label: "Search", href: "/search", icon: Search },
  { label: "Account", href: "/account", icon: CircleUserRound },
] as const

/** Admin surface — primary destinations (mobile bottom tabs + sidebar). */
export const adminPrimaryNav: readonly NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard, exact: true },
  { label: "Products", href: "/admin/products", icon: Package },
  { label: "Categories", href: "/admin/categories", icon: LayoutGrid },
  { label: "Brands", href: "/admin/brands", icon: Tag },
  { label: "Requests", href: "/admin/requests", icon: Inbox },
  { label: "Customers", href: "/admin/customers", icon: Users },
  { label: "Orders", href: "/admin/orders", icon: ShoppingCart },
] as const

/**
 * Admin surface — secondary destinations. Shown in the desktop sidebar
 * under their own section label and inside the mobile "More" sheet.
 */
export const adminSecondaryNav: readonly NavItem[] = [
  { label: "Import", href: "/admin/import", icon: Upload },
  { label: "Audit log", href: "/admin/audit", icon: History },
  { label: "Sessions", href: "/admin/sessions", icon: MonitorSmartphone },
  { label: "Trash", href: "/admin/trash", icon: Trash2 },
  { label: "Tax", href: "/admin/settings/tax", icon: Percent },
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
 * Mobile bottom-tab subset — the four highest-frequency destinations. Keeping
 * it to four (plus the "More" sheet) guarantees the bar is a SINGLE row on
 * phones (5 columns); the remaining destinations live in "More". Previously the
 * bar mapped all seven primary items and wrapped onto two lines.
 */
export const mobileAdminTabs: readonly NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard, exact: true },
  { label: "Products", href: "/admin/products", icon: Package },
  { label: "Requests", href: "/admin/requests", icon: Inbox },
  { label: "Orders", href: "/admin/orders", icon: ShoppingCart },
] as const

/**
 * Sections shown in the mobile "More" sheet: every sidebar destination that is
 * NOT already a bottom tab, grouped exactly as the desktop sidebar groups them
 * (so Categories / Brands / Customers land under "Manage", etc.).
 */
export const adminMoreSections: readonly {
  label: string
  items: readonly NavItem[]
}[] = adminNavSections
  .map((section) => ({
    label: section.label,
    items: section.items.filter(
      (item) => !mobileAdminTabs.some((tab) => tab.href === item.href),
    ),
  }))
  .filter((section) => section.items.length > 0)

/**
 * Shared active-route matcher: exact items match only their own pathname,
 * everything else also matches nested routes ("/admin/products/123").
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
