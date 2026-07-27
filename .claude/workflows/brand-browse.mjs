export const meta = {
  name: 'brand-browse',
  description: 'Build Phase 7.9 guided Brand -> Category -> Products storefront drill-down (+ /brands index, breadcrumbs), adversarial verify',
  phases: [
    { title: 'DAL', detail: 'brand-category counts DAL + reusable Breadcrumbs' },
    { title: 'Routes', detail: '/brands index + /b/[slug] rework + /b/[slug]/[categorySlug]' },
    { title: 'Integrate', detail: 'typecheck+lint+vitest green' },
    { title: 'Verify', detail: 'adversarial: price-gate leak, filtering/counts, breadcrumbs/UX' },
  ],
}

const ENV = [
  'BUILD ENV (prefix any shell command; default node is v16 and breaks the toolchain):',
  '  export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && export DATABASE_URL=\'mongodb://127.0.0.1:27018/memorydeals?replicaSet=rs0local&directConnection=true\'',
  'Typecheck: npx tsc --noEmit   Lint: npx eslint <files>   Tests: npx vitest run <files>',
].join('\n')

const RULES = [
  'PROJECT: "The Memory Deals" — gated B2B wholesale mobile-accessories catalog. Next.js 16 App Router (Turbopack), TypeScript strict, Tailwind v4 (CSS-first tokens in src/app/globals.css), Base UI wrappers in src/components/ui/, motion/react, Prisma 6 + MongoDB.',
  '',
  'NON-NEGOTIABLE CONVENTIONS:',
  '1. THE PRICE GATE IS SACRED. Every product surface goes through the viewer-gated DAL. Anon/pending/expired/blocked/rejected see the locked "See price" chip, NEVER a price. Brand names, category names, logos, and COUNTS are public (carry no price). Breadcrumbs/headers/SEO metadata are price-free by construction. Money is integer paise; format only at the UI via src/lib/money.ts.',
  '2. NO native UI: no <select>, window.alert/confirm/prompt. Use Base UI wrappers in src/components/ui/. Custom components, ALL states (loading skeleton / empty / error). No hardcoded hex — semantic Tailwind tokens (bg-card, text-muted-foreground, border-border, text-primary...) so light/dark both work. Respect reduced-motion.',
  '3. "use server" files (src/server/actions/* and inline server actions) may export ONLY async functions. Put types/schemas in a non-"use server" module.',
  '4. Customer data is per-customer IDOR-safe (viewer.customerId only). This feature is READ-ONLY browse — no mutations — but still route every product read through the gated DAL.',
  '5. Match the existing storefront route conventions EXACTLY (read them first).',
  '',
  'FEATURE (Phase 7.9) — full spec is in IMPLEMENTATION_PLAN.md under "Phase 7.9 — Guided browse: Brand -> Category -> Products". READ IT. A guided drill-down: Brand -> Category -> Products, complementing (NOT replacing) the flat /b/[slug], /c/[slug], and /search.',
  '',
  'GROUND TRUTH — build ON these, do NOT duplicate (READ them):',
  '- Routes today: src/app/(storefront)/b/[slug]/page.tsx (brand landing — currently a FLAT product listing, with ./actions.ts loadMoreBrandProducts), src/app/(storefront)/c/[slug]/page.tsx (category listing), src/app/(storefront)/p/[slug] (product), src/app/(storefront)/search/page.tsx (faceted; the reference for wiring discoverProducts + DiscoveryFilters + StorefrontListing), src/app/(storefront)/categories/page.tsx.',
  '- Brand DAL: src/server/dal/brands.ts — getBrandBySlug(slug), listActivePublicBrands(), listByBrandForViewer(viewer, brandId, {page,take}). Categories: src/server/dal/categories.ts listActive().',
  '- Discovery: src/server/storefront/discovery.ts discoverProducts(viewer, params) — params already support categoryId + brandIds[] + search + sort + facet selection + limit. Facet helpers in src/components/storefront/filters/adapter.ts (loadFacetData, selectionToDiscoverParams, toDiscoverSort) + parseSelection.',
  '- Listing UI: src/components/storefront/listing (StorefrontListing, buildListingItems, ListingItem), CategoryGrid (src/components/storefront/CategoryGrid.tsx), BrandShowcase + SectionHeading + FeaturedRail (src/components/storefront/home), price slots (src/components/storefront/priceSlot.tsx renderPriceSlot).',
  '- Shell/session: StorefrontShell (src/components/shell/StorefrontShell.tsx — nav config is under src/components/shell/nav), getViewer + canSeePrices (src/server/auth/viewer, src/server/types/viewer), wishlistStateForViewer, cartCountForViewer, PAGE_SIZES (src/lib/constants), FadeUp (motion primitives).',
  '',
  'FILE OWNERSHIP: only create/edit files in YOUR slice. Read anything.',
].join('\n')

