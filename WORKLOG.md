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

### In flight right now

- **PDP redesign** — aryathreads/CRED/supermoney direction; gate-law
  enforced; existing motion tokens only.
- **Perf wave 1** — cursor pagination (kills the 100-product cap), search
  facet caching, first-viewport image priority, card animation cost.
- **Flow cuts 1** — ORDER_FLOW proposals 3/4/5: single cart summary, one
  minimum-order message, per-model minimums surfaced in the builder UIs
  *before* submit.

### Queued behind the in-flight work

- **Perf wave 2** (PDP double-query, list payload trimming, hero fetch
  priority) — the files are mid-redesign.
- **Flow cut 1** (add-to-cart in the PDP sticky bar) — same reason.
- **Flow cut 2** (coupon auto-apply) — money-visible; **needs the owner's
  explicit yes** before anyone builds it.

### Decisions that need the owner

1. Spec/tag/price-band filter controls are gone from /c and /b pages
   (kept on /search) — bless or revert.
2. The old /contact page's address/hours content was replaced by the message
   form — where should the address live now?
3. Coupon auto-apply (flow proposal 2) — build or drop?

### Deploy notes for whatever ships next

- `npx prisma db push` needed once (ContactMessage model + Order.tracking —
  additive; the earlier DeviceModel dedupe must be done first if still
  pending).
- The service worker is at v5; devices refresh on next visit.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` must be present at **build** time for push
  to work at all.
