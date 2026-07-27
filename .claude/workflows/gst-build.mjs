export const meta = {
  name: 'gst-build',
  description: 'Build Phase 13 GST/tax: pure tax core, price-gated data layer, orders, admin + retailer UI, adversarial verify',
  phases: [
    { title: 'Core', detail: 'pure paise-exact tax + GSTIN utils + tests' },
    { title: 'Settings', detail: 'SellerTaxProfile service + admin Tax settings + display pref' },
    { title: 'Gating', detail: 'product/variant DTOs + DAL + price-slot tax rendering' },
    { title: 'Orders', detail: 'compute+snapshot tax at placement; cart + order breakup' },
    { title: 'AdminUI', detail: 'category/product/grid/CSV tax fields' },
    { title: 'RetailerUI', detail: 'labels, incl/excl toggle, customer GSTIN/state' },
    { title: 'Integrate', detail: 'typecheck+lint+vitest green' },
    { title: 'Verify', detail: 'adversarial: price-gate leak, tax math, intra/inter, conventions' },
  ],
}

// ── Shared context handed to every agent (they have none of the driver's) ──
const ENV = [
  'BUILD ENV (prefix any shell command with this — the default node is v16 and breaks the toolchain):',
  '  export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && export DATABASE_URL=\'mongodb://127.0.0.1:27018/memorydeals?replicaSet=rs0local&directConnection=true\'',
  'Typecheck: npx tsc --noEmit   Lint: npx eslint <files>   Tests: npx vitest run <files>',
].join('\n')

const RULES = [
  'PROJECT: "The Memory Deals" — gated B2B wholesale mobile-accessories catalog. Next.js 16 App Router (Turbopack), TypeScript strict, Tailwind v4 (CSS-first tokens in src/app/globals.css), Base UI wrappers in src/components/ui/, motion/react, Prisma 6 + MongoDB.',
  '',
  'NON-NEGOTIABLE CONVENTIONS:',
  '1. MONEY IS INTEGER PAISE. ₹499.50 === 49950. Never floats at rest. Use src/lib/money.ts (formatPaise, assertPaise, parseRupees). GST math is integer-only.',
  '2. THE PRICE GATE IS SACRED. DAL projections omit money for non-approved viewers. PublicProduct/PublicVariant structurally have NO money fields (mappers copy an explicit allow-list, never {...raw}). PricedProduct/PricedVariant add them. canSeePrices(viewer) gates. A GST AMOUNT (taxable/tax/cgst/sgst/igst/gross paise) IS A PRICE → it lives ONLY on the Priced projection and only reaches approved customers. HSN code, gstRateBps, and a taxInclusive boolean are NON-monetary public metadata and MAY appear on the Public projection (to render the "incl./+ X% GST" label) — but NEVER a computed paise amount.',
  '3. "use server" files (src/server/actions/*) may export ONLY async functions. No export const / export type / re-exported types from them — the server-actions loader throws at runtime otherwise. Put types/schemas in a non-"use server" module and import them.',
  '4. NO native UI: no <select>, window.alert/confirm/prompt. Use the Base UI wrappers in src/components/ui/ (Select needs items={[{value,label}]}). Custom components, all states (loading/empty/error/skeleton). No hardcoded hex — use semantic Tailwind tokens (bg-card, text-muted-foreground, border-border, text-primary, etc.) so light/dark both work.',
  '5. Admin mutations assert admin + assertPermission(<key>) and writeAudit(...). Customer data is per-customer IDOR-protected (use viewer.customerId only, never a client-supplied id).',
  '6. Server-authoritative: never trust client price/qty/tax. Tax is computed server-side from stored data.',
  '',
  'GST FEATURE (Phase 13) — the full spec is in IMPLEMENTATION_PLAN.md under "Phase 13 — GST / tax rules"; READ IT. Schema is ALREADY migrated (prisma/schema.prisma, client generated): Product/ProductVariant have hsnCode/gstRateBps/taxTreatment; Category has defaultHsnCode/defaultGstRateBps; Customer has gstStateCode/placeOfSupplyStateCode; Order has the frozen tax snapshot (taxApplied, supplyType, sellerStateCode, sellerGstin, placeOfSupplyStateCode, totalTaxablePaise, totalCgstPaise, totalSgstPaise, totalIgstPaise, totalTaxPaise, roundOffPaise, grandTotalPaise, hsnSummary Json); SellerTaxProfile is a singleton (key="default"): gstEnabled, gstin, legalName, stateCode, priceEntryMode (TaxTreatment), displayMode (PriceDisplayMode), roundingMode, defaultGstRateBps (default 1800), defaultHsnCode. Enums: TaxTreatment{TAX_EXCLUSIVE,TAX_INCLUSIVE}, SupplyType{INTRA,INTER}, RoundingMode{LINE,INVOICE}, PriceDisplayMode{INCLUSIVE,EXCLUSIVE}.',
  '',
  'GLOBAL KILL-SWITCH: when SellerTaxProfile.gstEnabled is false the app must behave EXACTLY as pre-GST — no tax figures anywhere, order totals unchanged (subtotalPaise is the total, tax fields null). This is the default. Everything you build must no-op cleanly when gstEnabled is false.',
  '',
  'FILE OWNERSHIP: only create/edit files in YOUR slice (listed in your task). Do not touch another slice\'s files. Read anything you need.',
].join('\n')