const preamble = RULES + '\n\n' + ENV + '\n\n'

// ── Stage 1: DAL + reusable Breadcrumbs ────────────────────────────────────
phase('DAL')
const dal = await agent(
  preamble +
  'TASK — the price-free DAL surface + a reusable Breadcrumbs component the routes will consume.\n\n' +
  'YOUR FILES: extend src/server/dal/brands.ts (or a new sibling if cleaner) + a new src/components/storefront/Breadcrumbs.tsx + co-located tests.\n\n' +
  '1. listBrandCategoriesForViewer(brandId: string): Promise<Array<{ id, name, slug, image?, count }>> — the ACTIVE, non-deleted categories that have >=1 ACTIVE non-deleted product for this brand, each with the product COUNT (public — NO price). Prefer a single aggregate/groupBy over products filtered by {brandId, status:ACTIVE, deletedAt:null} joined to category, ordered by category sortOrder then name. It takes brandId (not viewer) because it is price-free; keep it efficient (use existing indexes; add none unless clearly needed — flag if you think one is needed rather than editing the schema, which you must NOT touch).\n' +
  '2. A brand product-count helper for the /brands index: countActiveProductsByBrand(): Promise<Record<brandId, number>> (or fold counts into a listing helper). Public, cacheable.\n' +
  '3. Breadcrumbs.tsx: a custom, token-styled, accessible breadcrumb (nav[aria-label="Breadcrumb"] > ol, chevron separators, current page aria-current, truncation on small screens). Props: items: Array<{ label: string; href?: string }> (last item = current, no href). Include an OPTIONAL JSON-LD BreadcrumbList emitter (schema.org) that is PRICE-FREE — either a prop `jsonLd?: boolean` or a tiny sibling helper buildBreadcrumbJsonLd(items, siteUrl). Reduced-motion safe; no library.\n\n' +
  'TESTS: listBrandCategoriesForViewer returns only categories with products for the brand + correct counts (seed a couple products across 2 categories for 1 brand + a third empty category); excludes inactive/deleted. Breadcrumbs renders items + marks the last current. Run BUILD ENV typecheck + your tests. Return the exact exported signatures + the Breadcrumbs props.',
  { phase: 'DAL', label: 'dal:brand-categories+breadcrumbs', effort: 'high' },
)
log('DAL done: ' + String(dal).slice(0, 160))

