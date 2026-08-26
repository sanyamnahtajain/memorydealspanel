# Order-Flow Audit — "sees a product" → "order placed"

*Read-only code walk, 2026-08-27. No browser; every step traced through the source. Files under
concurrent edit by other agents (allocation/*, quantity*, listing/*, cart.ts) were read as-is —
re-verify those specifics before building.*

---

## Part 1 — The flow as built

### Step 0 · Prerequisites the buyer already crossed

Ordering requires an APPROVED customer with a live access grant (`canSeePrices`). Everyone else
sees locked affordances at every buy control: anon → "Sign in to order" → `/account/login`;
signed-in-but-unapproved → "Approval required to order" → `/account?request=1`. This gate is LAW
and re-checked server-side on every cart mutation and again at placement — nothing below proposes
weakening it.

### Step 1 · Sees a product

Two entry surfaces:

**a) Listing card** (`src/components/storefront/listing/ProductGridView.tsx`, `ProductCompactView.tsx`, `ProductTableView.tsx`)
- Plain in-stock product → `QuickAddToCart` (`src/components/storefront/cart/QuickAddToCart.tsx`):
  ONE tap adds the pack-aligned MOQ. Best moment in the whole flow.
- Variant product → `VariantQuickSheet`: bottom sheet with option pills + add — still no page trip.
- **Allocation-required product → NO quick add at all** (`product.allocation?.required ? null : …`).
  The buyer is forced onto the product page to even start.

**b) Product page** (`src/app/(storefront)/p/[slug]/page.tsx`, 560 lines)
Breadcrumb → header (brand, stock chip, heart) → gallery → price area → buy control →
requirement-note card → WhatsApp enquire → MOQ/pack line → description → specs → related rail →
sticky mobile bar.

### Step 2 · Choosing what to add (the taps)

**Non-variant, non-allocation** (`AddToCartButton.tsx`): stepper (– / typed qty / +, step = one
pack) + "Add to cart". Floor = pack-aligned MOQ; cap = admin `maxQty` (default 200). Typing is
bounded live and snapped to the pack only on blur — never rejected. `clampQuantity`
(`src/lib/quantity.ts`) is the single shared clamp, isomorphic client/server. Taps: ~1–3.

**Variant product** (`VariantSelector.tsx` inside `VariantProductView.tsx`): one chip group per
option axis; impossible combinations disabled; a default variant is pre-selected
(`isDefault` → first in-stock → first), so price/stock show immediately. Add button binds the
selected variant's MOQ/pack. Taps: 0–2 for the pick + stepper + add.

**Allocation product** (`AllocationAddToCart.tsx` + `ModelAllocationBuilder.tsx`, 573 lines):
search-first model picker, paste mode ("S23 Ultra 20" per line, server fuzzy match with a plain
unmatched report), per-model steppers with hold-repeat and "+pack", inline per-model pack/min
errors, pinned "N models · M pcs" bar that says exactly what's missing ("Add 12 more (minimum
50)"). Add unlocks only when total is on-pack ≥ MOQ AND every row passes. This is the heaviest
screen in the flow, and it is already well built for bulk — the problem is everything around it
(see stalls S3, S4).

### Step 3 · Add to cart (server round-trip)

`addToCartAction` (`src/server/actions/cart.ts`): viewer resolved from session, approval
re-checked, schema-parsed, rate-limited (30/min), per-model rules re-validated, then
`addToCart` service merges/creates the line. **Clamp-never-reject**: an off-pack/below-MOQ
request is adjusted and the toast says so ("Added — quantity adjusted to 20 (packs of 10)").
Success toast carries a "View cart" action; the buyer is NOT navigated away — correct for
20–100-line ordering.

**Post-add interruption:** on requirement-note products, `RequirementPrompt` AUTO-OPENS a sheet
right after every add (cart-events bus). Deliberate ("photograph the handwritten list"), but it
is a modal in the middle of a rapid multi-add session.

### Step 4 · The cart (`/account/cart` — `CartView.tsx`, 1,173 lines)

What a buyer must visually cross, top to bottom on a phone:

1. Lapsed-access banner (only when frozen).
2. Lines — flat list, or **bucket cards** when billing groups apply (`BucketCard` with tier
   progress and "add ₹X more for Y%" hints), plus a "Not orderable" section for dead lines.
3. Per line: image, brand/name/variant link, warning chips (6 kinds, `ISSUE_COPY`), model-split
   summary + "Edit models" sheet, requirement note control, stepper (typed qty commits on blur
   through the same clamp), gated price block with per-line GST note.
4. Mobile inline Summary card: items total, bucket-discount rows (collapsible breakdown), coupon
   row, GST lines (taxable/CGST/SGST/IGST/round-off), delivery charge row, grand total, GSTIN
   hint box, MOV shortfall box with progress bar, "Coupons for you" list (up to 5, each with
   apply button or blocked reason), manual coupon input + Apply, "no payment now" reassurance,
   note-for-seller textarea with char counter, amber DeliveryNotice box.
5. Desktop sidebar: the SAME Summary rendered a second time (with the Place button).
6. Sticky mobile bar: payable total, one-line hint (MOV shortfall / next-tier nudge / item
   count), **Place order** button.

All quantity edits are optimistic with server reconcile; coupon is re-previewed on every subtotal
move and self-removes with a toast when it stops applying; billing/GST/MOV all mirror live
client-side from non-monetary rate data (amounts re-frozen server-side at placement — gate safe).

### Step 5 · Placement (`placeOrderAction` → `services/orders.ts` `placeOrder`)

Client sends ONLY `{ note?, idempotencyKey?, couponCode? }`. Server re-checks access
transactionally, re-prices everything, excludes blocked lines (reported as a count-toast after
success), re-validates the coupon, re-checks MOV, dedups via idempotency key + identical-cart
window, clears cart + creates order in one transaction, fires push notifications, auto-extends
the access grant. Failure routing: coupon → dropped + retry, empty/access → `router.refresh()`.

### Step 6 · Confirmation (`/account/orders/confirmation`)

`OrderCelebration` animation, order number + timestamp, full line list (bucket-grouped when
priced), totals with discounts, frozen GST breakup card, DeliveryNotice again, the note, then
"View my orders" / "Continue browsing". Ownership + randomness scoped fetch. One screen, no
further action required — good.

---

## Part 2 — Every stall point

| # | Stall | Where | Severity |
|---|-------|-------|----------|
| S1 | Allocation products have no card-level add — forced PDP navigation per product; at 20–100 lines that's 20–100 page loads | `ProductGridView.tsx` et al. | High |
| S2 | On the PDP the mobile sticky bar has price + Enquire but **no Add-to-cart** — the buy control sits mid-page; buyer must scroll past gallery/price to add | `StickyMobileBar.tsx` | High |
| S3 | `p/[slug]/page.tsx` renders `AllocationAddToCart` WITHOUT `minPerModel` (prop exists, never passed) → per-model minimum violations don't show inline; the server refuses with a toast only | `page.tsx` line ~370 | Medium (in-flux files — re-verify) |
| S4 | Same gap in the cart: `CartLineRow.tsx` renders `EditBreakdownSheet` without `minPerModel` → save can bounce off the server with a one-line error | `CartLineRow.tsx` | Medium (in-flux) |
| S5 | MOV shortfall is announced THREE ways at once (disabled button, amber panel with progress bar, sticky-bar line) | `CartView.tsx` | Low |
| S6 | Coupon has TWO UIs: a suggestions list with Apply buttons AND a free-text input — buyers who aren't fluent readers must understand both; the best coupon is never applied by default | `CartView.tsx` Summary | Medium |
| S7 | The Summary is rendered twice (mobile inline + desktop sidebar) and is ~12 concept-rows deep; the mobile cart is a very long scroll before the buyer feels "done" | `CartView.tsx` | Medium |
| S8 | Requirement sheet auto-opens after EVERY add of a flagged product — an interrupting modal during rapid adding | `RequirementPrompt.tsx` | Low |
| S9 | "Below minimum / not a full pack" warning chips persist in the cart even though the server clamps on any update and repairs at placement — scary yellow for a state that self-heals | `CartLineRow.tsx` ISSUE_COPY | Low |
| S10 | GSTIN hint: "Add your GSTIN in the note (or your profile)" — asks the buyer to type tax data into a free-text note instead of a one-tap profile action | `CartView.tsx` Summary | Low |
| S11 | Excluded lines surface only as a post-success toast count; the buyer learns *after* placing that items were dropped (the "Not orderable" section does pre-warn, but nothing at the button) | `CartView.tsx` placeOrder | Low |
| S12 | Delivery is disclosed twice in the same summary (charge row + amber notice box) and again on confirmation | `Summary` + `DeliveryNotice` | Low |

Non-stalls worth protecting: clamp-never-reject; optimistic everything; no forced navigation
after add; idempotent placement; default variant pre-selection; paste-mode allocation.

---

## Part 3 — The simplification cut (ranked)

> Standing constraints for every item: the price gate (`canSeePrices`, gated DAL, no client
> prices) and the server-side re-validation at placement are UNTOUCHABLE. Nothing here removes a
> server check — only client friction.

### 1. Put Add-to-cart in the PDP sticky mobile bar
- **Do:** when `canSeePrices` and in stock, the sticky bar's primary slot becomes "Add to cart"
  (adds the pack-aligned MOQ, exactly like `QuickAddToCart`; after a line exists, show qty ±).
  Enquire collapses to an icon. Variant products add the selected variant (the bar already
  re-renders on selection via `VariantProductView`); allocation products get "Choose models"
  scrolling to the builder.
- **Files:** `src/components/storefront/product/StickyMobileBar.tsx`,
  `src/app/(storefront)/p/[slug]/page.tsx`, reuse `QuickAddToCart` internals.
- **Risk:** LOW. Purely client; server clamps and gates as today. Keep the gated/locked states of
  the bar exactly as they are (they are gate surface).
- **Buyer feels:** *"I open a product and the buy button is already under my thumb."*

### 2. Auto-apply the best coupon; hide the code box behind "Have a code?"
- **Do:** `suggestCouponsAction` already quotes every store coupon against the live cart. When
  exactly the top applicable suggestion exists and no coupon is applied, apply it automatically
  (with the existing removable chip so the buyer can undo). Collapse the manual input behind a
  one-line "Have a code?" toggle. Keep the existing re-preview-on-change and the atomic
  server-side `redeemCoupon` at placement UNCHANGED.
- **Files:** `src/app/(storefront)/account/cart/CartView.tsx` (Summary),
  `src/server/actions/coupons.ts` (no change needed — ranking already server-side).
- **Risk:** MEDIUM (money-adjacent): must pick by highest `discountPaise` server-ranked, never
  client math; must never auto-apply a scoped/blocked code; placement already re-validates so a
  wrong preview can't leak into money. Owner may prefer coupons stay opt-in — confirm.
- **Buyer feels:** *"The discount happens by itself; one less form."*

### 3. Halve the cart summary: one Summary, disclosure rows for detail
- **Do:** delete the duplicated mobile inline `<Summary>` (everything it shows except the note
  already lives in the sticky bar + line rows). Fold GST lines behind one "incl. ₹X GST ▾" row
  (breakup already exists on confirmation), merge the delivery charge row and the amber
  DeliveryNotice into ONE row with the caveat as its sub-line, and collapse the note field behind
  "Add a note ▸" (sheet or expand). Desktop sidebar keeps the full layout.
- **Files:** `src/app/(storefront)/account/cart/CartView.tsx`,
  `src/components/storefront/orders/DeliveryNotice.tsx` (accept a compact variant).
- **Risk:** LOW-MEDIUM: the delivery minimum and "no payment now" lines are owner-mandated
  disclosures — they must remain visible pre-place (keep them, one instance each, above the
  sticky bar's reach). Display-only; no money math moves.
- **Buyer feels:** *"The cart is one screen: my items, my total, Place order."*

### 4. One MOV message instead of three
- **Do:** keep the sticky-bar "Add ₹X more to place" line (it's the one always in view) and the
  disabled button; delete the amber progress-bar panel. Desktop keeps a single line in the
  sidebar.
- **Files:** `src/app/(storefront)/account/cart/CartView.tsx`.
- **Risk:** NONE to money — MOV stays enforced server-side at placement (`below-minimum`).
- **Buyer feels:** *"One clear sentence tells me what's missing, nothing shouts."*

### 5. Wire `minPerModel` end-to-end so allocation errors are inline, never a server bounce
- **Do:** pass `product.allocation.minPerModel` into `AllocationAddToCart` on the PDP and into
  `EditBreakdownSheet` from `CartLineRow` (both components already accept and use the prop —
  it's just not passed). Kills the "toast-only refusal" loop (S3/S4).
- **Files:** `src/app/(storefront)/p/[slug]/page.tsx`,
  `src/components/storefront/cart/CartLineRow.tsx` (needs `minPerModel` added to `CartLineData`
  from the cart service projection).
- **Risk:** LOW, but **these files are under active concurrent edit** — the other agents'
  allocation work may already cover this. Check the diff before building.
- **Buyer feels:** *"The row turns red and tells me the minimum before I ever hit Save."*

### 6. Card-level "Choose models" sheet for allocation products
- **Do:** give allocation products a listing-card control mirroring `VariantQuickSheet`: opens
  `ModelAllocationBuilder` in a bottom sheet, adds from the card. The builder is already a
  self-contained controlled component; this is mostly plumbing.
- **Files:** new `src/components/storefront/AllocationQuickSheet.tsx`, wire into the three
  listing views (**listing/* is fenced to another agent right now — sequence after their work**).
- **Risk:** LOW-MEDIUM (bundle weight on cards; keep it lazy). Server validation unchanged.
- **Buyer feels:** *"100 lines of glasses ordered from the category page, zero page loads."*

### 7. Auto-repair instead of warning for below-MOQ / off-pack cart lines
- **Do:** the server already clamps on every update and at placement; on cart READ, normalise the
  stored quantity through the same clamp (one write-behind) and drop the `below-moq` / `off-pack`
  chips entirely. Keep the block-tone chips (unavailable / out-of-stock / breakdown-mismatch).
- **Files:** `src/server/services/cart.ts` (getCart), `CartLineRow.tsx` ISSUE_COPY.
- **Risk:** MEDIUM: silently raising a quantity changes money the buyer will pay — the clamp is
  the existing placement behaviour, but repairing at read makes it visible earlier, which is
  arguably MORE honest. Show a one-time toast on repair. Owner call.
- **Buyer feels:** *"The cart never nags — numbers are always already valid."*

### 8. Calm the requirement-sheet auto-open
- **Do:** auto-open only when the line has no note/photos yet (first add), not on every re-add;
  the inline card remains for edits.
- **Files:** `src/components/storefront/requirements/RequirementPrompt.tsx`.
- **Risk:** NONE. **Buyer feels:** *"Asked once, not every time."*

### 9. One-tap GSTIN from profile instead of "write it in the note"
- **Do:** replace the amber GSTIN hint with a button: "Use my GSTIN (27AA…)" when the profile has
  one (fills `supplyType` context server-side at placement), else "Add GSTIN" linking to the
  profile field. Removes free-text tax data entry.
- **Files:** `CartView.tsx` Summary, `src/server/actions/customers-profile.ts` (field exists —
  verify), placement already reads profile state via `determineSupplyType`.
- **Risk:** LOW-MEDIUM: touches how CGST/SGST vs IGST is decided on the proforma — the server
  must remain the sole authority; the button only saves data to the profile.
- **Buyer feels:** *"Tax details are one tap, not typing."*

### 10. Pre-place "3 items will be left out" line at the button
- **Do:** `blockedLines` count is already known client-side (block-tone issues). Render it as a
  sub-line under the sticky Place button ("2 unavailable items won't be ordered") instead of a
  post-success toast only.
- **Files:** `CartView.tsx`. **Risk:** NONE. **Buyer feels:** *"No surprises after I tap Place."*

### Explicitly NOT proposed
- Removing the MOV/MOQ/pack/allocation server enforcement, the approval gate, coupon atomic
  redemption, idempotency, or the price-free client contract — all money/gate law.
- Merging cart+confirmation: confirmation is one screen with zero required actions; the
  celebration is owner-desired. Leave it.

---

## Verification

Read-only audit; the only write is this file. Full serial vitest run executed once for the
record (number reported in the task summary); no source, lint, or type surface touched.