const preamble = RULES + '\n\n' + ENV + '\n\n'

// ═══════════════════════════════════════════════════════════════════════════
// Stage 1 — CORE (pure, must be exact). Everything downstream builds on this.
// ═══════════════════════════════════════════════════════════════════════════
phase('Core')
const CORE_API = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'exports', 'testsPassing', 'notes'],
  properties: {
    files: { type: 'array', items: { type: 'string' }, description: 'files created' },
    exports: { type: 'array', items: { type: 'string' }, description: 'exported symbol names with a terse signature each' },
    testsPassing: { type: 'boolean' },
    notes: { type: 'string', description: 'anything downstream consumers must know about the API' },
  },
}
const core = await agent(
  preamble +
  'TASK — build the PURE, integer-exact GST core + GSTIN utilities with exhaustive unit tests. No React, no Prisma, no I/O. YOUR FILES: src/lib/gst.ts, src/lib/gst.test.ts, src/lib/gstin.ts, src/lib/gstin.test.ts.\n\n' +
  'Implement in src/lib/gst.ts EXACTLY this API (downstream code depends on these names/shapes):\n' +
  '- type TaxTreatment = "TAX_EXCLUSIVE" | "TAX_INCLUSIVE" (import from @prisma/client if exported, else define & keep assignable).\n' +
  '- type SupplyType = "INTRA" | "INTER".\n' +
  '- interface LineTax { taxablePaise: number; taxPaise: number; grossPaise: number }\n' +
  '- computeLineTax(input: { amountPaise: number; gstRateBps: number; treatment: TaxTreatment }): LineTax\n' +
  '    EXCLUSIVE: taxablePaise = amountPaise; taxPaise = Math.round(amountPaise * gstRateBps / 10000); grossPaise = taxablePaise + taxPaise.\n' +
  '    INCLUSIVE: grossPaise = amountPaise; taxablePaise = Math.round(amountPaise * 10000 / (10000 + gstRateBps)); taxPaise = grossPaise - taxablePaise (tax is the REMAINDER so taxablePaise + taxPaise === grossPaise ALWAYS — no independent rounding).\n' +
  '    gstRateBps === 0 → taxPaise 0, taxable === gross === amount. Validate inputs with assertPaise/Number.isInteger; gstRateBps a non-negative integer.\n' +
  '- interface TaxSplit { supplyType: SupplyType; cgstPaise: number; sgstPaise: number; igstPaise: number }\n' +
  '- splitTax(taxPaise: number, supplyType: SupplyType): TaxSplit  — INTRA: cgstPaise = Math.floor(taxPaise/2), sgstPaise = taxPaise - cgstPaise (remainder to SGST, no drift), igstPaise 0. INTER: igstPaise = taxPaise, cgst/sgst 0.\n' +
  '- determineSupplyType(sellerStateCode: string | null | undefined, placeOfSupplyStateCode: string | null | undefined): SupplyType | null — both present & equal → "INTRA"; both present & differ → "INTER"; if either missing → null (caller shows a combined "GST @X%" and does NOT split).\n' +
  '- roundToRupee(paise: number): { grandTotalPaise: number; roundOffPaise: number } — nearest rupee; roundOffPaise = grandTotalPaise - paise (may be negative). For the optional INVOICE rounding mode.\n' +
  '- A helper to aggregate an array of priced lines into order totals + an HSN summary grouped by (hsnCode, gstRateBps): sum taxable/tax, split each line by supplyType, and (INVOICE mode) apply one round-off at the end. Export it as summariseOrderTax(lines, opts) with a clear typed shape; design the line + return types sensibly and document them in notes.\n\n' +
  'src/lib/tax-inherit.ts is NOT yours (settings stage owns inheritance) — do NOT create it. But DO make computeLineTax/splitTax the single source of truth so it can be reused.\n\n' +
  'Implement src/lib/gstin.ts: isValidGstin(s: string): boolean (15 chars: 2-digit state + 10-char PAN + entity/Z/checksum; implement the official GSTIN checksum algorithm), gstinStateCode(s): string | null (first two chars if structurally valid), and export GST_STATE_CODES: a record of the 2-digit code → state name for all Indian states/UTs. gstin.test.ts must cover valid/invalid/checksum-fail/wrong-length and a couple of real-format sample GSTINs.\n\n' +
  'TESTS (Vitest, co-located *.test.ts): be exhaustive for gst.ts — inclusive↔exclusive round-trip (taxablePaise+taxPaise===grossPaise for many amounts/rates incl. 0/5/12/18/28% and odd paise like 1,3,99,49950), the CGST/SGST no-drift split (cgst+sgst===tax for odd tax like 451), IGST path, determineSupplyType matrix, roundToRupee up/down/exact, and summariseOrderTax over a mixed-rate multi-line set (grouping + totals + INVOICE round-off). Run: (BUILD ENV) then npx vitest run src/lib/gst.test.ts src/lib/gstin.test.ts — they MUST pass. Also run npx tsc --noEmit and fix any error you introduced.\n\n' +
  'Return the structured API summary.',
  { phase: 'Core', label: 'core:gst+gstin', schema: CORE_API, effort: 'high' },
)
log('Core done: ' + (core?.testsPassing ? 'tests green' : 'CHECK TESTS') + '. Exports: ' + (core?.exports || []).join(', '))