// ── Stage 2: Routes (two disjoint slices in parallel) ──────────────────────
phase('Routes')
const routes = await parallel([
  // Slice A: brand landing rework + nested brand+category listing
  () => agent(
    preamble +
    'CONTEXT: stage 1 shipped listBrandCategoriesForViewer(brandId) + countActiveProductsByBrand() in the brand DAL and src/components/storefront/Breadcrumbs.tsx. Signatures: ' + String(dal).slice(0, 500) + '\n\n' +
    'TASK — the CATEGORY and PRODUCTS steps of the drill-down. YOUR FILES: src/app/(storefront)/b/[slug]/page.tsx (rework), its src/app/(storefront)/b/[slug]/actions.ts (extend), and a NEW nested route src/app/(storefront)/b/[slug]/[categorySlug]/page.tsx (+ its own actions.ts if needed). Do NOT touch /brands, the nav, or the home page (slice B owns those).\n\n' +
    'REWORK /b/[slug]: LEAD with a brand-scoped category drill-down — a CategoryGrid built from listBrandCategoriesForViewer(brand.id) (each tile links to /b/[slug]/[categorySlug] and shows its count). Keep the brand header (logo+name). Add Breadcrumbs: Brands (/brands) / {Brand}. Keep a prominent "All {brand} products" escape hatch that still shows the existing flat StorefrontListing (reuse the current listByBrandForViewer + loadMore flow — do not regress it; e.g. render the flat listing below the category grid under a "All {brand} products" SectionHeading, or behind a clear link/toggle). Empty state when the brand has no categories/products.\n\n' +
    'NEW /b/[slug]/[categorySlug]: resolve brand (getBrandBySlug) + category (by slug via listActive/categories DAL); 404 if either missing OR the category has no products for the brand. Render Breadcrumbs: Brands / {Brand} / {Category}, a header, and the gated product listing filtered to brand+category by wiring discoverProducts({ brandIds:[brand.id], categoryId }) + the URL facet selection + DiscoveryFilters + StorefrontListing EXACTLY like search/page.tsx (copy its pattern: parseSelection, loadFacetData scoped to {brandId+categoryId? or search}, selectionToDiscoverParams, a "use server" loadMore that re-runs discoverProducts for the next window). force-dynamic (pricing is viewer-gated). Price slots server-rendered; gated viewers get the locked chip. Rich empty state "No {category} products for {brand} yet".\n\n' +
    'Mirror the existing /b/[slug] price-gate + metadata notes (price-free metadata/header). Run BUILD ENV typecheck on your files. Return a terse summary of the routes + how you wired the flat-listing escape hatch.',
    { phase: 'Routes', label: 'routes:brand+category', effort: 'high' },
  ),
  // Slice B: /brands index + nav + home entry
  () => agent(
    preamble +
    'CONTEXT: stage 1 shipped countActiveProductsByBrand() (+ listActivePublicBrands already exists) and src/components/storefront/Breadcrumbs.tsx.\n\n' +
    'TASK — the BRAND entry step. YOUR FILES: a NEW src/app/(storefront)/brands/page.tsx, the storefront nav config (find it under src/components/shell/nav — add a "Brands" primary nav entry + mobile bottom-tab if appropriate WITHOUT overflowing the 4-tab bar; if the bottom tab bar is full, add Brands to the header/desktop nav + a link on the home page instead — use judgement and keep it clean), and a home-page entry point (a link/section to /brands — coordinate: only add a small "Shop by brand -> View all brands" link near the existing BrandShowcase; do NOT restructure the home hero). Do NOT touch /b/[slug] or its children (slice A owns those).\n\n' +
    '/brands: an index of all ACTIVE brands — a searchable/A-Z grid (reuse BrandShowcase or build a denser grid) using listActivePublicBrands() + countActiveProductsByBrand() for per-brand counts. Each brand links to /b/[slug]. Breadcrumbs: Brands (current). Public/price-free -> can be ISR or short-revalidate (export const revalidate = <sensible>) since no pricing is shown; still render inside StorefrontShell. All states (loading skeleton, empty "No brands yet"). Metadata price-free. If there are many brands, group A-Z or make it searchable (a small client filter input, Base UI).\n\n' +
    'Run BUILD ENV typecheck on your files. Return a terse summary + exactly what nav change you made (which nav file + where Brands landed: bottom tab vs header vs home link).',
    { phase: 'Routes', label: 'routes:brands-index+nav', effort: 'medium' },
  ),
])
log('Routes done: ' + routes.filter(Boolean).length + '/2')

