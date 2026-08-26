# Storefront Performance Audit — PERF_REPORT

Read-only audit of the storefront hot paths (home, `/c/[slug]`, `/p/[slug]`, `/search`,
discovery layer, images, client bundle, proxy). Findings ordered by impact.
Evidence was gathered by reading the code and measuring the local test DB
(54 active products, avg description 62 chars, avg 2.1 images/product) — impact
notes call out where production data size changes the math.

All line numbers are as of commit `b728221`.

---

## 1. HIGH — Load-more is O(page²) and silently caps every listing at 100 products

**Where**
- `src/app/(storefront)/c/[slug]/page.tsx:147-163` (`loadMore`, `limit: page * PAGE_SIZES.storefront` at :157, `result.items.slice(start)` at :162)
- `src/app/(storefront)/search/page.tsx:143-158` (same pattern, :153 / :157)
- `src/server/storefront/discovery.ts:285-288` (`resolveLimit` clamps to `PAGE_SIZES.max` = **100**, `src/lib/constants.ts:62`)
- `src/components/storefront/listing/StorefrontListing.tsx:204` (`rows.length < pageSize` ⇒ `exhausted`)

**Why it costs**
Each "Load more" re-runs the whole faceted query with `limit = page × 24` and slices
off everything already shown: page 4 fetches 96 rows (full DTO mapping + RSC
serialization) to return 24. Latency and DB transfer grow linearly per click,
quadratically in total. Every call also re-runs `prisma.product.count` (see finding 6).

**Worse — a correctness bug hiding behind the perf pattern**: `resolveLimit`
clamps the requested limit to 100. At page 5 the request for 120 rows returns 100,
the slice from index 96 yields only 4 items, `4 < 24` and the client marks the list
exhausted. **No listing (category, brand, search) can ever show more than 100
products**, and the button reports "done" while products remain. It has never
manifested because the test catalog has 54 products; it will in production the day
any category or search crosses 100 matches.

**Impact**: HIGH (latency growth per page + hard functional cap).

**Safe minimal fix**
`discoverProducts` already implements stable cursor pagination (`cursor` /
`nextCursor`, discovery.ts:312-314, 337). Change `loadMore` to accept the previous
page's `nextCursor` (an opaque product id) instead of a page number, pass it as
`params.cursor` with `limit: PAGE_SIZES.storefront`, and thread the cursor through
`StorefrontListing` state (`LoadMoreFn` in `listing/types.ts`). Constant cost per
page, no cap, and the price gate is untouched (the cursor carries no money).
*Mildly invasive* — it changes the server-action signature and client pagination
state, so it needs the listing tests updated; the discovery layer itself needs no change.

---

## 2. MED-HIGH — Every search request runs ~7 uncached regex collection scans

**Where**
- `src/components/storefront/filters/adapter.ts:159-181` — search-scoped facets are computed **live** (`loadFacetDataLive`), bypassing the 120s `unstable_cache` that category/brand pages get (:194-206)
- `src/server/dal/facets.ts:50-79` — every facet query ANDs in the same case-insensitive `contains` search clause
- `src/server/storefront/discovery.ts:153-175` — the discover `where` is an AND of per-term ORs of `contains` (name/sku/brand/brandRef.name/tags), ×2-3 term variants
- `src/server/storefront/discovery.ts:181-191` — `searchCategoryIds` re-reads the whole category collection on every discover call (including every load-more)

**Why it costs**
MongoDB cannot use an index for case-insensitive `contains` — each of these
where-clauses is a full collection scan over `Product`. One search page view runs,
in parallel: `brandFacet` + `specFacets` (aggregation) + `stockFacet` + `tagFacet`
+ `discoverProducts.findMany` + `discoverProducts.count` ⇒ ~6-7 scans per request.
Fine at 54 products; at a few thousand this is the dominant per-request cost of
`/search`, and it repeats on every load-more (finding 1 multiplies it).

**Impact**: MED today, HIGH as the catalog grows.

**Safe minimal fix (incremental)**
1. Cache the search facet fan-out too: `unstable_cache` keyed on
   `{approved, normalizedQuery}` with a short revalidate (60s). Facet counts for the
   same query are identical for every visitor in a gate class — same reasoning
   already written for the category cache at adapter.ts:184-192.
2. `searchCategoryIds` is a tiny read but runs per call — a `cache()`/short-TTL wrap is free.
3. **Marked risky-to-change-blind**: replacing `contains` with a Mongo text/Atlas
   Search index would change matching semantics the owner has explicitly tuned
   (singular/plural variants, category-name matching). Don't touch matching
   behaviour without owner sign-off; the caching above is behaviour-neutral.

