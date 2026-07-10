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
