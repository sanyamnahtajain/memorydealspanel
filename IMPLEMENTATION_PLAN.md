# Implementation Plan — MemoryDeals Panel

**Companion to:** [PRD.md](./PRD.md) · **Execution model:** every phase runs as a multi-agent workflow (parallel builders + adversarial verifiers + a build gate) — see §9.

---

## 0. Quality Bar (STANDING REQUIREMENT — applies to every phase & every future task)

Every screen and interaction, admin and storefront, must satisfy ALL of the following. Treat this as acceptance criteria for any task that touches UI, and audit against it before calling a phase done.

**Custom, never native.** No default browser UI anywhere: no native `<select>` dropdowns (use the custom Select), no `window.alert/confirm/prompt` (use ConfirmSheet / custom dialogs), no native tooltips-via-`title` only (use a custom Tooltip component). Every dropdown, popover, dialog, sheet, menu, date/expiry picker, and toast is our own component.

**Every async state is designed.** For each data-loading surface: a **skeleton loader** (not a bare spinner) for initial load, a **custom spinner/loader** for in-flight actions, an **empty state** (illustrated), and an **error state** with a clear, human **error message** + retry. Never a blank screen, never an unhandled throw reaching the user. Inline **warnings** where an action is destructive or data is stale.

**Motion & feel.** Consistent motion tokens (spring, 150–300 ms), `prefers-reduced-motion` respected everywhere, smooth momentum scrolling, tasteful entrance/stagger, optimistic UI with rollback, satisfying micro-interactions (animated checkmarks, press states, count-up price reveal). 60 fps on mid-range phones.

**Graphics & iconography.** Lucide icons used consistently (every action/nav item has an icon), illustrated empty states, product/category imagery with blur-up placeholders, no broken-image boxes.

**Tooltips.** A custom Tooltip on every icon-only button and every truncated/abbreviated value.

**Responsiveness.** Mobile-first at 360 px, then scale up. Touch targets ≥ 44 px, thumb-zone primary actions, safe-area insets. Bottom sheets on mobile / dialogs on desktop. Tables degrade to cards. No horizontal overflow.

**PWA.** Both surfaces installable (manifest, icons, splash), offline-tolerant where it matters, admin push notifications, standalone display.

**Data plumbing.** Pagination (or virtualized/infinite scroll) on every list that can grow. Usable, persistent filters + search on every catalog/customer/request list. A working **sign-out** on both surfaces. A **data download/export** feature (catalog export, price-list) reachable from the UI.

**Typography & theme.** One type scale (tabular numerals for money/counts), consistent font family/weights, semantic color tokens only (no hardcoded hex), coherent light (storefront) / dark (admin) themes, sufficient contrast (WCAG AA).

**Correctness & scale.** Corner cases handled (empty catalog, 10k products, expired mid-session, revoked mid-request, network failure, duplicate submit, concurrent edit). No N+1 queries on hot paths; indexed queries; no obvious bugs. Secure by default (price gate intact, admin-guarded mutations, rate limits, no secrets in client).

Enforcement: a recurring **quality-audit workflow** (parallel auditors, one per dimension above) runs read-only and produces a findings list; findings are fixed before the phase gate closes. See §11.

## 1. Guiding Principles

1. **Security is a data-layer property, not a UI property.** Price never crosses the server boundary unless the viewer is verified. This is enforced in ONE place (the viewer-aware data access layer, §5) and covered by invariant tests that fail the build if violated.
2. **One grid engine, four surfaces.** DealSheet (products), ImportPreviewGrid, CustomerSheet, TrashGrid share a single editing core — build it once, superbly.
3. **Server Components by default.** Client components only where interactivity demands it (grid, camera, motion). Keeps bundles small → app-like speed on cheap phones.
4. **Mobile-first, desktop-enhanced.** Every screen ships at 360 px first. The desktop spreadsheet is the enhancement, not the baseline.
5. **Scalable by statelessness.** No server memory state: sessions in DB + cookie, rate limits in Redis, images on CDN. Any number of serverless instances can serve traffic; MongoDB indexes cover every hot query.
6. **Every phase exits through a gate**: typecheck + lint + phase acceptance tests green, security invariants pass, UI reviewed against the design system. (`npm run build` is deliberately NOT part of phase gates — it runs once at MVP completion and once at final hardening.)

## 2. System Architecture

```
                    ┌─────────────── Cloudflare (DNS · WAF · bot filter) ───────────────┐
                    │                                                                    │
   Retailer (PWA)   │    Next.js (Vercel) — App Router                                   │
   Admin (PWA)  ────┼──► middleware.ts: session → ViewerContext (role, approved, expiry) │
                    │         │                                                          │
                    │    ┌────┴─────────────────────────────┐                            │
                    │    │ Server Components / Server Actions│                           │
                    │    │   └── services/  (business logic) │                           │
                    │    │        └── dal/  (viewer-aware    │──► MongoDB Atlas          │
                    │    │             price-gated queries)  │──► Upstash Redis (limits) │
                    │    └──────────────────────────────────┘ ──► R2 (images, presigned) │
                    │    Web Push ◄── access-request events                              │
                    └────────────────────────────────────────────────────────────────────┘
```

**Request flow for a product page:**
1. `middleware.ts` reads the httpOnly session cookie → attaches a `ViewerContext` header (ANON | PENDING | APPROVED | ADMIN + expiry check, single Redis-cached DB lookup).
2. The page (RSC) calls `dal.products.listForViewer(viewer, filters)`.
3. The DAL selects the Mongo projection: **price fields are excluded at query level** for non-approved viewers — the price never even leaves the database driver for anonymous traffic.
4. DTO mappers (`toPublicProduct` / `toPricedProduct`) are the only serialization path; TypeScript types make `price` non-existent on `PublicProduct`.

**Rendering strategy (scalability):**
- Anonymous storefront pages: **ISR (revalidate on catalog change)** — served from CDN cache, effectively free and infinitely scalable, and safe because the static payload contains no prices by construction.
- Approved-customer pages: **dynamic SSR** — same components, priced DTOs.
- Admin: dynamic SSR + client grid with TanStack Query mutations via Server Actions.

## 3. Repository Structure

```
src/
  app/
    (storefront)/            # public + customer routes
      page.tsx               # home: hero, category grid, featured
      c/[slug]/page.tsx      # category listing
      p/[slug]/page.tsx      # product detail
      search/page.tsx
      account/…              # login, status, request-access
    admin/
      (auth)/login/page.tsx
      dashboard/page.tsx
      products/page.tsx      # DealSheet
      products/[id]/page.tsx # product editor + camera capture
      import/page.tsx        # ImportPreviewGrid flow
      customers/page.tsx     # CustomerSheet
      requests/page.tsx      # approval queue / swipe deck
      trash/page.tsx
      settings/page.tsx
    api/                     # route handlers only where needed (push subscribe, image presign)
  server/
    dal/                     # viewer-aware data access (THE price gate)
    services/                # catalog, customers, access, import, notify
    auth/                    # Auth.js config, TOTP, password hashing, sessions
    security/                # rate-limit, turnstile verify, audit log
    storage/                 # R2 presign + image pipeline
  components/
    ui/                      # shadcn base (exists)
    grid/                    # DealSheet engine + derived grids
    admin/                   # camera capture, swipe deck, expiry dial…
    storefront/              # PriceGate card, search overlay, product gallery…
    motion/                  # transition primitives, springs, stagger helpers
  lib/                       # money(paise), slug, zod schemas, constants
  styles/                    # design tokens
prisma/schema.prisma
tests/                       # vitest unit + playwright e2e + security invariants
public/                      # PWA manifest, icons, service worker (generated)
```