// ═══════════════════════════════════════════════════════════════════════════
// Stage 2 — SETTINGS: SellerTaxProfile service + admin Tax page + inheritance
// + display-preference plumbing (incl/excl toggle cookie).
// ═══════════════════════════════════════════════════════════════════════════
phase('Settings')
const settings = await agent(
  preamble +
  'CONTEXT: the tax core exists now — src/lib/gst.ts (computeLineTax, splitTax, determineSupplyType, roundToRupee, summariseOrderTax) and src/lib/gstin.ts (isValidGstin, gstinStateCode, GST_STATE_CODES). API notes from that stage: ' + (core?.notes || '(none)') + '\n\n' +
  'TASK — the SellerTaxProfile settings + tax-inheritance resolver + admin Tax settings page + display-preference plumbing.\n\n' +
  'YOUR FILES (create unless noted):\n' +
  '- src/server/services/tax-profile.ts (or dal): getSellerTaxProfile() — reads/creates the singleton (key="default") and returns it (cache with React cache() like other DAL reads); updateSellerTaxProfile(input) — admin-guarded upsert (assertPermission — add a new permission key e.g. "settings.tax.manage" to src/lib/permissions.ts catalog and grant it to the Owner/system role seed) + writeAudit. Validate GSTIN via isValidGstin; when a GSTIN is set, derive/validate its stateCode.\n' +
  '- src/lib/tax-inherit.ts: PURE resolver resolveEffectiveTax({ product-ish fields, category defaults, profile }) → { hsnCode: string|null, gstRateBps: number, treatment: TaxTreatment } following product/variant → category → profile precedence. Also a helper to resolve a variant\'s effective tax (variant → product → category → profile). Unit-test it (tax-inherit.test.ts).\n' +
  '- Admin page: an admin "Settings → Tax" route under the admin route group. If NO admin settings section exists yet, create the route (e.g. src/app/(admin)/admin/settings/tax/page.tsx) and add a "Settings" (or "Tax") entry to the admin nav/sidebar config (find it — likely src/components/shell/nav or AdminShell). The page: a form to edit gstEnabled (Switch), gstin (+inline validity), legalName, stateCode (Select of GST_STATE_CODES), priceEntryMode, displayMode, roundingMode (Selects), defaultGstRateBps (as a percent input, store bps), defaultHsnCode. Use Base UI wrappers; all states; a server action (its own "use server" file exporting only async fns) that calls updateSellerTaxProfile. Show a live worked example ("₹1000 at 18% exclusive → ₹1180"). Clear copy explaining inclusive vs exclusive.\n' +
  '- Display preference: a small server helper to read/write a cookie e.g. gst_view = incl|excl (mirror any existing storefront preference cookie pattern — search for how view-mode / UI prefs cookies are done). Export getGstViewPreference() and a tiny client toggle component the retailer UI stage will place. Default to the profile.displayMode when the cookie is unset.\n\n' +
  'Do NOT touch product/variant DTOs, the products DAL, orders, cart, or the catalog editor forms — other stages own those. Run BUILD ENV typecheck on your files + your unit test. Return a terse summary of exported symbols + the admin route path + the permission key + the cookie name.',
  { phase: 'Settings', label: 'settings:profile+admin', effort: 'high' },
)
log('Settings done.')

