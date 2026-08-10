/**
 * Search normalization (pure, isomorphic) — makes the storefront search
 * forgiving about the three ways buyers actually type:
 *
 *   "power bank" / "power banks" / "powerbanks" / "PowerBank"
 *
 * Two tools:
 *  - term variants (plural/singular) so a title "Powerbank" matches the
 *    query "powerbanks" and vice versa;
 *  - canonical squashing (lowercase, strip non-alphanumerics, singularize)
 *    so a CATEGORY named "Power Banks" matches any spacing/pluralization of
 *    the query — products titled without the word (e.g. "Ambrane 20000mAh")
 *    are then found through their category.
 */

/** Lowercase and strip everything but letters/digits: "Power Banks" → "powerbanks". */
export function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Naive English singular: banks→bank, boxes→box, batteries→battery. */
export function singularize(t: string): string {
  if (t.length > 3 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith("xes")) return t.slice(0, -2);
  if (t.length > 2 && t.endsWith("ses")) return t.slice(0, -2);
  if (t.length > 1 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

/**
 * The canonical comparable form of any name or query: tokenize, singularize
 * EACH token, then join — so plurals normalize anywhere in a phrase
 * ("power banks 20000" ⇒ "powerbank20000"), not just at the end.
 */
export function canonical(s: string): string {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singularize)
    .join("");
}

/**
 * The spelling variants of one search term worth matching in the DB —
 * the term itself plus its singular and plural forms, deduped.
 */
export function termVariants(term: string): string[] {
  const t = term.toLowerCase();
  const out = new Set<string>([t]);
  const sing = singularize(t);
  out.add(sing);
  out.add(`${sing}s`);
  out.add(sing.endsWith("y") ? `${sing.slice(0, -1)}ies` : `${sing}es`);
  return [...out].filter((v) => v.length > 0);
}

/**
 * Does a category name answer this query? Compared in canonical form, in
 * BOTH directions, so "power bank(s)"/"powerbanks" ⇔ "Power Banks", and a
 * broader query ("power") still reaches the category. Very short queries
 * (< 3 canonical chars) never match — too noisy.
 */
export function categoryNameMatchesQuery(name: string, query: string): boolean {
  const c = canonical(name);
  const q = canonical(query);
  if (!c || q.length < 3) return false;
  return c.includes(q) || q.includes(c);
}