## 4. Design System (professional UI foundation)

Built in Phase 1, consumed by everything after. **No component ships colors/spacing/durations inline — tokens only.**

- **Brand & color:** near-black ink on warm white; one confident accent (electric blue `#2563EB` family) + semantic greens/ambers/reds; dark-mode-ready CSS variables (admin defaults dark, storefront light).
- **Type scale:** Inter (UI) — 12/14/16/20/24/32; tabular numerals for all prices and grid numbers.
- **Spacing:** 4 px base grid; radii 8/12/16; a single elevation system (3 shadow levels).
- **Motion tokens:** `spring.snappy` (interactions), `spring.gentle` (layout), durations 150/220/300 ms, standard stagger 40 ms; every animated component imports these — the app feels like one hand designed it.
- **Component inventory (beyond shadcn):** AppShell (bottom tabs + desktop sidebar), PageHeader, StatCard, EmptyState (illustrated), StatusChip, PricePill (₹ tabular), SkeletonSet per page type, Toast system, ConfirmSheet, PhotoStrip, SearchOverlay.
- **Quality bar:** every screen has designed loading (skeleton), empty, error, and offline states — no default browser anything.

## 5. The Price Gate (security deep dive — built in Phase 2, never touched again)

- `ViewerContext = { kind: 'anon' | 'customer' | 'admin', customerId?, priceAccess: boolean }` — computed once per request in middleware; `priceAccess = approved && grant not expired && not revoked && not blocked`.
- **DB-level projection:** `dal/products.ts` has exactly two query paths; the public path uses a Mongo projection that omits `price`/`mrp`. No downstream code can leak what it never received.
- **Type-level enforcement:** `PublicProduct` has no price property → using `product.price` in a storefront component is a compile error unless the component declares it takes `PricedProduct` (which only the gated path produces).
- **Invariant test suite (runs in every phase gate):**
  - Render every storefront route as anon → assert `price`, `mrp`, and paise values absent from HTML *and* RSC payload.
  - Hit every server action/route as anon/pending/expired → assert no price field in any JSON.
  - Session cookie flags: httpOnly, Secure, SameSite=Lax.
  - Rate limiter returns 429 under login/request-access flood.
- Sessions: DB-backed with hashed tokens (revocable instantly), 30-day sliding for customers, 24 h + TOTP for admin.
- Audit log writes via a service decorator on every mutating admin action.

## 6. Phase Plan (each phase = one workflow run; exit gate at the end)

### Phase 0 — Foundations (infra plumbing)
**Goal:** everything later phases assume.
**Build:** folder skeleton; Prisma client singleton; `lib/money` (paise ⇄ ₹ format, parse, adjust ±%/±₹), `lib/slug`, shared Zod schemas mirroring the Prisma models; ViewerContext types; Redis + R2 + push clients (env-guarded no-ops in dev); Vitest + Playwright + CI script (`typecheck && lint && test && build`); seed script (8 categories, 60 realistic products with placeholder images, 1 admin, 12 customers in mixed states).
**Workflow shape:** 4 parallel builders (lib utils / clients / test harness / seed) → integration agent → verify.
**Gate:** `npm run ci` green; seed runs against local Atlas; money utils 100% unit-covered (paise math is business-critical).

### Phase 1 — Design system & app shells
**Goal:** the professional look, empty but navigable product.
**Build:** design tokens (§4); motion primitives (`<FadeUp>`, `<Stagger>`, `<SharedImage>`, spring configs); AppShell × 2 (storefront light, admin dark) with bottom tabs (mobile) / sidebar (desktop), badge slots, safe-area handling; the component inventory; a hidden `/design` gallery page rendering every component in every state (the review artifact for all UI phases).
**Workflow shape:** tokens+primitives agent → 3 parallel component-batch agents → shell agent → **design-review agent** (screenshots `/design` via Playwright at 360/768/1280 px, checks token usage, contrast, touch targets) → fix loop until clean.
**Gate:** `/design` gallery approved; Lighthouse a11y ≥ 95 on shells.

### Phase 2 — Auth, sessions & the Price Gate
**Goal:** the security core, finished and frozen.
**Build:** Auth.js with two credential providers (admin email+password+TOTP w/ QR enrolment; customer phone+password w/ argon2); DB sessions + middleware ViewerContext; Turnstile verify + Upstash rate limits on login/request endpoints; the DAL price-gate pattern (§5) with both DTO paths; audit-log service; admin session manager UI (list/revoke); login screens (both surfaces, on-brand, with designed error states).
**Workflow shape:** auth agent ∥ DAL agent ∥ rate-limit agent → integration → **adversarial security panel: 3 independent agents each trying to extract a price as anon/pending/expired/blocked** (HTML, RSC payload, actions, race conditions) → findings fixed → re-attack until 2 consecutive clean rounds.
**Gate:** invariant suite green and adopted into `npm run ci` forever after.

### Phase 3 — Catalog admin (categories, products, images, camera)
**Goal:** admin can fully manage the catalog from phone or desktop.
**Build:** category manager (CRUD, drag reorder, active toggle, sub-categories); product editor (all PRD fields, spec key-value editor, tags, duplicate-product); image pipeline (client compression → R2 presigned upload → thumbnail; PhotoStrip reorder/primary); **BatchCameraCapture** (full-screen `getUserMedia`, shutter → growing thumbnail strip, retake, background batch upload with per-photo progress + retry); soft delete + trash/restore; server actions with Zod validation + audit logging; dashboard v1 (KPI StatCards + activity feed).
**Workflow shape:** categories ∥ product-editor ∥ image-pipeline ∥ camera agents (worktree isolation — parallel file mutation) → merge/integration agent → functional-verify agents driving Playwright on seeded data (including camera via fake media stream) → design-review agent on all new screens.
**Gate:** phone E2E: create product with 3 camera photos in < 60 s on throttled 4G profile; all CRUD audited.