// ═══════════════════════════════════════════════════════════════════════════
// Stage 3 — GATING: product/variant DTOs + DAL + price-slot tax rendering.
// The highest-risk slice for the price gate.
// ═══════════════════════════════════════════════════════════════════════════
phase('Gating')
const gating = await agent(
  preamble +
  'CONTEXT: core = src/lib/gst.ts + src/lib/gstin.ts; inheritance = src/lib/tax-inherit.ts (resolveEffectiveTax); settings = getSellerTaxProfile() in the tax-profile service; display pref via getGstViewPreference(). Settings stage summary: ' + (settings || '(see files)') + '\n\n' +
  'TASK — thread GST through the product/variant DTOs, the products DAL, and price rendering, WITHOUT EVER leaking a tax amount to a gated viewer.\n\n' +
  'YOUR FILES: src/server/dto/product.ts, the variant DTO module it imports (src/server/dto/variant.ts or similar), src/server/dal/products.ts, src/components/storefront/priceSlot.tsx, and any small tax-aware price-format/label component you add under src/components/storefront/ (e.g. GstPriceLabel.tsx). Plus co-located tests.\n\n' +
  'DTOs — extend the allow-list mappers (NEVER {...raw}):\n' +
  '- PUBLIC projection (PublicProduct/PublicVariant): add ONLY non-monetary metadata — hsnCode: string|null, gstRateBps: number|null, and a boolean like taxInclusive (whether the shown price is inclusive, derived from effective treatment). NO paise. These let the storefront render "incl./+ 18% GST" text for anyone. When gstEnabled is false, set them so the UI shows nothing (e.g. gstRateBps null).\n' +
  '- PRICED projection (PricedProduct/PricedVariant): add a computed tax breakdown for the displayed price — e.g. taxBreakdown: { taxablePaise, taxPaise, grossPaise, gstRateBps, treatment } computed via resolveEffectiveTax + computeLineTax from the stored price. This is the ONLY place paise tax appears.\n' +
  'The gated mapper (toPublicProduct/Variant) must be STRUCTURALLY incapable of carrying taxBreakdown — assert via a test that "taxBreakdown" is not a key and no tax paise exists on any public DTO.\n\n' +
  'DAL — src/server/dal/products.ts: the gated select must NOT select anything only needed to compute tax amounts beyond hsnCode/gstRateBps/taxTreatment (those are fine as public metadata). The priced path resolves effective tax using the product\'s category defaults + the SellerTaxProfile. Fetch the profile once per request (cache) and pass it into the mappers; keep the mapper signature changes minimal and update ALL call sites in this file.\n\n' +
  'RENDERING — priceSlot.tsx / GstPriceLabel: when gstEnabled and the viewer is priced, render the price with its treatment ("₹499 incl. 18% GST" or "₹499 + 18% GST" depending on effective treatment and the viewer\'s incl/excl display preference), optionally a small "incl. ₹X GST" subline. For a gated viewer, render EXACTLY as today plus (optionally) a neutral "+18% GST" hint using only the public gstRateBps (no amount). When gstEnabled is false, render exactly as today. Keep the existing PriceGateCard/locked behaviour intact.\n\n' +
  'TESTS: extend/adds — public DTO has no tax paise (adversarial), priced DTO taxBreakdown matches computeLineTax, gstEnabled=false yields today\'s shapes. Run BUILD ENV: npx tsc --noEmit and vitest on the product DTO/DAL tests. Return a terse summary incl. the exact new DTO field names.',
  { phase: 'Gating', label: 'gating:dto+dal+slot', effort: 'high' },
)
log('Gating done.')

