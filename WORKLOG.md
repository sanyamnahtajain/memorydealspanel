# Worklog

A running log of what shipped, when, and why — one dated section per working
day, newest first. Each entry lists the day's commits and the state of work
still in flight when the section was last updated. The commit messages
themselves carry the deep detail; this file is the map.

---

## 2026-08-27 (session spanning 26 → 27 Aug)

### Committed today

| Commit | What it is |
|---|---|
| `c86369d` | **Cart billing notice** (admin-edited, audited; owner's GST-bill copy under the cart summary) + **Order.fulfilledAt** ("Completed <date>" on the admin order page, stamped once on the FULFILLED transition) + **orders dashboard** (orders/day, ₹/day, top products by units, status pipeline — cancelled excluded). E2E at the action + SSR layers. |
| `7af9bfa` | **/api/me/context**: four per-viewer endpoints (access-status, last-order, buy-again, price-labels) collapsed into ONE sliced request — home 6→2 invocations, every page 3→2; old routes deleted. Price gate byte-identical. |
| `c7a48e6` | **Cost**: /api/slaby-branding CDN-cached (was a function per page view); admin SSE router.refresh coalesced per burst. |
| `28029c6` | **Nightly DB snapshot cron** to a private R2 bucket (M0 has no backups; 7-day rotation, fails loud) + admin order page opens fast (deferred audit via after(), loading skeleton) + risk-register fixes: PageView/trendingPinnedAt indexes, recommender 12-month window, SSE visibility-gating with cursor resume, timing-safe cron auth, export/PDF maxDuration. |
| `67b64f4` | **Category-level pack default**: "Packs of (pcs per model)" number on the category's per-model toggle — one number gives the whole tempered shelf 10/20/30 stepping; a product's own pack (e.g. 5) always overrides (effectivePerModelPack). QA'd through both roles end-to-end. |
| `db4576c` | **Typed-models QA + mobile containment**: full-flow QA caught a layout class — fr grid tracks without a 0 floor let one long name blow pages out sideways. Floored every user-text grid (PDP, order views, cart, footer), overflow-wrap:anywhere on name text, PDF split sub-rows now wrap. Owner styling: names never truncate, no "custom" badge, +pack button removed. |
| `d1915eb` | **Type any model**: the per-model picker is a true auto-suggest — unmatched text gets an Add "…" row; typed lines ride every pack/min rule, merge case-insensitively, survive to order snapshots and WhatsApp untouched; paste mode accepts unknown names. |
| `ae546f2` | **Category toggle save fix**: "Require per-model breakdown" silently discarded — stale closure (missing useCallback dep); regression-tested both directions, repo swept for the same warning class. |
| `b03346a` | **Brand+category filter fix**: /b/boat/bluetooth-airpods no longer offers other brands — the Brand facet group is context-blanked on /b/… pages; the DAL's deliberate replace-not-narrow brand scoping is documented at the collision site. |
| `eb789bf` | **Trending rail** (surge-vs-own-baseline momentum, admin "Show in Trending" pin that always leads, audited, fail-open) + **home reordered** (brands → categories → best sellers → trending → featured; in-page search bar deleted; New & featured carries no price cell) + **live price reveal** (/api/price-labels + LivePriceSlot upgrade the ISR shell's locked pills for entitled viewers) + **editor save fix** (root-relative image URLs no longer fail z.url() silently — displayUrlSchema, applied to product/brand/category assets, and failed client validation now toasts). |
| `85ac0df` | **One-tap add in the PDP sticky bar** for priced simple products (shared useAddToCart hook — cannot diverge from the in-page button) + PDP single detail query per request for gated traffic + hero fetchPriority. |
| `78e50ce` | **Home as a working tool**: personal LastOrderCard + /api/last-order, Best sellers server rail (ANON, ISR-safe), marketing sections deleted. (Search-first layout, superseded same-day by `eb789bf`'s reorder.) |
| (next) | **PDP redesign** — premium-quiet restyle: floating heart, anchor price panel with trust row, collapsible sections, "Shops also ordered", spring sticky bar; price gate re-verified independently (anon page carries zero rupee amounts). |
| `f57ef0f` | Tests for the context-scoped facet assembly. |
| `56f1467` | **Tempered-glass ordering**: pack multiples + per-model minimums enforced lib→server→UI, paste mode for 100-model orders, single cart summary, one MOV message. 65 tests. |
| `5616849` | **Context-scoped filters** (brand pages never show a brand facet; category pages show only their brands) + **cursor pagination** killing the silent 100-product listing cap (proven with a 130-product walk), search-facet caching, LCP image priority. |
| `a2b61b8` | **Trust strip** ("Prices open · till 24 Sept · 12 orders") + **Buy-again rail** (client-fetched, ISR-safe, gated price labels) + home page cleanup (hero, why-us, closing CTA removed — the catalogue leads). |
| `f8aa0da` | **Courier tracking** (admin card → customer "Track your parcel" → first-save push) + **one-tap WhatsApp** with status-aware prefilled messages. QA caught and fixed the wa.me country-code gap for legacy 10-digit numbers. |
| `f4384ec` | **Contact-us** exactly to spec: Google-verified, phone+reason mandatory, no GST field, 3-per-account lifetime cap, outside the shop-code wall, admin list with mark-done + live toast. Adds ContactMessage + Order.tracking to the schema (one `prisma db push` on prod). |
|---|---|
| `75f0079` | **Fullscreen lightbox** (swipe / double-tap zoom / pan; ref-counted scroll lock), **variant quick-pick bottom sheet** on listing cards (gated — an unentitled viewer's payload carries `pricePaise: null`), and **co-purchase recommendations** on the related rail (recency half-life 90d, big-order dampening, popularity normalisation). Includes the two bugs real-browser QA caught: the discovery-select drift that hid the sheet trigger from every card, and React-portal event bubbling that navigated away on a size-pill tap. |
| `3415966` | **Shop-code wall** over the whole storefront: with the gate ON a stranger sees exactly two screens (the code wall and a bare Google sign-in) at any URL, including in view-source; signed-in customers are never asked; one admin toggle removes UI + server checks alike and every failure fails OPEN. Forced the Next 16 `middleware.ts → proxy.ts` rename (Edge → Node runtime). Also: the admin **grid search** became word-order-independent and punctuation-forgiving ("ambrane 20000" now finds things), and the storefront view-mode switcher was removed. |

Context from the two days before (already deployed or awaiting deploy):
`b728221` Google re-sign-in dead end fixed · `d33bef6` SSE resume so requests
can't vanish from the admin panel · `8153f1b`/`c9b901d` expiry set-not-add +
customer detail modal · `5ccb9b2`/`71bdc9c`/`b4f05d2` voice lines + bilingual
push text · `37627f7`/`5e28d1a` the push-notification system.

### Built today via workflows — QA'd and committed (see the commits below)

Nine agents across five workflow waves, all green on tsc / eslint / the full
serial suite (1216 tests at last count, +132 today):

1. **Contact-us** — Google-verified or signed-in only; phone + reason
   mandatory; **no GST field** (owner rule); lifetime cap of 3 messages per
   Google account; reachable without the shop code; writers are never
   customers and still can't request access. Admin list at `/admin/contact`
   with mark-done, live staff toast, nav entry.
2. **Courier tracking** — admin card on the order panel (courier / id / link,
   https-validated); customer sees "Track your parcel" with a copy button;
   push on the *first* save only ("Your order is on the way"). Legacy orders
   render untouched.
3. **WhatsApp deep link** — one tap on an admin order opens WhatsApp with a
   status-aware pre-filled message to that customer; includes the tracking
   details automatically once saved. Statuses mapped to the real enum
   (PLACED / CONFIRMED / PROCESSING / FULFILLED / CANCELLED).
4. **Context-scoped filters** — a brand page never shows a brand facet; a
   category page lists only *its* brands with server-computed counts;
   Myntra-style sticky chip bar + bottom filter sheet, URL-driven.
   ⚠ Deliberate scope change to bless: spec/tag/price-band facet *controls*
   now live only on /search (legacy links still filter correctly).
5. **Bulk allocation (tempered glass)** — per-model **pack multiples**
   enforced end to end ("S23 Ultra: order in packs of 10"), pack-aligned
   steppers with tap-and-hold, model search, and a **paste mode** ("one model
   per line — name, then how many") for 100-model orders. 51 tests.
6. **Trust strip** — "Prices open · till 23 Sept · 12 orders" for approved
   buyers; mutually exclusive with the warning banner by construction.
7. **Buy-again rail** — the customer's own top re-orders, first on the home
   page; client-fetched so home stays public ISR; price travels only as a
   pre-formatted label for entitled viewers.
8. **Order-flow audit** (`ORDER_FLOW.md`) — full tap inventory, 12 stall
   points, 10 ranked simplification proposals with risk ratings.
9. **Performance audit** (`PERF_REPORT.md`) — 7 evidence-rated findings,
   headlined by a **silent production bug: every listing caps at 100
   products** (load-more re-queries at page × 24 against a limit clamp of
   100; page 5 comes back short and the client says "done"). Never fired
   only because the test catalog holds 54 products.

### In flight / remaining

Everything above is committed. Remaining, small and unblocked:

- **Perf wave 2** — PDP double-query, list payload trimming, hero
  fetchPriority (PERF_REPORT findings 4, 5 and the deferred hero line).
- **Flow cut 1** — add-to-cart in the PDP sticky bar (ORDER_FLOW proposal 1).
- **Flow cut 2** — coupon auto-apply; **needs the owner's explicit yes**.

### Decisions that need the owner

1. Spec/tag/price-band filter controls are gone from /c and /b pages
   (kept on /search) — bless or revert.
2. The old /contact page's address/hours content was replaced by the message
   form — where should the address live now?
3. Coupon auto-apply (flow proposal 2) — build or drop?

### Deploy notes for whatever ships next

- `npx prisma db push` needed once — additive: ContactMessage, Order.tracking,
  Product.trendingPinnedAt, the PageView/trendingPinnedAt indexes,
  Order.fulfilledAt, StoreSettings.cartNotice. (DeviceModel dedupe first if
  still pending.)
- New env var: `R2_BACKUP_BUCKET` → a PRIVATE R2 bucket (the backup cron
  refuses the public images bucket). Cron registers from vercel.json.
- After deploy: type the GST-bill notice once in Settings → Ordering.
- The service worker is at v5; devices refresh on next visit.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` must be present at **build** time for push
  to work at all.