### Phase 4 — DealSheet grid engine
**Goal:** the Excel experience (PRD §5A.4a F-G1–F-G18). The hardest, most valuable phase — budgeted accordingly.
**Build order (sub-milestones):**
1. **Core**: TanStack Table + Virtual read-only virtualized grid (10k rows @ 60 fps), sticky column, density toggle.
2. **Editing**: cell state machine (view→edit→commit/cancel), Excel keyboard model, typed cell editors (text/number/currency-paise/percent/select/multi-tag/toggle/image/readonly-computed), Zod per-cell validation with draft-preserving error UI.
3. **Autosave engine**: per-row mutation queue → debounced server-action flush, status pills, retry w/ backoff, optimistic + rollback, `updatedAt` conflict chip.
4. **Power features**: range selection + copy/paste TSV (Excel interop), fill-down handle + smart series, undo/redo command stack (paste = one undo), bulk-action bar (category/status/±%/±₹/tags/delete), column resize/reorder/pin/hide persisted, header filters + multi-sort, saved views, Ctrl+F, group-by-category, ghost quick-add row.
5. **MobileCardEditor**: same row model + autosave engine rendered as cards; long-press multi-select; bottom bulk bar.
**Workflow shape:** sequential sub-milestones; within each, builder ∥ test-writer agents, then verify. After 4.4: **acceptance panel** — one agent per PRD acceptance criterion (200×8 paste < 2 s; autosave ≤ 1.5 s surviving refresh; 5k rows no dropped frames; keyboard-parity audit) run adversarially against the real grid.
**Gate:** all four PRD acceptance criteria pass on CI hardware; grid engine documented in `components/grid/README.md`.

### Phase 5 — Import / export & bulk images
**Goal:** foolproof spreadsheet round-trip.
**Build:** XLSX/CSV template download; SheetJS parse → column mapping step (auto-match + manual remap) → **ImportPreviewGrid** (DealSheet in review mode: per-cell errors, fix-in-place, error-only filter, create-vs-update badges by SKU) → transactional commit in batches → summary report (created/updated/skipped + downloadable error file); full catalog export; bulk image upload (zip / multi-file, filename→SKU matcher with review screen).
**Workflow shape:** parser ∥ preview-grid ∥ committer agents → verify agents with a torture-fixture library (10k rows, dupes, bad enums, ₹ strings, Excel dates, emoji, BOM, merged headers) → fix loop.
**Gate:** every torture fixture either imports correctly or fails loudly with per-row reasons — zero silent data corruption.

### Phase 6 — Customers, access lifecycle & notifications
**Goal:** the approval business loop, end to end.
**Build:** access-request intake (Turnstile + dedupe by phone → notification fan-out); requests queue (list + **ApprovalSwipeDeck** with undo toast); approve flow with **ExpiryDial** (7/30/90/custom/never); reject w/ optional reason; extend/renew/revoke/block; **CustomerSheet** (grid engine reuse: status chips, expiry cell = ExpiryDial, bulk approve/extend/revoke); customer profile drawer (notes, activity, request history, password reset); Web Push end-to-end (VAPID, subscribe on admin login, deep-link actions, daily-digest option); expiry sweep (Vercel cron) → EXPIRED + renewal banner; dashboard v2 (pending queue, expiring-in-7-days, most-viewed).
**Workflow shape:** lifecycle-service agent ∥ queue-UI agent ∥ push agent ∥ CustomerSheet agent → integration → **lifecycle state-machine verifier** (drives every transition: request→approve→expire→renew→revoke→block→re-request, asserting price visibility flips correctly at each step — reuses Phase 2 invariants).
**Gate:** full lifecycle E2E green; push notification received on a real device profile; no state transition leaves priceAccess inconsistent.

### Phase 7 — Customer storefront
**Goal:** the public face — fast, beautiful, price-safe.
**Build:** home (hero, category grid, featured); category pages (filter chips via bottom sheet, infinite scroll + skeletons); product detail (Embla gallery w/ pinch-zoom, spec table, shared-element transition from card); **PriceGateCard** (shimmering locked chip → flips to request form bottom sheet; unblur + count-up reveal for approved viewers); request-access flow (F-C7 form, inline Zod validation, Turnstile, success state, duplicate-phone → status view); account area (status, expiry banner, renewal request); SearchOverlay (recent, chips, instant results); "Enquire on WhatsApp" wa.me deep link; SEO (metadata, og-images, sitemap, schema.org **without price**); ISR for anon + dynamic for approved (§2).
**Workflow shape:** 4 parallel page-agents (worktrees) → integration → design-review at 3 breakpoints ∥ **security re-attack panel** (anon/pending/expired price extraction vs the ISR cache specifically) ∥ perf agent (Lighthouse ≥ 90 perf / ≥ 95 a11y on throttled 4G).
**Gate:** design + security + performance panels all green.

### Phase 8 — Comprehensive quality, polish & PWA (the §0 Quality Bar, enforced)
**Goal:** meet the §0 Quality Bar across every existing surface, then the "feels like a native app" PRD §5A promise. This phase runs the quality-audit workflow (§11), fixes every finding, and adds anything missing from §0: custom replacements for any native browser UI, skeleton/spinner/empty/error states everywhere, tooltips on icon-only controls, pagination + persistent filters on every growable list, sign-out on both surfaces, data export reachable in the UI, typography/theme consistency, and full responsiveness. THEN the PWA/motion work below.

**Theme switching (light / dark / system) — F-U21.** The design system is already token-based (semantic CSS variables in `globals.css`) with a full dark palette (admin already renders dark via a `.dark` root). Add a user-facing theme control so the STOREFRONT (and optionally the admin) supports Light / Dark / System:
- `next-themes` (or an equivalent tiny provider) mounted at the root: `class` strategy toggling `.dark`, `defaultTheme: "system"`, `enableSystem`, `disableTransitionOnChange` to avoid flash, and an inline pre-hydration script to prevent FOUC (wrong-theme flash on first paint).
- A **custom** ThemeToggle component (segmented Light/Dark/System control, animated, with icons — never a native `<select>`), placed in the storefront header/account and the admin top bar. Persists the choice (localStorage via the provider) and reflects the live system preference when "System" is selected.
- Audit that BOTH themes read only from semantic tokens (no hardcoded colors), meet WCAG AA contrast in each mode, and that images/illustrations/skeletons look correct in dark. Storefront defaults to light+system; admin defaults to dark but respects an explicit user choice.
- Respect `prefers-color-scheme` for first visit; `<meta name="theme-color">` updates per theme; the PWA manifest theme/background colors are theme-appropriate.
**Build:** Serwist service worker (precache shells, runtime cache, offline fallback); manifests × 2 (admin/storefront identities), icons, splash; install prompts; **offline admin queue** (IndexedDB outbox for edits + photos, background sync, sync-status pill); View Transitions wiring (card→detail shared element); pull-to-refresh; scroll restoration; condensing sticky headers; haptic-style micro-feedback; page-level stagger polish; `prefers-reduced-motion` audit; quick-review pass of every screen against motion tokens.
**Workflow shape:** SW/offline agent ∥ motion-polish agents per surface → **device-matrix verify** (Playwright: iOS Safari, Android Chrome profiles × offline/online × install mode) → 60 fps trace audit on key interactions.
**Gate:** installable on both platforms; airplane-mode admin edit syncs on reconnect; zero motion jank in traces.

