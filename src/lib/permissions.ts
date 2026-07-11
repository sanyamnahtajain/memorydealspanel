/**
 * RBAC permission catalog.
 *
 * Every admin capability maps to a permission key. Roles hold a list of these
 * keys (Role.permissions), so access is fully configurable from the roles UI.
 * The Owner role implicitly has ALL permissions and cannot be edited/deleted.
 */

export const PERMISSIONS = {
  // Catalog
  PRODUCTS_VIEW: "products.view",
  PRODUCTS_EDIT: "products.edit",
  PRODUCTS_DELETE: "products.delete",
  CATEGORIES_MANAGE: "categories.manage",
  BRANDS_MANAGE: "brands.manage",
  IMPORT_RUN: "import.run",
  EXPORT_DATA: "export.data",
  // Customers & access
  CUSTOMERS_VIEW: "customers.view",
  CUSTOMERS_APPROVE: "customers.approve",
  CUSTOMERS_EDIT: "customers.edit",
  CUSTOMERS_BLOCK: "customers.block",
  // Administration
  DASHBOARD_VIEW: "dashboard.view",
  USERS_MANAGE: "users.manage",
  ROLES_MANAGE: "roles.manage",
  SETTINGS_MANAGE: "settings.manage",
  SETTINGS_TAX_MANAGE: "settings.tax.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Grouped for the role-editor permission matrix (label + members). */
export const PERMISSION_GROUPS: {
  key: string;
  label: string;
  permissions: { key: Permission; label: string; description: string }[];
}[] = [
  {
    key: "catalog",
    label: "Catalog",
    permissions: [
      { key: PERMISSIONS.PRODUCTS_VIEW, label: "View products", description: "See the product catalog and details." },
      { key: PERMISSIONS.PRODUCTS_EDIT, label: "Edit products", description: "Create, edit, and bulk-edit products (incl. prices)." },
      { key: PERMISSIONS.PRODUCTS_DELETE, label: "Delete products", description: "Move products to trash / restore." },
      { key: PERMISSIONS.CATEGORIES_MANAGE, label: "Manage categories", description: "Create, edit, reorder, and delete categories." },
      { key: PERMISSIONS.BRANDS_MANAGE, label: "Manage brands", description: "Create, edit, and delete brands." },
      { key: PERMISSIONS.IMPORT_RUN, label: "Import data", description: "Bulk-import products from CSV/XLSX." },
      { key: PERMISSIONS.EXPORT_DATA, label: "Export data", description: "Download the catalog export." },
    ],
  },
  {
    key: "customers",
    label: "Customers & access",
    permissions: [
      { key: PERMISSIONS.CUSTOMERS_VIEW, label: "View customers", description: "See customers and access requests." },
      { key: PERMISSIONS.CUSTOMERS_APPROVE, label: "Approve access", description: "Approve/reject/extend/revoke price access." },
      { key: PERMISSIONS.CUSTOMERS_EDIT, label: "Edit customers", description: "Edit customer details, notes, reset passwords." },
      { key: PERMISSIONS.CUSTOMERS_BLOCK, label: "Block customers", description: "Block or unblock a customer." },
    ],
  },
  {
    key: "admin",
    label: "Administration",
    permissions: [
      { key: PERMISSIONS.DASHBOARD_VIEW, label: "View dashboard", description: "See the admin dashboard and KPIs." },
      { key: PERMISSIONS.USERS_MANAGE, label: "Manage users", description: "Create, edit, deactivate admin users and assign roles." },
      { key: PERMISSIONS.ROLES_MANAGE, label: "Manage roles", description: "Create and edit roles and their permissions." },
      { key: PERMISSIONS.SETTINGS_MANAGE, label: "Manage settings", description: "Change business/app settings." },
      { key: PERMISSIONS.SETTINGS_TAX_MANAGE, label: "Manage tax settings", description: "Configure the GST / tax profile (rates, GSTIN, display)." },
    ],
  },
];

/** Every permission key, flat. */
export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key),
);

/**
 * Does a permission set grant `required`? The Owner role (isSystem with a "*"
 * wildcard) grants everything.
 */
export function hasPermission(
  granted: readonly string[],
  required: Permission,
): boolean {
  return granted.includes("*") || granted.includes(required);
}

/** The Owner role's wildcard grant. */
export const OWNER_WILDCARD = "*";