---

## 3. MED — First-viewport listing images are lazy-loaded; product hero lacks fetch priority (LCP)

**Where**
- `src/components/storefront/listing/ProductGridView.tsx:123-131` — every card `<Image>` uses next/image defaults (`loading="lazy"`, no `priority`)
- `src/components/storefront/home/FeaturedRail.tsx:80-85` — same for the home rail
- `src/components/storefront/ProductGallery.tsx:153` — detail hero `<img>` is `loading="eager"` but has no `fetchPriority="high"`, and it loads the **full-size** `image.url` (≤1600px/~0.5MB) as the LCP element

**Why it costs**
On a 375px phone the LCP element of a category/search page is the first product
card image, and on `/p/[slug]` it is the gallery hero. Lazy-loaded LCP images wait
for IntersectionObserver + hydration-adjacent work; a hero without
`fetchPriority="high"` queues behind CSS/fonts. With `images.unoptimized: true`
(deliberate, quota-driven — `next.config.ts`) there is no srcset, so the `sizes`
attributes are inert (harmless) and priority hints are the main lever left.

**Impact**: MED (directly moves LCP on the highest-traffic pages).

**Safe minimal fix**
- Pass the item index into `GridCard`/`FeaturedCard`; for the first ~4 cards set
  `priority` (next/image) so they render eager + `fetchpriority=high`.
- Add `fetchPriority="high"` to the gallery hero `<img>` (ProductGallery.tsx:153).
- Optional, still safe: start the hero on `thumbUrl` only as a blur/placeholder is
  **not** advisable blind (visible quality change) — skip; priority hints alone are safe.

---

## 4. MED — List rows fetch and ship fields the cards never render (`description`, full `images[]`)

**Where**
- `src/server/storefront/discovery.ts:51-52,58` — list `PUBLIC_FIELDS` selects `description`, `specs`, full `images`
- `src/server/dal/products.ts:194-201` — the DAL's list select mirrors it (drift rule: change both)
- `src/components/storefront/listing/types.ts` — `ListingItem.product` is the **entire** `PublicProduct`, serialized into the RSC payload and into every load-more server-action response
- `src/components/storefront/listing/product-display.ts` — cards use only: primary image, `keySpec(specs)` (first 2 values), tags, name, brand, moq/packMultiple/stockStatus/hasVariants/allocation

**Why it costs**
`description` is rendered **nowhere** on any list surface (grid/compact/table/rails)
— only on `/p/[slug]`. Yet it travels Mongo → Node → DTO → RSC flight payload →
browser for all 24 rows per page, on category, brand, search, home-featured and the
related rail (`/p/[slug]` builds `RelatedRailItem`s the same way). The full
`images[]` array ships when only the primary thumb is used. `specs` IS used
(`keySpec`) — keep it.

**Honest sizing**: on the local test DB descriptions average 62 chars, so today
this is single-digit KB per page — the win is small *now* and grows linearly as
real product descriptions are written (a 500-char description × 24 rows × RSC
JSON escaping ≈ 15-20KB per page, again per load-more).

**Impact**: MED long-term, LOW today. Cheap insurance.

**Safe minimal fix**
Add a list-specific select that drops `description` (keep `specs`) in **both**
`discovery.ts` and `dal/products.ts` (the documented drift trap — change both or
neither), and a `ListingProduct` DTO variant without `description`.
**Marked risky-to-change-blind**: `PublicSource`/`toPublicProduct` require
`description`, so this needs a deliberate DTO split, not a select-only edit —
a select-only change would be a type error or, worse, a silent `undefined` into
shared mappers. Do it as its own reviewed change with the listing tests.

---

## 5. LOW-MED — `/p/[slug]` runs the full detail query twice per view

**Where**
- `src/app/(storefront)/p/[slug]/page.tsx:100` — `generateMetadata` → `getBySlugForViewer({kind:"anon"}, slug)`
- `src/app/(storefront)/p/[slug]/page.tsx:139` — page body → `getBySlugForViewer(viewer, slug)`
- `src/server/dal/products.ts:353-382` — `getBySlugForViewer` is **not** `cache()`-wrapped (unlike `categories.getBySlug`, which documents exactly this dedupe at categories.ts:64-70)

**Why it costs**
Two `findFirst`s with the heavy detail select (variant join included) per product
view. For the anon viewer (most traffic while gated) the two queries are byte-identical
and still both run.

**Impact**: LOW-MED (one extra indexed-but-heavy query on every product view — the
single hottest conversion page).