### Phase 8.5 — Brand master (data model + CRUD + dropdown) — PRD F-A7a–F-A7d
**Goal:** Brand becomes a first-class master entity so products reference it, not a free-text string (kills typo duplicates).
**Data model (done by the driver, not a workflow — it is a schema change):** new `Brand { id, name(unique, case-insensitive), slug, logo?, status, sortOrder, timestamps }`; `Product.brand: String?` → `brandId: String? @db.ObjectId` + relation + `@@index([brandId])`. **Migration script** (idempotent): read all distinct existing `Product.brand` strings, upsert a Brand per normalized name, set each product's `brandId`, drop the old string. Update the seed to create brands and link products.
**Build (workflow, after 8B):**
- Brand service + admin actions (create/update/setStatus/delete, guarded + audited), mirroring categories.
- `/admin/brands` master CRUD page + BrandManager (reuse category manager patterns; custom dialogs, tooltips, states per §0). Nav entry under "Manage".
- Product editor + DealSheet grid `brand` cell → custom **Select** from active brands, with inline "＋ Add brand" (creates in the master immediately). No free-text.
- Bulk import: map brand column to Brand by case-insensitive name; unmatched surfaced in the ImportPreviewGrid, auto-created on commit (F-A7c).
- Storefront brand filter reads the Brand master; product DTO exposes brand `{id,name,slug}` (public, non-priced).
**Gate:** no product carries a free-text brand; every brand reference resolves to a master row; product/grid/import/storefront all use the dropdown/master; typecheck+lint+vitest green; a test proving two products with the "same" brand share one Brand id.

### Phase 8.6 — Users, roles & permissions (RBAC) — configurable access rights
**Goal:** multiple admin/staff users, each with a role; roles carry a configurable permission set; every admin capability is gated by a permission.
**Data model (done by the driver — schema + migration):** `Role { name unique, description?, permissions String[], isSystem }` (built-in **Owner** = `["*"]`, uneditable); `Admin` gains `roleId`, `isActive`, `lastLoginAt`. Permission catalog in `src/lib/permissions.ts` (grouped keys: products.view/edit/delete, categories.manage, brands.manage, import.run, export.data, customers.view/approve/edit/block, dashboard.view, users.manage, roles.manage, settings.manage). Migration bootstraps Owner + preset roles (Catalog Manager, Sales) and assigns the existing admin to Owner.
**Build (workflow):**
- Extend `resolveViewer`/session to load the admin's role + permissions; add `hasPermission(viewer, key)` + `assertPermission`. Enforce on every admin server action and page (replace bare `assertAdmin` with permission checks; Owner passes all). Nav items hide when the viewer lacks the permission.
- `/admin/users` — user CRUD: list (name, email, role, active, last login), create (email + temp password + role), edit, activate/deactivate, reset password, assign role. Guarded by `users.manage`. Cannot deactivate/delete the last Owner.
- `/admin/roles` — role CRUD with a **permission matrix** (grouped checkboxes, select-all per group), create/edit/delete (system roles locked). Guarded by `roles.manage`. Show how many users hold each role; block deleting a role in use.
- Admin login records `lastLoginAt`; blocked/inactive users can't sign in. Seed updated to create roles + assign admin.
**Gate:** a non-Owner user only sees/does what its role permits (test: a Sales user cannot reach products.edit actions/pages); last-Owner protection holds; typecheck+lint+vitest green.

### Phase 7.5 — Storefront modernization & full retailer experience (deep dive)
**Goal:** a modern, polished, complete retailer-facing storefront. Everything here meets the §0 Quality Bar (custom components only — no native dropdowns/popups/alerts; skeleton + spinner + empty + error states; tooltips; motion; responsive; PWA; pagination; usable filters; theme; typography). The price gate (§5) remains inviolable on every surface.