// ── Stage 3: Integrate ─────────────────────────────────────────────────────
phase('Integrate')
const integrate = await agent(
  preamble +
  'TASK — INTEGRATION. The Brand->Category->Products drill-down just landed across the storefront (DAL + Breadcrumbs, /brands, /b/[slug] rework, /b/[slug]/[categorySlug], nav). Wire seams and make the WHOLE repo green. Edit ANY file to fix type mismatches, import/nav wiring, or duplicate components.\n\n' +
  'Run (BUILD ENV): 1) npx tsc --noEmit — fix every error. 2) npx eslint src --ext .ts,.tsx — fix errors (pre-existing warnings ok). 3) npx vitest run — the FULL suite; fix real breakages, re-run once if a single test flakes on a shared-Mongo race. Do NOT weaken the price gate to pass a test. Watch for: nav entry added twice, the flat-listing escape hatch regressing the original /b/[slug] behaviour, and any inline "use server" loadMore exporting a non-async.\n\n' +
  'Return final counts (tsc clean? eslint errors? tests passed/total) + a bullet list of seams fixed.',
  { phase: 'Integrate', label: 'integrate:green', effort: 'high' },
)
log('Integrate: ' + String(integrate).slice(0, 200))

// ── Stage 4: Adversarial verify ────────────────────────────────────────────
phase('Verify')
const VERDICT = {
  type: 'object', additionalProperties: false,
  required: ['area', 'pass', 'findings'],
  properties: {
    area: { type: 'string' },
    pass: { type: 'boolean', description: 'true ONLY if you could not break it' },
    findings: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['severity', 'title', 'detail', 'file'],
      properties: {
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        title: { type: 'string' }, detail: { type: 'string' }, file: { type: 'string' },
      },
    } },
  },
}
const verifyTasks = [
  ['price-gate-leak', 'THE PRICE GATE IS SACRED. Try to prove a PRICE reaches a NON-approved viewer anywhere on the new Brand->Category->Products path: /brands, /b/[slug] (reworked), /b/[slug]/[categorySlug]. Inspect each page + its load-more server action — confirm every product read goes through the gated DAL (discoverProducts / listByBrandForViewer / buildListingItems) and that a gated viewer only ever gets the locked chip. Confirm counts/metadata/breadcrumbs are price-free. Grep for any raw price/paise field rendered on these routes. Extend/keep an invariant test asserting no price in a gated payload for the drill-down. Report any leak as CRITICAL.'],
  ['correctness-ux', 'Verify the drill-down is correct: /b/[slug] shows ONLY categories that have active products for that brand, with correct counts; /b/[slug]/[categorySlug] lists exactly the products that are BOTH that brand AND that category (spot-check discoverProducts wiring: brandIds:[brand.id] + categoryId), paginates/load-more works, and 404s when the category has no products for the brand or slug is bogus. Breadcrumbs correct at each level (Brands / Brand / Category) with aria-current on the last. The "All {brand} products" escape hatch still works and did NOT regress the original flat listing. Empty/loading/error states present; responsive; no native <select>/hex. Actually RUN the relevant tests (BUILD ENV). Report gaps.'],
]
const verdicts = await parallel(verifyTasks.map(([area, brief]) => () =>
  agent(
    preamble + 'ADVERSARIAL VERIFY — area: ' + area + '. You are trying to BREAK the just-built feature, not confirm it. Be skeptical; default pass:false if unsure. Read the files and RUN commands (BUILD ENV) where useful.\n\n' + brief + '\n\nReturn the structured verdict.',
    { phase: 'Verify', label: 'verify:' + area, schema: VERDICT, effort: 'high' },
  ),
))
const clean = verdicts.filter(Boolean)
const allFindings = clean.flatMap((v) => (v.findings || []).map((f) => ({ ...f, area: v.area })))
const criticalOrHigh = allFindings.filter((f) => f.severity === 'critical' || f.severity === 'high')
log('Verify: ' + clean.filter((v) => v.pass).length + '/' + clean.length + ' clean; ' + criticalOrHigh.length + ' critical/high')

return {
  integrate,
  verify: { verdicts: clean, criticalOrHigh, allFindings },
  summary: 'Brand->Category->Products build complete. Verify: ' + clean.filter((v) => v.pass).length + '/' + clean.length + ' clean, ' + criticalOrHigh.length + ' critical/high to review.',
}
