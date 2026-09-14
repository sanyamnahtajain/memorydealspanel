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
 * Everything here is pure and cheap ON THE HOT PATH, which is the point: the
 * row's squashed text is built ONCE per data change, and each keystroke costs
 * only `includes` calls against strings that already exist. Nothing here
 * formats a cell, allocates, or walks the catalogue per character.
 */

/** The per-row text the query is matched against. Build once per data change. */
export interface RowHaystack {
  /**
   * Raw cell text, lowercased, "\n"-joined. Kept for the per-cell highlight
   * pass, where cell boundaries still matter.
   */
  plain: string;
  /**
   * Each cell squashed to bare letters+digits, INDEX-ALIGNED with the columns
   * it was built from. Both the row filter and the highlight pass read this,
   * so the two can never disagree, and neither has to re-derive cell text
   * while the operator is typing.
   */
  cells: string[];
}

export function buildRowHaystack(cellTexts: string[]): RowHaystack {
  let plain = "";
  const cells: string[] = [];
  for (const text of cellTexts) {
    const lower = text.toLowerCase();
    plain += lower + "\n";
    cells.push(squash(lower));
  }
  return { plain, cells };
}

/**
 * Haystacks memoised on OBJECT IDENTITY: the column set, then the row.
 *
 * Rows are replaced immutably on every edit, so without this, committing one
 * cell re-derives the haystack for the whole catalogue — every row x every
 * column, each one running `cellText` (computed columns execute, numbers go
 * through `toLocaleString`, selects resolve their labels). With it, an edit
 * costs exactly the one row that changed.
 *
 * Two nested WeakMaps, so a stale column set or a row that has been replaced
 * is collectable the moment the grid drops its reference — this can't grow
 * into a leak. Keyed on the columns array as well because the cells are
 * index-aligned with it: a different column set means a different haystack.
 *
 * `buildCellTexts` is a thunk so the expensive read never happens on a hit.
 */
const haystackByColumns = new WeakMap<object, WeakMap<object, RowHaystack>>();

export function rowHaystackFor(
  columnsKey: object,
  row: object,
  buildCellTexts: () => string[],
): RowHaystack {
  let byRow = haystackByColumns.get(columnsKey);
  if (!byRow) {
    byRow = new WeakMap<object, RowHaystack>();
    haystackByColumns.set(columnsKey, byRow);
  }
  const cached = byRow.get(row);
  if (cached) return cached;
  const built = buildRowHaystack(buildCellTexts());
  byRow.set(row, built);
  return built;
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

/**
 * Does this row answer the query? Every token must match, any order.
 *
 * Each token is looked for WITHIN A SINGLE CELL. Matching against one
 * squashed blob of the whole row would let a query fuse the tail of one cell
 * onto the head of the next — "c27" finding a row whose SKU ends in "…C" and
 * whose next column starts "27" — which reads as the grid inventing matches.
 * Words still come from different cells freely: that is per TOKEN, not per
 * query, so "ambrane 20000" matches brand-cell + name-cell as it always has.
 */
export function rowMatchesTokens(
  haystack: RowHaystack,
  tokens: QueryToken[],
): boolean {
  if (tokens.length === 0) return true;
  return tokens.every((token) =>
    token.forms.some((form) =>
      haystack.cells.some((cell) => cell.includes(form)),
    ),
  );
}

/**
 * Does an already-squashed cell hold any of the query's words? The hot-path
 * form of {@link cellMatchesTokens} — same rule, but the caller has done the
 * squashing once at data-load time instead of once per keystroke per cell.
 */
export function squashedCellMatchesTokens(
  squashedCell: string,
  tokens: QueryToken[],
): boolean {
  if (tokens.length === 0 || squashedCell === "") return false;
  return tokens.some((token) =>
    token.forms.some((form) => squashedCell.includes(form)),
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
  return squashedCellMatchesTokens(squash(cellText.toLowerCase()), tokens);
}
