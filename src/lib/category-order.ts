/**
 * The ONE storefront order for categories: what the owner sees top-to-bottom
 * on Admin → Categories is what shoppers see. Top-level categories in their
 * own order, each followed straight away by its sub-categories in theirs.
 *
 * Why this exists: top-level categories and sub-categories each number their
 * `sortOrder` from 0 within their own group, so sorting a flat list by that
 * number alone interleaved the two ("rearranging didn't work"). A
 * sub-category whose parent is missing (hidden, deleted) goes at the end,
 * so it never disappears.
 *
 * Pure — shared by the storefront DAL, the brand rail and the admin editor.
 */
export interface OrderableCategory {
  id: string;
  name: string;
  sortOrder: number;
  parentId?: string | null;
}

const bySortThenName = (a: OrderableCategory, b: OrderableCategory) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

export function treeOrder<T extends OrderableCategory>(categories: readonly T[]): T[] {
  const ids = new Set(categories.map((c) => c.id));
  const roots: T[] = [];
  const childrenOf = new Map<string, T[]>();
  const orphans: T[] = [];
  for (const c of categories) {
    if (!c.parentId) {
      roots.push(c);
    } else if (ids.has(c.parentId)) {
      const list = childrenOf.get(c.parentId) ?? [];
      list.push(c);
      childrenOf.set(c.parentId, list);
    } else {
      orphans.push(c);
    }
  }
  const out: T[] = [];
  for (const root of [...roots].sort(bySortThenName)) {
    out.push(root);
    const kids = childrenOf.get(root.id);
    if (kids) out.push(...[...kids].sort(bySortThenName));
  }
  out.push(...orphans.sort(bySortThenName));
  return out;
}

/** Position of each category id in the storefront order (for sorting subsets). */
export function treeRank(categories: readonly OrderableCategory[]): Map<string, number> {
  return new Map(treeOrder(categories).map((c, i) => [c.id, i]));
}

/**
 * The full sibling order to persist after a reorder: the ids the client sent
 * (in its order) first, then any siblings it did not know about (created in
 * another tab) in their current order. Ids that are not siblings are dropped.
 */
export function completeSiblingOrder(
  requested: readonly string[],
  siblings: readonly OrderableCategory[],
): string[] {
  const known = new Set(siblings.map((s) => s.id));
  const seen = new Set<string>();
  const head: string[] = [];
  for (const id of requested) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      head.push(id);
    }
  }
  const tail = [...siblings].filter((s) => !seen.has(s.id)).sort(bySortThenName).map((s) => s.id);
  return [...head, ...tail];
}