**Retailer-visible page inventory (what a retailer can see):**
1. **Home / landing** — hero, value props ("Wholesale prices on approval"), featured categories, new/featured products (locked prices via PriceGate), brand strip, "how it works" (browse → request access → get approved → see prices), CTA to request access, trust signals. ISR.
2. **Catalog / all products** — grid with filters (category, brand, price band — only meaningful once approved, else hidden, stock status), sort (newest, name, price when approved), search box; pagination or infinite "load more" (cursor-based, scalable to 10k+); skeleton grid; empty state.
3. **Category page** `/c/[slug]` — sub-category chips, same filter/sort/paginate; category hero; SEO metadata (no price).
4. **Sub-category page** — nested browse.
5. **Brand page** `/b/[slug]` — browse by brand (reads the Brand master), brand header/logo.
6. **Product detail** `/p/[slug]` — gallery (Embla, zoom, per-variant images), title/brand/specs table, **variant selector** (§Phase 11 — swatches/option pickers; price + stock update per variant), PriceGate card (locked → request; unblur+count-up when approved), MOQ, "Enquire on WhatsApp", **add to enquiry list**, related products / "customers also viewed", share, breadcrumb, shared-element transition from card. Dynamic when approved / ISR when anon.
7. **Search** — full-screen overlay with **autocomplete suggestions** (products, brands, categories — see Cross-cutting Autocomplete), recent searches, instant results; dedicated results page with the same filters; DB-backed (not in-memory), scalable.
8. **Enquiry list / quote cart** — retailers add products (+variant, qty) to a list and send one enquiry (WhatsApp deep-link or a stored EnquiryRequest that notifies admin). Persisted per customer; badge in header. (Replaces v1's per-product enquiry as the richer flow.)
9. **Favorites / saved products** — heart to save; a saved list in the account area (per approved customer).
10. **Account area** `/account` — status + expiry banner, request/renew access (bottom sheet), profile (business name, GST, contact — editable), **price-list PDF download** (watermarked with business name + date; approved only), enquiry history, favorites, sessions ("signed-in devices" + sign-out everywhere), sign-out. 
11. **Login** — phone + password (custom form, OTP-free per project decision), request-access entry.
12. **Static/support** — About, Contact, FAQ, Terms, Privacy, Shipping & returns policy — simple content pages in the footer.
13. **System** — custom 404, 500 (error boundary), offline (PWA), maintenance.

**Global storefront chrome:** sticky condensing header (logo, search, enquiry-list badge, account, theme toggle, install-app), mega/simple category nav, footer (categories, brands, support links, contact, social), announcement bar (optional), bottom tab bar on mobile (Home / Categories / Search / Enquiry / Account), PWA install prompt.

**Modern design language:** refined type scale + spacing rhythm, generous imagery with blur-up placeholders, tasteful motion (stagger, shared-element, price reveal), consistent iconography, light/dark theme, accessible contrast, empty/error/loading states everywhere, 60fps on low-end Android.

**Security/scale corner cases:** anon/pending/expired never see a price on ANY of these pages (verified per page); approved-then-expired mid-session degrades gracefully; favorites/enquiry require login; rate-limit request-access + search; all lists paginated; images via CDN; ISR for anon pages (can't leak prices by construction).

**Workflow shape:** parallel page-builders (worktree isolation) → integrate → design-review at 360/768/1280 ∥ **security re-attack (price extraction incl. ISR cache)** ∥ perf (Lighthouse ≥90/≥95). No dev-server verify (static + component tests).

### Phase 7.6 — Retailer usability & view modes (part of the storefront)
**Goal:** let a wholesale buyer work the catalog *their* way — scan fast, compare, and build orders efficiently. All custom-built, per §0.

**View modes (headline — a persistent switcher on every product listing):**
- **Grid** (default) — image-forward cards for visual browsing.
- **Compact list** — dense rows: thumbnail + name + brand + key spec + price (gated) + MOQ + stock; many per screen for fast scanning.
- **Table** — spreadsheet-style columns (name, SKU, brand, key specs, MRP, wholesale price when approved, margin %, MOQ, stock), **sortable column headers**, sticky header, horizontal scroll on mobile — for buyers who compare quickly and know what they want.
- **Detailed list** (optional) — medium density: larger thumbnail + 2–3 specs + price + quick-add.
- The chosen mode + density **persists per user** (localStorage/cookie); a custom segmented toggle with icons (never a native select); respects reduced-motion when switching.

**Compare:** select 2–4 products → a side-by-side comparison table (specs, price, MRP, margin, MOQ, stock) in a sheet/page; add the winner to the enquiry list.

**Quick actions (from any list, without opening detail):**
- **Quick-view** — peek at a product in a bottom sheet/dialog (gallery, specs, price gate, add-to-enquiry).
- **Inline add-to-enquiry** with a **quantity stepper** (respecting MOQ) right on the card/row.
- **Favorite/heart** toggle inline.

**Search, filter & sort (usable, persistent):**
- Faceted filters (category, brand, price band [approved], stock, spec facets e.g. wattage/capacity) in a bottom sheet on mobile / sidebar on desktop; **active-filter chips** with one-tap clear; result count.
- Sort: newest, name A–Z, price low→high / high→low (approved only), most-viewed. 
- **Saved filter presets** ("65W GaN chargers, in stock") and **recent searches**; autocomplete suggestions (cross-cutting Autocomplete).
- "In stock only" quick toggle; all lists paginated / cursor "load more" (scalable).

**Pro / repeat-buyer efficiency:**
- **Quick order pad** — type SKU + qty in a fast grid to build an enquiry without browsing (for retailers restocking known items).
- **Bulk add to enquiry** — multi-select in list/table → add all.
- **Multiple enquiry lists** ("Monthly restock", "Diwali order"), rename/duplicate; enquiry history → **re-add / reorder**.
- **Recently viewed** rail; **favorites** page.
- **Price-list PDF/CSV download** (approved; watermarked) and **print-friendly** catalog/price list.
- **Margin calculator** on priced views (MRP vs wholesale → margin %/₹) so the buyer sees profit at a glance.

**Readability & awareness:**
- Text-density/font-size control; tabular numerals for all prices/qty; sticky table headers.
- Stock badges (In/Low/Out), "New" badge, optional "price dropped" indicator; MOQ shown clearly.
- Expiry banner + renewal; notifications (access approved, price list updated).
- Breadcrumbs, category quick-jump, back-to-top, scroll restoration; optional keyboard shortcuts for power users.

**Mobile-first specifics:** sticky "add to enquiry" bar, swipe between product images, thumb-zone actions, bottom-sheet filters/quick-view.

**Security/scale:** every view mode (grid/list/table) is fed by the same viewer-gated DAL — **no price in any mode for anon/pending/expired**; table/compact views must not leak a price column when locked (render the PriceGate chip in the price cell). Comparison/quick-view/quick-order all respect the gate. View-mode preference is presentation-only (never affects gating).
**Gate:** switch grid↔list↔table with prices correctly gated in each; preference persists; compare + quick-view + quick-order work; a11y (sortable headers keyboard-operable); responsive; typecheck+lint+vitest + a price-gate test across all view modes.

### Phase 7.7 — Discovery & search (full retailer flexibility)
**Goal:** let a retailer find anything, any way — by brand, category, price band, spec, use-case, SKU — with fast, scalable, typo-tolerant search. Custom UI per §0. **The price gate governs price-based flows** (see security note).

**Faceted filtering (combinable, with live counts):**
- **Brand** (multi-select; from the Brand master) · **Category / sub-category** · **Spec facets** dynamically derived from the catalog (Wattage, Capacity, Cable length, Material, Compatibility, Color…) · **Stock** (in-stock only) · **Tags** ("New", "Hot Seller", "Fast charging") · **MOQ band**.
- **Price band** (approved only): a range slider + preset bands (e.g. ≤₹100, ₹100–500, ₹500–1000, ₹1000+). For anon/pending, the price facet is replaced by a "Log in to filter & sort by price" chip — never a broken/empty control.
- Filters combine (brand AND category AND spec…), show result + per-facet counts, render as removable **active-filter chips**, and are **URL-encoded** so a filtered view is shareable/bookmarkable and SSR-friendly.

**Search entry points & flows (multiple ways in):**
- **Global search** with autocomplete (products, brands, categories, SKUs; typo-tolerant, synonyms like charger↔adapter, partial match), recent + saved searches.
- **Search by SKU** (exact/near — for repeat buyers who know codes) and **scoped search** ("search within this brand/category").
- **Barcode/QR scan** on mobile (scan a physical product's barcode/label to jump to it) — a natural fit for a wholesaler standing at their stock.
- **Browse-by-brand** directory (A–Z + logo grid) and **browse-by-category** visual tree.
- **Curated collections / use-cases** ("Fast chargers", "Travel essentials", "Car accessories", "Under ₹100" [approved]) — admin-curatable, seasonal.
- **New arrivals**, **trending / most-viewed**, and (approved) **best-margin** sort — a wholesale-buyer-centric lens.
- **Compatibility finder** ("accessories for iPhone 15", "USB-C cables") via spec/tag facets.
- Optional guided wizard ("What are you looking for?" → category → brand → specs) for first-timers.

**Results UX:** relevance ranking + highlight matched terms; sort (relevance, newest, name, price low/high [approved], most-viewed); persistent filters; rich **empty state** ("no matches → try these / popular / contact"); pagination or cursor "load more"; the Phase 7.6 **view-mode switcher** (grid/list/table) applies to results too.

**Security (the load-bearing constraint):**
- **Price-band filter & price sort run SERVER-SIDE and only for approved viewers.** A client-side price filter would require prices in the payload → a leak for anon/pending. So the DAL computes price-filtered/sorted results server-side and the price facet is simply absent (replaced by the login CTA) for non-approved viewers. Every other facet (brand/category/spec/stock) is price-free and available to everyone.
- Spec facets, counts, and search are computed server-side from gated projections — no price ever enters an anon payload, in results, facets, autocomplete, or URL. Extend the price-gate invariant tests to cover search/facets.
- Search never surfaces inactive/soft-deleted products or any admin data; rate-limit search + autocomplete.

**Scale:** MongoDB text index + the existing hot-path indexes; facet counts via cached aggregation (short revalidate/Redis); debounced autocomplete over cached distinct values; results paginated; targets 10k+ SKUs smoothly.
**Gate:** filter by brand/category/spec as anon (no price anywhere); approved viewer can filter & sort by price band (server-side, correct); combined facets + counts + URL sharing work; barcode/SKU/brand/category/collection flows reachable; search is typo-tolerant and paginated; price-gate invariant passes across search/facets; typecheck+lint+vitest green.

### Phase 7.8 — Wishlist / saved products (retailer)
**Goal:** let a retailer save products to come back to — a persistent, cross-device wishlist. This is the "favorites/heart" feature referenced in 7.6, specified as a first-class, DB-backed capability. Distinct from the **enquiry list** (7.6): wishlist = "track / want later", enquiry list = "products + quantities I intend to order". A wishlist item can be **moved/added to the enquiry list** in one tap.

**Data model (schema + migration — done by the driver):**
- `WishlistItem { id, customerId, productId, variantId?, note?, createdAt }` with `@@unique([customerId, productId, variantId])` (idempotent add) and `@@index([customerId, createdAt])`. Cascades on customer/product delete. (Single default list for v1; a `Wishlist { name }` grouping for **multiple named lists** — "Diwali", "Monthly restock" — is a clean follow-on, mirroring the enquiry-list design.)

**Flows:**
- **Add/remove** via a heart toggle on product cards, list/table rows, quick-view, and product detail — optimistic UI, animated fill, toast. Works in every view mode.
- **Header badge** with saved-count; **bottom-tab** entry on mobile.
- **Wishlist page** in the account area — saved products rendered with the Phase 7.6 view-mode switcher (grid/list/table), sortable, with per-item actions: remove, **add to enquiry** (with qty stepper respecting MOQ), add note, quick-view. Bulk "add all to enquiry". Rich empty state ("Nothing saved yet → browse the catalog"), skeleton while loading.
- **Alerts (ties to notifications):** optional "notify me" on a wishlisted item for **back-in-stock** and (approved) **price-drop** — pushed via the existing Web Push / in-app notifications.
- **Move between lists** (when named lists land) and **share a wishlist** (read-only link) as a follow-on.

**Auth & access:** requires a logged-in customer (any status may save; guests get a "log in / request access" prompt). Prices on the wishlist obey the gate — shown only when approved, else the PriceGate chip. The list is strictly **per-customer (IDOR-protected)** — a customer can only read/mutate their own items; server actions assert ownership.

**Quality/§0:** custom components throughout (no native anything), loading/empty/error states, tooltips on the heart, motion on add/remove, responsive, paginated if large, tabular price display.
**Gate:** save/remove persists across devices (DB-backed) and reflects instantly (optimistic); wishlist respects the price gate (no price for non-approved); a customer cannot access another's wishlist (ownership test); add-to-enquiry from wishlist works; typecheck+lint+vitest green.

### Phase 8.7 — Audit & session logs (admin observability)
**Goal:** full accountability — which admin did what, and when/where they were signed in. (`AuditLog` + `writeAudit` already record mutations; this adds capture depth + the viewing UI.)
- **Capture:** ensure every admin mutation writes an audit entry (actorType, actorId, actorName snapshot, action, entity, entityId, before/after diff, at). Add **IP + userAgent** to `Session` and to admin-login audit; record `lastLoginAt`. Consider a lightweight read-audit for sensitive views (who exported the catalog, who viewed a customer).
- **Audit log viewer** `/admin/audit` (permission `settings.manage` or a new `audit.view`) — paginated, filter by actor / entity / action / date range, a diff viewer (before→after), export to CSV. Custom table → cards on mobile.
- **Contextual audit previews (per module & per detail page):** a reusable `<AuditLogPreview entity entityId />` component that shows the latest N entries for that record (actor, action, when, diff summary, "view all" → filtered `/admin/audit`). Placed on **every detail page** (product editor, category, customer profile, brand, user/role) and as a **"recent activity" panel in each module** list (products, customers, requests, categories). Backed by `getRecentAuditForEntity(entity, entityId)` and `getRecentAuditForModule(entity)` — indexed queries, gated by permission. Loading skeleton, empty state, humanized diffs, relative timestamps.
- **Session logs** `/admin/sessions` (and per-user in the Users page) — active sessions (device, IP, last seen, created), force sign-out of a session or all sessions for a user; login history. TTL/retention policy noted.
- **Data hygiene:** audit/session rows grow fast → TTL index (e.g. 180–365 days) + pagination; never store secrets in diffs; redact password fields.
**Gate:** every admin mutation is traceable to an actor; force-logout works; viewer paginates + filters; typecheck+lint+vitest green.

### Phase 11 — Product variants (deep analysis — cross-cutting, affects many features)
**Why it's big:** price, stock, SKU, and images can differ per variant (e.g. Power Bank 10000mAh vs 20000mAh; cable 1m vs 2m; case colors). Price is the gated asset, so **the price gate must apply per variant**. This touches the data model, editor, grid, import/export, DTO/DAL, storefront, search, and analytics.

**Data model (schema + migration):**
- `ProductOptionType` (per product or reusable): e.g. "Color", "Capacity", "Length" with ordered values.
- `ProductVariant { productId, name (derived from options, e.g. "Black · 20000mAh"), optionValues (Json: {Color:"Black", Capacity:"20000mAh"}), sku (unique), price(paise), mrp?(paise), moq?, stockStatus, images? (variant-specific), isDefault, status, sortOrder }`.
- `Product` keeps shared fields (name, brand, category, description, base specs); a product with no variants keeps a single implicit/default variant so existing code paths still work. **Migration:** wrap every current product into one default variant carrying its current price/sku/stock; keep `Product.price` as a denormalized "from" price (min active variant) for list/sort, or compute it.
- **Backward-compat strategy:** introduce a `hasVariants` flag; single-variant products render exactly as today. The DAL/DTO expose `priceFrom`/`priceRange` (gated) for lists and full per-variant pricing (gated) on detail.

**Feature impacts (each must be updated):**
- **Product editor:** an option-type builder (add "Color" with values) → auto-generate the variant matrix; per-variant price/sku/stock/images; bulk set price across variants; mark default.
- **DealSheet bulk grid:** decide UX — either a variant-expandable row, or a "variants" cell opening a sub-grid; bulk price adjust must target variants. (Non-trivial; may ship as a variant sub-editor first.)
- **Import/export:** variant rows (parent SKU + option columns + per-variant price/stock), preview validation, create/update by variant SKU.
- **Storefront detail:** variant selector (swatches for color, chips for capacity), price/stock/gallery update on selection; PriceGate per selected variant; enquiry list stores the chosen variant.
- **DTO/DAL/price gate:** `PublicVariant` (no price) vs `PricedVariant`; list pages show gated price range; invariant tests extended to variants (anon sees no variant price anywhere).
- **Search/filter:** filter by option values (e.g. capacity), stock at variant level.
- **Analytics/most-viewed/PageView:** optional per-variant view tracking.
**Gate:** anon sees no variant price; a product with 3 variants edits/imports/renders correctly; single-variant products unchanged; price gate invariant passes for variants; typecheck+lint+vitest green. **Sequencing:** land before final launch if variants are needed at go-live; otherwise a fast-follow — flagged as a large phase either way.

### Cross-cutting — Autocomplete / auto-suggest (reduce typos everywhere)
A single reusable **custom Combobox/Autocomplete** component (Base UI/own — NOT a native `<datalist>`), backed by "distinct value" server actions, applied wherever free text invites typos:
- **Specification keys** (product editor SpecEditor) — suggest keys already used across products ("Wattage", "Cable Length", "Material", "Warranty", "Compatibility"…).
- **Specification values per key** — suggest existing values for the chosen key ("Wattage" → 18W/20W/33W/65W…).
- **Variant option names & values** — "Color" → existing colors; "Capacity" → existing capacities.
- **Tags** (already token-autocomplete — unify on the same component).
- **Brand** — resolved by the Brand master dropdown (F-A7b).
- **Customer city** (request-access + admin edit) — suggest Indian cities.
- **SKU** — auto-suggest a generated SKU from brand + category + name (editable), with uniqueness check.
- **Storefront search** — product/brand/category suggestions.
- **Admin global search** (future) — jump to product/customer/order.
Backed by cached `distinct()` queries (Redis/short revalidate) so it scales; debounced; keyboard-navigable; created-on-the-fly values allowed where sensible (specs) or constrained to the master (brand).
**Gate:** SpecEditor keys & values autocomplete from real data; no native datalist anywhere; typo-prone fields identified and covered.

### Cross-cutting — UI preferences (admin & retailer)
A custom **Preferences** surface (in admin Settings and the storefront account), persisted per user (localStorage + cookie for SSR, optionally synced to the account for cross-device):
- **Theme** — Light / Dark / System (F-U21, done) surfaced here too.
- **Density** — Comfortable / Compact (affects tables, grids, lists, cards) via a `data-density` attribute + token spacing.
- **Default view mode** — Grid / Compact / Table (retailer listings; ties to Phase 7.6).
- **Motion** — Reduce motion toggle (overrides beyond the OS setting).
- **Results per page / infinite-scroll** preference; **number/date locale** (en-IN default, tabular numerals).
- **Accessibility**: larger text option; high-contrast check.
All via custom controls (segmented toggles/switches — never native selects), instant apply, no reload.
**Gate:** preferences persist across reloads + SSR (no flash), apply app-wide via tokens/attributes, custom controls only, respect reduced-motion.

### Logo & brand assets (done)
Real **The Memory Deals (TMD)** logo wired into storefront + admin headers, footer, and login; white-background PWA icons (192/512/maskable) + apple-touch + favicon generated from it; manifest + metadata + real business name/tagline/Maps link updated. `Logo` component (`src/components/brand/Logo.tsx`) with mark / wordmark / dark-surface chip variants. Brand colors (navy `#1e2a9c` + red) noted for an optional future accent-token refresh.

### Cross-cutting — Charts & analytics (graphs where they add insight)
Custom, token-styled, responsive, accessible charts (lean to **hand-built SVG** to match the "custom components" ethos; a small headless lib only if justified — decided at build, no heavyweight dep). Respect reduced-motion; skeleton while loading; empty state when no data.
- **Admin dashboard:** access requests over time (line/area), approvals vs rejections (stacked bar), customers by status (donut), most-viewed products (horizontal bar), catalog growth, accesses expiring in next 7/30 days (bar), enquiry volume.
- **Product (admin):** views over time (sparkline/line) — powered by PageView.
- **Customer profile:** activity timeline / views.
- **Roles/users:** small stat chips.
Data via pre-aggregated daily counters (avoid scanning PageView live at scale). 
**Gate:** dashboard shows real charts from real data; charts responsive + accessible + themed; no layout shift.

### Phase 12 — Cart & Orders (approved customers, no payment) — deep security & corner-case design
**Goal:** an approved retailer can build a **cart** and **place an order** (a purchase request — **no payment collected**; the wholesaler fulfils offline). This formalises the loose "enquiry list / quote cart" from 7.6/7.8 into a real Cart→Order system. WhatsApp-enquire remains as a quick alternative. **Only APPROVED, unexpired customers** may cart or order — pending/expired/blocked cannot (they can't even see prices).

**Data model (schema + migration — done by the driver):**
- `CartItem { id, customerId, productId, variantId?, quantity, createdAt, updatedAt }` with `@@unique([customerId, productId, variantId])` (one line per product/variant; adding again increments qty) and `@@index([customerId])`. Cascades on customer/product delete. (One implicit cart per customer.)
- `Order { id, orderNumber (unique, non-sequential/non-guessable), customerId, status (PLACED|CONFIRMED|PROCESSING|FULFILLED|CANCELLED), items Json (embedded SNAPSHOT: productId, name, sku, brand, variant, quantity, unitPricePaise, lineTotalPaise), subtotalPaise, itemCount, note?, placedAt, updatedAt, adminNote? }` with `@@index([customerId, placedAt])`, `@@index([status, placedAt])`.
- `OrderEvent { orderId, actorType, actorId, from, to, at, note? }` (status history / audit) — or reuse AuditLog.

**Server-authoritative — the anti-cheat core (NON-NEGOTIABLE):**
1. **Price is NEVER trusted from the client.** Unit prices and line totals are computed **server-side** at placement from the viewer-gated DAL (the price that customer is entitled to). The client sends only `{productId, variantId?, quantity}`. Any price in the request is ignored. Order snapshots the server price so later catalog price changes don't alter a placed order.
2. **Access re-checked on EVERY cart/order mutation AND at placement.** A customer may add to cart while approved, then access expires — placement must re-verify `priceAccess` (approved + unexpired grant + not revoked + not blocked) and reject if lost. All cart/order server actions call `resolveViewer` and require `priceAccess` (not just a session).
3. **Ownership / IDOR:** a customer can only read/mutate their **own** cart and orders; every action asserts `order.customerId === viewer.customerId`. Order numbers are random (not enumerable) and looking up an order still checks ownership. Admin bypass is explicit + audited.

**Rate limiting & abuse controls (Upstash + in-memory fallback):**
- **add-to-cart / update-qty:** throttled per customer (e.g. 60/min) — stops spam.
- **place-order:** strict cap (e.g. ≤ N orders/hour and ≤ M/day per customer) → returns a friendly "slow down" error.
- **Idempotency / double-submit:** placement takes an idempotency key (or dedups an identical cart placed within a short window) so a double-click / retry can't create duplicate orders; cart-clear + order-create happen in ONE transaction.
- **Caps:** max distinct cart lines (e.g. 100), max quantity per line and per order, max order value sanity ceiling — reject absurd values. Quantity must be a **positive integer** within `[MOQ, cap]`; reject non-integers, negatives, overflow, NaN.
- **Note field:** length-capped, plain-text only (no HTML), trimmed.
- **Bot/automation:** rate limits + caps; optional per-session throttle. (No captcha needed for authenticated approved users.)

**Corner cases (handled explicitly, with clear UI):**
- Add a product already in cart → increment (never duplicate). Adding below MOQ → clamp to MOQ.
- Product **price changes** while in cart → cart shows the live gated price; order snapshots at placement.
- Product goes **inactive / soft-deleted** while in cart → flagged "no longer available", excluded from the order (never silently ordered).
- Product goes **OUT_OF_STOCK** → line flagged; blocked from ordering (LOW allowed with a warning).
- **Access expires** while items in cart → cart prices lock; "Place order" disabled with a renew prompt.
- **Blocked** customer → cart frozen, ordering denied immediately.
- Empty cart placement → rejected. Stale cart (items changed) → re-validated at placement; user shown a diff before confirming.
- Two tabs / race placing the same cart → idempotent single order (transactional clear+create).
- Variant (Phase 11) removed/renamed → line re-validated.
- Session expires mid-checkout → re-auth.
- Cancellation: customer may cancel within a window / before admin CONFIRMED; after that admin-only. All transitions audited.

**UI (per §0 — custom components, all states):**
- **Add to cart** with qty stepper (respects MOQ + caps) from listing/compact/table/quick-view/detail — optimistic, toast, cart badge in header updates.
- **Cart page** (`/account/cart`): line items (image, name, brand, variant, unit price, stepper, line total, remove), inline MOQ/stock/availability warnings, subtotal + item count, sticky mobile summary, "Place order", rich empty state, skeleton/error.
- **Place-order → confirmation** page with order number + "what happens next" (we'll contact you to confirm & arrange dispatch).
- **Order history** (`/account/orders`): list + status chips, order detail, **reorder** (re-add available items), cancel (when allowed).
- **Admin orders** (`/admin/orders`): queue (new PLACED badge + push notification), order detail, **status management** (custom control, audited), admin notes, notify customer, filters + Pager + CSV export, and an abuse view (orders per customer, flags).
- Prices everywhere obey the gate (only shown to the approved owner; admin sees all).

**Gate:** approved customer can cart → place → see it in history; **a manipulated price/quantity in the request is ignored** (server recomputes) — an explicit exploit test; expired/blocked/pending cannot cart or order; rate limits + idempotency proven (no duplicate orders under double-submit/flood); IDOR test (cannot read another's cart/order); inactive/out-of-stock/price-change corner cases handled; typecheck+lint+vitest green; price-gate invariant extended to cart/order payloads.
**Sequencing:** its own schema step (Cart/Order models), then a build workflow; best after Brand + Variants so line snapshots carry brand/variant. Not required for first launch, but high-value.

### Phase 9 — Hardening & launch
**Goal:** production confidence.
**Build/do:** full E2E regression suite as CI; load sanity (k6: 200 concurrent browsers, grid with 5k products); **final adversarial security review** (fresh panel, whole system: price gate, session fixation, IDOR on admin actions, R2 presign scope, rate-limit bypass, cache poisoning of ISR pages); Sentry + structured logging; security headers (CSP, HSTS) verified; Atlas indexes reviewed against slow-query log; backup/restore drill (Atlas snapshot → staging); deploy pipeline (preview → production, env checklist); DEPLOYMENT.md runbook (Atlas / R2 / Upstash / Turnstile / VAPID setup, domain, Cloudflare in front); UAT script for you (the admin) with real catalog data.
**Gate:** security panel signs off (2 clean rounds); UAT complete; production deploy live behind your domain.

## 7. Testing Strategy (cumulative — every gate re-runs everything)

| Layer | Tool | Focus |
|---|---|---|
| Unit | Vitest | money/paise math, slug, zod schemas, grid command stack, series-fill logic |
| Integration | Vitest + mongodb-memory-server | DAL projections (price-gate!), services, lifecycle transitions |
| E2E | Playwright | user journeys both surfaces, camera (fake media), offline mode, keyboard-only grid session |
| Security invariants | Playwright + fetch assertions | §5 suite — price absence, cookie flags, rate limits — **runs in every phase gate from Phase 2 on** |
| Performance | Lighthouse CI + Playwright traces | storefront ≥ 90/95, grid frame budget, 4G throttle profiles |

## 8. Scalability Notes (how this stays fast as it grows)

- **Reads scale via CDN:** anonymous catalog = ISR pages on Vercel's edge — 10× traffic costs ~nothing and can't leak prices (§2). Approved-customer SSR is the only dynamic read path, sized in the hundreds, trivial.
- **Mongo indexes** (already in schema) cover every hot path: `(categoryId,status)`, `slug`, `sku`, `(status,createdAt)` on requests, `(customerId,expiresAt)` on grants, `(productId,createdAt)` on views. PageView grows fastest → TTL index (180 days) + pre-aggregated daily counters for the dashboard.
- **Images:** R2 + CDN, compressed client-side before upload, thumbnails generated once — the app never proxies image bytes.
- **Grid:** virtualization means 50k SKUs renders the same as 500; autosave batches writes.
- **Stateless app tier** (sessions in DB, limits in Redis) → horizontal scaling is a slider, or a later move to a VPS/containers with zero code change.
- **Growth path:** M0 → Flex/M10 (data), Hobby → Pro/VPS (traffic), add read-heavy caching (Redis) only if dashboards demand it. Nothing re-architects.

## 9. Workflow Execution Model (how development actually runs)

Each phase = one orchestrated workflow run, reviewed by you between phases:

1. **Scout** (inline): confirm current repo state, define the phase work-list.
2. **Fan-out build**: parallel builder agents with **exclusive file ownership** (the §3 tree is the ownership map; overlapping work runs in git worktrees and merges via an integration agent).
3. **Integrate**: one agent wires seams, resolves types, gets `npm run ci` green.
4. **Adversarial verify**: independent agents per acceptance criterion / attack vector — they try to *break* the phase, not confirm it (security panels prompt agents to extract prices; grid panel replays the PRD numbers).
5. **Fix loop**: findings → targeted fix agents → re-verify until 2 consecutive clean rounds.
6. **Gate report**: what shipped, what the verifiers tried, evidence (test output, screenshots, traces) — then you approve the next phase.

**Sequencing:** 0 → 1 → 2 strictly serial (foundations). 3 and the start of 4 can overlap. 5 needs 4; 6 needs 2 (+ grid for CustomerSheet); 7 needs 2 (+1); 8 needs 3/6/7; 9 is last.

**Definition of done (whole project):** every PRD feature F-A/F-C/F-U/F-G implemented or explicitly deferred with your sign-off; security invariants green since Phase 2; both PWAs installed and used for a real day of business (UAT); production deployment documented and live.

## 10. Effort Envelope

| Phase | Relative size | Notes |
|---|---|---|
| 0 Foundations | S | plumbing |
| 1 Design system | M | sets the visual bar |
| 2 Auth + price gate | M | security core, frozen after |
| 3 Catalog admin | L | camera flow is the novel part |
| 4 DealSheet | **XL** | the differentiator — largest single investment |
| 5 Import/export | M | rides on 4 |
| 6 Customers/access | L | business loop + push |
| 7 Storefront | L | design-heavy |
| 8 PWA/motion | M | polish with hard device gates |
| 9 Hardening | M | panels + deploy |

Serial-equivalent estimate: **7–9 weeks**; workflow parallelism compresses wall-clock substantially, bounded by the serial spine (0→1→2→4).