// ═══════════════════════════════════════════════════════════════════════════
// Stage 4 — ORDERS: compute + snapshot tax at placement; cart + order breakup.
// ═══════════════════════════════════════════════════════════════════════════
phase('Orders')
const orders = await agent(
  preamble +
  'CONTEXT: core (computeLineTax/splitTax/determineSupplyType/roundToRupee/summariseOrderTax), inheritance (resolveEffectiveTax), settings (getSellerTaxProfile), and the priced DTO taxBreakdown from the gating stage: ' + (gating || '(see src/server/dto/product.ts)') + '\n\n' +
  'TASK — make orders and the cart GST-aware, server-authoritatively.\n\n' +
  'YOUR FILES: src/server/services/orders.ts, src/server/services/cart.ts (whatever computes cart lines/subtotal for the view), the order DTO/rendering used by admin + customer order views (find them — src/server/dto or the order view components), and the cart summary UI in src/app/(storefront)/account/cart/CartView.tsx (the Summary + sticky mobile bar sections). Co-located tests.\n\n' +
  'PLACEMENT (orders.ts placeOrder): after pricing each line server-side (as today), if profile.gstEnabled: resolve each line\'s effective tax, computeLineTax from the server unit price, determine supplyType from profile.stateCode vs the customer\'s place of supply (customer.gstStateCode ?? customer.placeOfSupplyStateCode), split each line, and snapshot into the Order — per-line tax fields inside items[] AND the order-level totals (taxApplied true, supplyType, sellerStateCode, sellerGstin, placeOfSupplyStateCode, totalTaxablePaise, totalCgst/Sgst/Igst, totalTaxPaise, roundOffPaise, grandTotalPaise, hsnSummary) via summariseOrderTax. FREEZE the rate — the order stores the rate used, so a later catalog change never alters it. If gstEnabled is false: leave every tax field null and behave EXACTLY as today (subtotalPaise is the total). Keep the whole thing inside the existing atomic transaction; do not weaken the anti-cheat / IDOR / idempotency guarantees.\n\n' +
  'If supplyType is null (customer has no place of supply): still compute total tax (combined, no cgst/sgst/igst split — leave splits null, set totalTaxPaise) so the grand total is correct; the UI will show a combined "GST @X%" + a prompt to add GSTIN. Do NOT block placement on missing GSTIN.\n\n' +
  'CART: cart.ts computes a gated live view (approved customers only). Add a tax summary to the cart payload when gstEnabled — per-line taxable+tax and an order-preview summary (taxable subtotal, CGST/SGST or IGST or combined, grand total) using the SAME core functions. CartView Summary + sticky mobile bar: show the tax summary block + grand total (the "Place order" total should reflect grand total). Respect the incl/excl display preference for line display but always show the tax summary. When gstEnabled false, cart looks exactly as today.\n\n' +
  'ORDER VIEWS: customer confirmation/history + admin order detail render the frozen breakup (per-line, HSN summary table, CGST/SGST or IGST, round-off, grand total, supply type + both GSTINs) and label the customer-facing doc "Proforma / Quotation — not a tax invoice". Prices obey the gate (only the owner/admin see amounts).\n\n' +
  'TESTS: placement math (intra split, inter IGST, mixed rate, inclusive vs exclusive, rate-freeze — a later product price/rate change leaves a placed order unchanged), gstEnabled=false parity (order identical to today). Run BUILD ENV typecheck + the orders/cart tests. Return a terse summary of the order snapshot shape + any items[] line tax fields.',
  { phase: 'Orders', label: 'orders:tax-snapshot', effort: 'high' },
)
log('Orders done.')