**Safe minimal fix**
Wrap the underlying fetch in React `cache()` keyed by (gate-class, slug) — e.g. a
cached `fetchDetailRow(gateClass, slug)` that both the anon-metadata path and an
anon page viewer share. Zero behaviour change; priced viewers still get their own query.

Related small items on the same page (LOW):
- `page.tsx:151` `void recordProductView(...)` — an un-awaited DB write on the hot
  path; on serverless it can be killed mid-flight or hold the invocation. Use
  `after()` from `next/server` for post-response work.
- `page.tsx:182-184` `getGstViewPreference()` is a sequential await after the big
  `Promise.all`; it could join it (guarded by the already-fetched flag) — micro.
- `b/[slug]/page.tsx:87-90` — `getBrandBySlug` then `getViewer()` sequentially;
  trivially `Promise.all`-able.

---

## 6. LOW-MED — `discoverProducts` re-counts on every call, including every load-more

**Where**: `src/server/storefront/discovery.ts:331` and `:351` — `prisma.product.count({ where })` runs alongside every `findMany`.

**Why it costs**
The first page legitimately needs `total`. Every subsequent load-more re-runs the
count and throws it away (`loadMore` returns only items). With a search where-clause
the count is a second full regex scan (finding 2).

**Impact**: LOW-MED (one redundant query per pagination step; scan-class under search).

**Safe minimal fix**
Add `withTotal = true` (or `skipCount`) to `DiscoverParams`; pass `false` from the
`loadMore` server actions. Two-line call-site change, return `total: -1`/reuse —
or simply land finding 1's cursor rework, whose `loadMore` naturally skips the count.

---

## 7. LOW — `layout` animations on every listing card

**Where**: `src/components/storefront/listing/ProductGridView.tsx:72` — `<motion.li layout={!reduced}>` on every card.

**Why it costs**
motion's layout projection measures every `layout` element on relevant re-renders.
After several load-mores a listing holds 100+ cards (or would, past finding 1),
and each append triggers measurement across all of them — jank on low-end phones,
which is this audience. The stagger/entrance animations are cheap; `layout` is the
expensive prop, and nothing in the grid actually reflows positions except when
items are appended (where layout animation is not visually needed).

**Impact**: LOW (runtime smoothness only, no network/DB).

**Safe minimal fix**: drop `layout={!reduced}` from the grid item (keep the
variants/stagger). Visual check at 375px before/after — it only affects the
re-sort shuffle animation, which still works acceptably via the stagger variants.
`motion/react` itself is already in the shared client chunk sitewide (shell, cards,
badges) — removing it from cards alone would win no bundle size; not recommended.

---

## Audited and healthy (no action)

- **`src/proxy.ts` hot path** — per-request work is a UUID, header copies, and
  cookie **presence** checks; the entry-gate settings read is cached 30s per
  instance (`entry-gate.ts:130-151`) and fails open. The matcher already excludes
  `_next/static` and asset extensions. No DB per request. Good.
- **ISR coverage** — home (`revalidate = 300`), `/categories` and `/brands` (300)
  are cached; `/c`, `/b`, `/p`, `/search` are correctly `force-dynamic` (they read
  the viewer cookie for the price gate) — no missed ISR opportunity without
  changing the gate architecture.
- **Category/brand facet caching** — `loadFacetDataCached` (adapter.ts:194-206,
  120s, keyed on gate class) is exactly right; finding 2 just extends it to search.
- **Page-level parallelism** — `/c`, `/search`, `/p` all batch their independent
  reads in `Promise.all`; `getViewer`, `getSellerTaxProfile`, `getBySlug`
  (category), `getBrandBySlug` are request-`cache()`d. No N+1s or per-row awaits
  found in any storefront server component.
- **Images config** — `unoptimized: true` is a deliberate, documented quota
  decision; uploads are pre-resized with dedicated ≤400px thumbs, and all list
  surfaces correctly prefer `thumbUrl` (`product-display.ts:20-25`,
  ProductGridView:126, FeaturedRail:83, compact/table views).
- **Price-gate projections** — the gated select genuinely omits money at the DB
  layer; no cheaper shortcut exists without weakening the gate. Leave alone.

## Suggested order of work

1. Cursor-based `loadMore` (finding 1) — fixes the 100-item cap *and* the O(page²) cost, and makes finding 6 moot for pagination.
2. Priority hints on first-row/hero images (finding 3) — smallest diff, direct LCP win.
3. Search facet caching (finding 2, steps 1-2 only).
4. Detail-fetch dedupe + `after()` for the view counter (finding 5).
5. List DTO slimming (finding 4) — do last, as its own reviewed change (DTO split, both selects).
