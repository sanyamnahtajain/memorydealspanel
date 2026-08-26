import { singularize, squash } from "@/lib/search-normalize";

/**
 * Grid search semantics — how the DealSheet decides which rows a query keeps.
 *
 * THE COMPLAINT THIS FIXES: the old filter was one exact substring over the
 * row's cell text. Staff search the way people talk about stock — brand plus
 * a spec, in whatever order comes to mind: "ambrane 20000", "20000 ambrane",
 * "type c 65w". No product name contains those words in that exact order with
 * those exact spaces, so the grid answered "nothing", and staff reasonably
 * reported the search as broken. The products were there the whole time.
 *
 * The semantics now:
 *
 *  1. The query is split into words, and EVERY word must appear somewhere in
 *     the row — but each word independently, so order never matters.
 *  2. Both sides are squashed to bare letters+digits before comparing, so
 *     punctuation and spacing differences vanish: "type-c" matches "Type C",
 *     "pp20" matches "PP-20", "20000mah" matches "20000 mAh".
 *  3. Each word also matches through its singular form, so "chargers" finds
 *     "Charger" (same forgiveness the storefront search already has).
 *
 * Everything here is pure and cheap on the hot path: the row's squashed
 * haystack is built once per data change, and each keystroke costs only
 * `includes` calls against it.
 */

/** The per-row text the query is matched against. Build once per data change. */
export interface RowHaystack {
  /**
   * Raw cell text, lowercased, "\n"-joined. Kept for the per-cell highlight
   * pass, where cell boundaries still matter.
   */
  plain: string;
  /** The whole row squashed to letters+digits — what the filter matches on. */
  squashed: string;
}

export function buildRowHaystack(cellTexts: string[]): RowHaystack {
  let plain = "";
  for (const text of cellTexts) plain += text.toLowerCase() + "\n";
  return { plain, squashed: squash(plain) };
}

/**
 * A query word, pre-normalised once so the per-row test is just `includes`.
 * `forms` holds the squashed word plus its singular (deduped).
 */
export interface QueryToken {
  forms: string[];
}

/** Split a query into matchable tokens. Empty for a blank/junk-only query. */
export function tokenizeQuery(query: string): QueryToken[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((word) => {
      const base = squash(word);
      const singular = singularize(base);
      return { forms: base === singular ? [base] : [base, singular] };
    })
    .filter((token) => token.forms[0]!.length > 0);
}

/** Does this row answer the query? Every token must match, any order. */
export function rowMatchesTokens(
  haystack: RowHaystack,
  tokens: QueryToken[],
): boolean {
  if (tokens.length === 0) return true;
  return tokens.every((token) =>
    token.forms.some((form) => haystack.squashed.includes(form)),
  );
}

/**
 * Does ONE cell's text contain any of the query's words? Drives the match
 * highlight and Enter-to-cycle. Any-token on purpose: the row has already
 * passed the all-tokens filter, and the useful highlight is "the cells where
 * your words actually are" — for "ambrane 20000" that is the brand cell AND
 * the name cell, not only a cell containing both.
 */
export function cellMatchesTokens(
  cellText: string,
  tokens: QueryToken[],
): boolean {
  if (tokens.length === 0) return false;
  const squashed = squash(cellText);
  if (!squashed) return false;
  return tokens.some((token) =>
    token.forms.some((form) => squashed.includes(form)),
  );
}