// ═══════════════════════════════════════════════════════════════════════════
// Stage 5 & 6 — UI slices (disjoint files) can run in parallel.
// ═══════════════════════════════════════════════════════════════════════════
phase('AdminUI')
const uiWork = await parallel([
  () => agent(
    preamble +
    'CONTEXT: core, inheritance (resolveEffectiveTax), settings (getSellerTaxProfile), gating DTO fields (' + (gating || 'see dto/product.ts') + '). Schema already has the tax fields on Product/ProductVariant/Category.\n\n' +
    'TASK — admin CATALOG tax editing. YOUR FILES: the admin category form, the product editor form (src/components/admin/products/ProductEditorForm.tsx) + variant editor, the DealSheet grid columns (src/components/admin/products-grid/productColumns.ts + adapters), and CSV import/export (src/server/services/import.ts, src/server/services/import-variants.ts, export service + the admin import UI columns). Their server actions.\n\n' +
    '- Category form: defaultHsnCode + defaultGstRateBps (percent input → store bps). Product/variant editor: hsnCode, gstRateBps (percent), taxTreatment override (Select incl. an "Inherit" option = null). Show the RESOLVED effective values (via resolveEffectiveTax) as helper text so the admin sees what applies.\n' +
    '- DealSheet grid: add editable HSN + GST% columns (validated: rate a non-negative number → bps; HSN a short string) reusing the grid validatePatch/command-stack pattern; respect the variant-managed guard (variant products keep price read-only — mirror existing behaviour).\n' +
    '- CSV import: accept hsn_code, gst_rate, tax_inclusive columns (map + validate; percent→bps; tax_inclusive truthy→TAX_INCLUSIVE). CSV export + template: add the same columns. Keep single-product and variant-row paths correct.\n' +
    'All admin mutations: assertPermission + writeAudit (reuse existing product/category permission keys). Integer paise / bps only; no native UI; tokens not hex. Run BUILD ENV typecheck on your files. Return a terse summary.',
    { phase: 'AdminUI', label: 'admin:catalog-tax', effort: 'medium' },
  ),
  () => agent(
    preamble +
    'CONTEXT: core, settings (getSellerTaxProfile + getGstViewPreference + the incl/excl toggle component from the settings stage), gating public DTO fields (hsnCode/gstRateBps/taxInclusive) + priced taxBreakdown (' + (gating || 'see dto/product.ts') + ').\n\n' +
    'TASK — retailer-facing GST surfaces EXCEPT cart/order (orders stage owns those). YOUR FILES: the incl/excl toggle placement in the storefront shell or listing header, product listing/card price rendering that consumes priceSlot/GstPriceLabel (only if not already handled by the gating stage — coordinate by NOT duplicating; if the gating stage\'s GstPriceLabel already renders labels, you just place the toggle + ensure product detail page shows a clear tax line), the product DETAIL page tax line, and the CUSTOMER PROFILE edit surface for GSTIN + billing/place-of-supply state.\n\n' +
    '- Place a small incl/excl GST view toggle (from the settings stage) in a sensible storefront spot (e.g. listing toolbar / account area); persist via its cookie; only show it when gstEnabled.\n' +
    '- Product detail: a clear tax treatment line near the price ("Price incl. 18% GST" / "+ 18% GST", and for approved viewers the "incl. ₹X GST" amount from taxBreakdown). Gated viewers: label only, no amount. gstEnabled false → nothing.\n' +
    '- Customer profile: find where a logged-in customer edits their details (business name / gstNumber). Add GSTIN capture with isValidGstin validation → on save, derive gstStateCode; add an explicit place-of-supply state Select (GST_STATE_CODES) → placeOfSupplyStateCode. Server action is per-customer IDOR-safe (viewer.customerId only), "use server" async-only. Explain to the retailer this unlocks the correct CGST/SGST vs IGST split.\n' +
    'Base UI wrappers; all states; tokens not hex. Run BUILD ENV typecheck on your files. Return a terse summary + the customer profile route/action touched.',
    { phase: 'RetailerUI', label: 'retail:labels+profile', effort: 'medium' },
  ),
])
log('UI slices done: ' + uiWork.filter(Boolean).length + '/2')

// ═══════════════════════════════════════════════════════════════════════════
// Stage 7 — INTEGRATE: make the whole repo green.
// ═══════════════════════════════════════════════════════════════════════════
phase('Integrate')
const integrate = await agent(
  preamble +
  'TASK — INTEGRATION. Six slices just landed GST across the codebase (core, settings, gating, orders, admin UI, retailer UI). Wire the seams and make the WHOLE repo green. You may edit ANY file to resolve type mismatches, duplicate components, mismatched imports, or broken call sites created by the parallel work.\n\n' +
  'Run (BUILD ENV):\n' +
  '1. npx tsc --noEmit — fix every error.\n' +
  '2. npx eslint src --ext .ts,.tsx — fix errors (warnings ok if pre-existing).\n' +
  '3. npx vitest run — the FULL suite (currently ~588 tests pre-GST plus the new GST tests). Fix real breakages. If a single test flakes on a shared-Mongo race, re-run once to confirm.\n' +
  'Watch specifically for: two stages both adding a price-label component (dedupe to one), the SellerTaxProfile fetch not being threaded to a mapper call site, order/cart total field renames, and any "use server" file that accidentally exports a non-async (move it). Do NOT weaken the price gate or the kill-switch (gstEnabled=false parity) to make a test pass.\n\n' +
  'Return: final counts (tsc clean? eslint errors? tests passed/total) and a bullet list of the seams you fixed.',
  { phase: 'Integrate', label: 'integrate:green', effort: 'high' },
)
log('Integrate: ' + integrate.slice(0, 200))

// ═══════════════════════════════════════════════════════════════════════════
// Stage 8 — ADVERSARIAL VERIFY (parallel panel). Try to BREAK it.
// ═══════════════════════════════════════════════════════════════════════════
phase('Verify')
const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'pass', 'findings'],
  properties: {
    area: { type: 'string' },
    pass: { type: 'boolean', description: 'true only if you could NOT break it' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'detail', 'file'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          title: { type: 'string' },
          detail: { type: 'string', description: 'concrete repro / evidence' },
          file: { type: 'string' },
        },
      },
    },
  },
}
const verifyTasks = [
  ['price-gate-leak', 'THE PRICE GATE IS SACRED. Try to prove a TAX AMOUNT (taxablePaise/taxPaise/cgst/sgst/igst/grossPaise) reaches a NON-approved viewer. Inspect the public DTO mappers (toPublicProduct/Variant) — confirm no tax paise key exists structurally; inspect the products DAL gated select; inspect priceSlot/GstPriceLabel for any branch that reads a tax amount when !canSeePrices; inspect listing/search/product pages for a server-rendered tax amount on the gated path; check the cart/order endpoints refuse non-approved. Grep for taxBreakdown/taxPaise usage on public paths. Write/keep a test asserting no tax paise on any Public projection. Report any leak as CRITICAL.'],
  ['tax-math', 'Audit src/lib/gst.ts + its use. Verify: computeLineTax INCLUSIVE keeps taxablePaise+taxPaise===grossPaise for adversarial amounts/rates (odd paise, 0/5/12/18/28%); EXCLUSIVE rounding is sane; splitTax cgst+sgst===tax with NO drift for odd tax; summariseOrderTax totals equal the sum of lines and the HSN grouping is correct; roundToRupee/roundOff is exact. Actually RUN the test suite (BUILD ENV: npx vitest run src/lib/gst.test.ts and the orders tax tests) and try inputs the tests miss. Report drift/rounding bugs.'],
  ['intra-inter-freeze', 'Verify determineSupplyType + placement: seller state == customer place-of-supply → CGST+SGST; differ → IGST; missing → combined (no bogus split). Verify the placed Order FREEZES the rate — construct/inspect the logic so that changing a product\'s gstRateBps or price AFTER placement does not change the stored order totals (there is or should be a test — run it). Verify gstEnabled=false yields an order byte-identical in shape to pre-GST (all tax fields null, subtotalPaise is the total). Report violations.'],
  ['conventions', 'Audit the GST diff for project rules: (a) every src/server/actions/*.ts touched exports ONLY async functions (no export const/type) — grep and verify; (b) money/tax is integer paise/bps everywhere, no floats stored, no parseFloat into a stored amount; (c) no native <select>/window.alert/confirm and no hardcoded hex in new UI (tokens only); (d) admin tax mutations call assertPermission + writeAudit; (e) customer GSTIN/profile action is IDOR-safe (viewer.customerId only). Report each violation with file+line.'],
]
const verdicts = await parallel(
  verifyTasks.map(([area, brief]) => () =>
    agent(
      preamble +
      'ADVERSARIAL VERIFY — area: ' + area + '. You are trying to BREAK the just-built GST feature, not confirm it. Be skeptical; default to pass:false if unsure. Read the relevant files and RUN commands (BUILD ENV) where useful.\n\n' + brief + '\n\nReturn the structured verdict (pass=true ONLY if you could not break it).',
      { phase: 'Verify', label: 'verify:' + area, schema: VERDICT, effort: 'high' },
    ),
  ),
)
const clean = verdicts.filter(Boolean)
const allFindings = clean.flatMap((v) => (v.findings || []).map((f) => ({ ...f, area: v.area })))
const criticalOrHigh = allFindings.filter((f) => f.severity === 'critical' || f.severity === 'high')
log('Verify: ' + clean.filter((v) => v.pass).length + '/' + clean.length + ' clean; ' + criticalOrHigh.length + ' critical/high findings')

return {
  core,
  integrate,
  verify: { verdicts: clean, criticalOrHigh, allFindings },
  summary:
    'GST build complete. Verify panel: ' + clean.filter((v) => v.pass).length + '/' + clean.length + ' areas clean. ' +
    criticalOrHigh.length + ' critical/high findings to review.',
}
