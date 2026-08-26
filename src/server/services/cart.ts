import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import type { CustomerViewer, ViewerContext } from "@/server/types/viewer";
import { canSeePrices } from "@/server/types/viewer";
import { bucketizeCartLines } from "@/server/services/billing-groups";
import { lineKey } from "@/lib/billing-groups/snapshot";
import type { BucketedCart } from "@/lib/billing-groups/types";
import type { StockStatus } from "@/lib/schemas/shared";
import {
  MAX_CART_LINES,
  MIN_QTY_PER_LINE,
  MAX_BREAKDOWN_ENTRIES,
  MAX_CUSTOM_MODEL_NAME,
  type BreakdownEntryInput,
} from "@/lib/schemas/cart";
import { normalizeModelText } from "@/lib/allocation-paste";
import {
  clampQuantity as clampQty,
  minOrderableQty,
  normaliseMaxQty,
  normaliseMoq,
  normalisePack,
} from "@/lib/quantity";
import { sanitizeAttachments, sanitizeNote } from "@/lib/requirement-notes";
import { publicBaseOrEmpty } from "@/server/storage/r2";

/** Base public URL our attachment allow-list checks against. */
function r2PublicBase(): string {
  // "" when unconfigured — sanitizeAttachments then accepts nothing.
  return publicBaseOrEmpty();
}
import {
  resolveEffectiveAllocation,
  type Allocation,
} from "@/lib/allocation";
import {
  computeLineTax,
  determineSupplyType,
  splitTax,
  type SupplyType,
} from "@/lib/gst";
import {
  resolveEffectiveTax,
  resolveVariantEffectiveTax,
  type EffectiveTax,
  type ProfileTaxDefaults,
} from "@/lib/tax-inherit";
import { getSellerTaxProfile } from "@/server/services/tax-profile";

/**
 * Cart service — the per-customer purchase-request basket.
 *
 * ============================ ANTI-CHEAT CORE ============================
 * 1. PRICE IS NEVER TRUSTED FROM THE CLIENT. A CartItem row stores ONLY
 *    { customerId, productId, variantId?, quantity }. No price is persisted.
 *    Unit prices and line totals in `getCart` are computed HERE from the
 *    live product/variant row, and only ever surfaced when the viewer is
 *    price-authorised (canSeePrices). Placement (C-service, another agent)
 *    re-computes and snapshots the server price the same way.
 *
 * 2. IDOR: EVERY function is scoped to the `customerId`/`viewer.customerId`
 *    argument and includes it in the Prisma `where`. There is NO code path
 *    that reads or mutates a cart row without matching customerId, so one
 *    customer can never touch another's cart. The actions layer supplies the
 *    id EXCLUSIVELY from resolveViewer() — never from client input.
 *
 * 3. ACCESS: mutating the cart requires a price-authorised (APPROVED +
 *    unexpired grant) viewer. `assertApproved` re-checks this on every
 *    add/update; a pending/expired/blocked customer is refused. Reads
 *    (`getCart`) are allowed for any customer so a lapsed customer can still
 *    SEE their frozen cart — but with prices structurally absent.
 *
 * 4. CAPS: quantity is clamped to [max(MOQ, MIN), MAX_QTY_PER_LINE]; the cart
 *    is capped at MAX_CART_LINES distinct lines.
 * ========================================================================
 */

/** Raised when the cart cannot be mutated for a business reason. */
export class CartError extends Error {
  readonly code: CartErrorCode;
  /**
   * Machine-readable context for the client. BREAKDOWN_SUM_MISMATCH carries
   * `{ requiredTotal, mergedTotal }` so the builder can re-open pre-filled and
   * ask the buyer to distribute the missing units — the server never invents a
   * per-model split (money follows quantity; quantity must equal the sum).
   */
  readonly details?: Record<string, number>;
  constructor(
    code: CartErrorCode,
    message: string,
    details?: Record<string, number>,
  ) {
    super(message);
    this.name = "CartError";
    this.code = code;
    this.details = details;
  }
}

export type CartErrorCode =
  | "NOT_APPROVED"
  | "PRODUCT_UNAVAILABLE"
  | "VARIANT_UNAVAILABLE"
  | "OUT_OF_STOCK"
  | "BREAKDOWN_REQUIRED"
  | "BREAKDOWN_INVALID"
  | "BREAKDOWN_SUM_MISMATCH"
  | "LINE_LIMIT"
  | "NOT_IN_CART";

/**
 * Per-line validity signal for the cart UI. A line can be perfectly orderable
 * (`available`) or flagged so the customer can act before placement. These
 * mirror the corner cases: product pulled, variant removed, stock gone, qty
 * below the live MOQ.
 */
export type CartLineIssue =
  | "inactive" // product/variant inactive or soft-deleted — excluded from an order
  | "out-of-stock" // stockStatus OUT_OF_STOCK — blocks ordering this line
  | "low-stock" // stockStatus LOW — orderable, but warn
  | "below-moq" // stored qty is under the live MOQ (clamped on next update)
  | "off-pack" // stored qty is not a multiple of the live pack size
  | "breakdown-mismatch"; // per-model split missing/stale — fix before ordering

/** A single resolved cart line, gated to the viewer. */
export interface CartLine {
  productId: string;
  variantId: string | null;
  /** Product display name. */
  name: string;
  /** SKU of the ordered unit (variant SKU when a variant is chosen). */
  sku: string;
  /** Brand label, when known (legacy string or brand master name). */
  brand: string | null;
  /** Brand-master id (null for legacy free-text brands) — drives billing groups. */
  brandId: string | null;
  /** Primary image url for the line thumbnail, when any. */
  imageUrl: string | null;
  /** Human option label for a variant line, e.g. "20000mAh · Black". */
  variantLabel: string | null;
  /** The stored quantity (already an integer). */
  quantity: number;
  /** The live minimum order quantity for this line (>= 1). */
  moq: number;
  /** The live pack multiple for this line (1 = no pack constraint). */
  packMultiple: number;
  /** The live per-line ceiling (admin-set, default 200). */
  maxQty: number;
  /** Product allows a requirement note + photos on this line. */
  allowRequirementNotes: boolean;
  /** Customer's requirement note (≤ 1000 chars), when provided. */
  note: string | null;
  /** Customer's requirement photos ([{url}], ≤ 6, our storage only). */
  attachments: { url: string }[];
  /** Whether this product requires a per-model quantity breakdown. */
  allocationRequired: boolean;
  /**
   * The allocation config's per-model minimum for this line, or null (no knob
   * / no allocation). NON-MONETARY display plumbing: the cart's split editor
   * shows the same inline errors the server enforces, BEFORE a save bounces.
   */
  minPerModel: number | null;
  /**
   * Resolved per-model split with display names, when the line carries one.
   * `modelId` is null (and `custom` true) for a line the buyer TYPED because
   * their model was missing from the master list.
   */
  breakdown: {
    modelId: string | null;
    custom?: boolean;
    name: string;
    qty: number;
  }[] | null;
  /** Live stock status of the ordered unit. */
  stockStatus: StockStatus;
  /**
   * Unit price in integer paise — ONLY present for a price-authorised viewer.
   * `null` for a gated viewer (no price ever computed or sent).
   */
  unitPricePaise: number | null;
  /** quantity * unitPricePaise, or `null` when gated. */
  lineTotalPaise: number | null;
  /** Whether this line can be placed as-is (active + in stock). */
  available: boolean;
  /** Any problems the UI should flag. Empty when fully orderable. */
  issues: CartLineIssue[];
  /**
   * The per-line GST breakup for the DISPLAYED line total, or `null` when GST is
   * off OR the viewer is gated. Amount-bearing (taxable/tax) so it lives only on
   * a priced line; derived from the server price + the line's frozen effective
   * rate via the shared core. `null` for blocked lines (excluded from totals).
   */
  tax: CartLineTax | null;
}

/** The per-line GST breakup surfaced on a priced cart line. */
export interface CartLineTax {
  /** Effective rate in basis points (1800 = 18%). */
  gstRateBps: number;
  /** Whether the displayed line total already includes the GST. */
  taxInclusive: boolean;
  /** GST-exclusive taxable base for the line, in paise. */
  taxablePaise: number;
  /** GST amount for the line, in paise. */
  taxPaise: number;
}

/**
 * The order-preview GST summary for the cart, over the ORDERABLE lines. Only
 * present for a priced viewer with the kill-switch on; `null` otherwise (the UI
 * then renders exactly as pre-GST). Uses the SAME core functions as placement.
 *
 * `supplyType === null` ⇒ the buyer has no place of supply: the split fields are
 * 0 and only `totalTaxPaise` (combined) is meaningful; the UI shows a single
 * "GST @X%" line + a prompt to add a GSTIN.
 */
export interface CartTaxSummary {
  supplyType: SupplyType | null;
  totalTaxablePaise: number;
  totalTaxPaise: number;
  totalCgstPaise: number;
  totalSgstPaise: number;
  totalIgstPaise: number;
  roundOffPaise: number;
  /** Final payable incl. GST (and any invoice round-off). */
  grandTotalPaise: number;
  /** The seller's rounding mode, so the client preview can re-apply it live. */
  roundingMode: "LINE" | "INVOICE";
}

/** The whole cart, gated to the viewer. */
export interface Cart {
  lines: CartLine[];
  /** Sum of every unit across all lines (for the header badge). */
  itemCount: number;
  /** Number of distinct lines. */
  lineCount: number;
  /**
   * Sum of every ORDERABLE line's total in paise — ONLY for a priced viewer,
   * else `null`. Unavailable lines are excluded so the total matches what a
   * placement would actually charge.
   */
  subtotalPaise: number | null;
  /** Whether the viewer may see prices (drives the UI's price gate). */
  priced: boolean;
  /**
   * The GST order-preview over the orderable lines, or `null` when GST is off or
   * the viewer is gated. Grand total here is what "Place order" will freeze.
   */
  tax: CartTaxSummary | null;
  /**
   * Billing groups: the orderable lines bucketed under the CURRENT rules with
   * each bucket's tiered discount + "add ₹X more" hint — ONLY for a priced
   * viewer (it carries amounts), else `null`. Line keys are
   * `lineKey(productId, variantId)`.
   */
  billing: BucketedCart | null;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Re-verify the viewer is a price-authorised customer BEFORE any mutation.
 * `canSeePrices` already encodes "APPROVED + live unexpired grant" as computed
 * by resolveViewer(), so we assert it here first as a fast gate.
 *
 * DEFENSE IN DEPTH: we then re-read the LIVE DB (status + a non-revoked,
 * non-expired AccessGrant) so the cart service is self-defending — a caller that
 * hand-forged a viewer with `priceAccess: true` for a lapsed/pending customer
 * (bypassing resolveViewer) still cannot mutate the cart. This mirrors what
 * `placeOrder` (the money step) already does at placement, closing the only
 * server-internal gap where a mutation trusted viewer flags alone.
 */
async function assertApproved(viewer: CustomerViewer): Promise<void> {
  if (!canSeePrices(viewer)) {
    throw new CartError(
      "NOT_APPROVED",
      "Your account is not approved to place orders.",
    );
  }
  const customer = await prisma.customer.findUnique({
    where: { id: viewer.customerId },
    select: { status: true },
  });
  if (!customer || customer.status !== "APPROVED") {
    throw new CartError(
      "NOT_APPROVED",
      "Your account is not approved to place orders.",
    );
  }
  const grant = await prisma.accessGrant.findFirst({
    where: {
      customerId: viewer.customerId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (!grant) {
    throw new CartError(
      "NOT_APPROVED",
      "Your account is not approved to place orders.",
    );
  }
}

// ---------------------------------------------------------------------------
// Product / variant resolution (live, authoritative)
// ---------------------------------------------------------------------------

/** The live purchasable facts we need for a line, resolved server-side. */
interface ResolvedUnit {
  name: string;
  sku: string;
  brand: string | null;
  /** Brand-master id (null for legacy free-text brands) — drives billing groups. */
  brandId: string | null;
  imageUrl: string | null;
  variantLabel: string | null;
  moq: number;
  /** Normalised pack multiple (1 = no pack constraint). */
  packMultiple: number;
  /** Normalised per-line ceiling (admin-set, default 200). */
  maxQty: number;
  /** Product allows a requirement note + photos. */
  allowRequirementNotes: boolean;
  /** Effective per-model allocation config (product over category), or null. */
  allocation: Allocation | null;
  stockStatus: StockStatus;
  /** Paise — authoritative server price. Never sent to a gated viewer. */
  pricePaise: number;
  /** Whether the underlying product/variant is orderable right now. */
  active: boolean;
  /**
   * The resolved effective tax for this unit (variant→product→category→profile),
   * or `null` when the GST kill-switch is off. NON-MONETARY (hsn/rate/treatment).
   */
  effectiveTax: EffectiveTax | null;
}

const PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  brand: true,
  brandId: true,
  brandRef: { select: { name: true } },
  price: true,
  moq: true,
  packMultiple: true,
  maxQty: true,
  allowRequirementNotes: true,
  stockStatus: true,
  status: true,
  deletedAt: true,
  hasVariants: true,
  // NON-MONETARY GST metadata — safe to select on the gated path; feeds the
  // effective-tax resolver only, never read as an amount.
  hsnCode: true,
  gstRateBps: true,
  taxTreatment: true,
  allocation: true,
  category: {
    select: {
      defaultHsnCode: true,
      defaultGstRateBps: true,
      defaultAllocation: true,
    },
  },
  images: { select: { url: true, thumbUrl: true, isPrimary: true, sortOrder: true } },
} satisfies Prisma.ProductSelect;

const VARIANT_SELECT = {
  id: true,
  sku: true,
  optionValues: true,
  price: true,
  moq: true,
  packMultiple: true,
  maxQty: true,
  stockStatus: true,
  status: true,
  hsnCode: true,
  gstRateBps: true,
  taxTreatment: true,
} satisfies Prisma.ProductVariantSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;
type VariantRow = Prisma.ProductVariantGetPayload<{ select: typeof VARIANT_SELECT }>;

/** Build a "10000mAh · Black" label from a variant's optionValues JSON. */
function variantLabel(optionValues: Prisma.JsonValue): string | null {
  if (
    optionValues === null ||
    typeof optionValues !== "object" ||
    Array.isArray(optionValues)
  ) {
    return null;
  }
  const parts = Object.values(optionValues as Record<string, unknown>).filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  return parts.length ? parts.join(" · ") : null;
}

function firstImageUrl(row: ProductRow): string | null {
  if (row.images.length === 0) return null;
  // Embedded image lists can't be ordered in the query, so pick the primary
  // (else the lowest sortOrder) here.
  const image = [...row.images].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  })[0];
  return image?.thumbUrl ?? image?.url ?? null;
}

// ---------------------------------------------------------------------------
// GST context (kill-switch aware) — mirrors orders.ts so the live cart preview
// and the placed order agree to the paisa (both use the same @/lib/gst core).
// ---------------------------------------------------------------------------

/** Per-request GST context, or `null` when the kill-switch is off. */
interface CartTaxContext {
  profile: ProfileTaxDefaults;
  sellerStateCode: string | null;
  roundingMode: "LINE" | "INVOICE";
}

/** Load the GST context from the cached seller profile (null when disabled). */
async function loadCartTaxContext(): Promise<CartTaxContext | null> {
  const p = await getSellerTaxProfile();
  if (!p.gstEnabled) return null;
  return {
    profile: {
      defaultHsnCode: p.defaultHsnCode,
      defaultGstRateBps: p.defaultGstRateBps,
      priceEntryMode: p.priceEntryMode,
    },
    sellerStateCode: p.stateCode,
    roundingMode: p.roundingMode,
  };
}

/** Resolve the effective tax for a product row (no variant), or null when off. */
function productEffectiveTax(
  ctx: CartTaxContext | null,
  product: ProductRow,
): EffectiveTax | null {
  if (!ctx) return null;
  return resolveEffectiveTax({
    entity: {
      hsnCode: product.hsnCode,
      gstRateBps: product.gstRateBps,
      taxTreatment: product.taxTreatment,
    },
    category: product.category ?? null,
    profile: ctx.profile,
  });
}

/** Resolve the effective tax for a variant row, or null when off. */
function variantEffectiveTax(
  ctx: CartTaxContext | null,
  product: ProductRow,
  variant: VariantRow,
): EffectiveTax | null {
  if (!ctx) return null;
  return resolveVariantEffectiveTax({
    variant: {
      hsnCode: variant.hsnCode,
      gstRateBps: variant.gstRateBps,
      taxTreatment: variant.taxTreatment,
    },
    product: {
      hsnCode: product.hsnCode,
      gstRateBps: product.gstRateBps,
      taxTreatment: product.taxTreatment,
    },
    category: product.category ?? null,
    profile: ctx.profile,
  });
}

/**
 * Resolve the LIVE, authoritative unit for a (product, variant?) pair. Returns
 * null only when the product itself is missing. When the product exists but is
 * inactive/deleted (or the variant is gone/inactive), `active` is false so the
 * caller can flag or exclude the line rather than silently ordering it.
 *
 * Price always comes from THIS row — never from the client, never from a cached
 * copy — which is the crux of the anti-cheat guarantee.
 */
async function resolveUnit(
  productId: string,
  variantId: string | null,
  ctx: CartTaxContext | null = null,
): Promise<ResolvedUnit | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: PRODUCT_SELECT,
  });
  if (!product) return null;

  const productActive =
    product.status === "ACTIVE" && product.deletedAt === null;
  const baseBrand = product.brandRef?.name ?? product.brand ?? null;

  if (variantId) {
    const variant = await prisma.productVariant.findFirst({
      // Scope the variant to its parent product — a variant id from another
      // product must never resolve.
      where: { id: variantId, productId },
      select: VARIANT_SELECT,
    });
    if (!variant) {
      // Variant removed after it was added to the cart.
      return {
        name: product.name,
        sku: product.sku,
        brand: baseBrand,
    brandId: product.brandId ?? null,
        imageUrl: firstImageUrl(product),
        variantLabel: null,
        moq: normaliseMoq(product.moq),
        packMultiple: normalisePack(product.packMultiple),
        maxQty: normaliseMaxQty(product.maxQty),
        allowRequirementNotes: product.allowRequirementNotes === true,
        allocation: resolveEffectiveAllocation(
          product.allocation,
          product.category?.defaultAllocation,
        ),
        stockStatus: "OUT_OF_STOCK",
        // Variant gone → fall back to the product price for display; the line
        // is inactive anyway (excluded from any order).
        pricePaise: product.price,
        active: false,
        // Line is inactive/excluded; no tax preview needed.
        effectiveTax: null,
      };
    }
    return resolveVariantUnit(product, variant, productActive, baseBrand, ctx);
  }

  return {
    name: product.name,
    sku: product.sku,
    brand: baseBrand,
    brandId: product.brandId ?? null,
    imageUrl: firstImageUrl(product),
    variantLabel: null,
    moq: normaliseMoq(product.moq),
    packMultiple: normalisePack(product.packMultiple),
    maxQty: normaliseMaxQty(product.maxQty),
    allowRequirementNotes: product.allowRequirementNotes === true,
    allocation: resolveEffectiveAllocation(
      product.allocation,
      product.category?.defaultAllocation,
    ),
    stockStatus: product.stockStatus,
    pricePaise: product.price,
    // A variant-based product ordered without a variant is not orderable.
    active: productActive && !product.hasVariants,
    effectiveTax: productEffectiveTax(ctx, product),
  };
}

function resolveVariantUnit(
  product: ProductRow,
  variant: VariantRow,
  productActive: boolean,
  baseBrand: string | null,
  ctx: CartTaxContext | null,
): ResolvedUnit {
  const variantActive = variant.status === "ACTIVE";
  return {
    name: product.name,
    sku: variant.sku,
    brand: baseBrand,
    brandId: product.brandId ?? null,
    imageUrl: firstImageUrl(product),
    variantLabel: variantLabel(variant.optionValues),
    moq: normaliseMoq(variant.moq ?? product.moq),
    packMultiple: normalisePack(variant.packMultiple ?? product.packMultiple),
    maxQty: normaliseMaxQty(variant.maxQty ?? product.maxQty),
    allowRequirementNotes: product.allowRequirementNotes === true,
    allocation: resolveEffectiveAllocation(
      product.allocation,
      product.category?.defaultAllocation,
    ),
    stockStatus: variant.stockStatus,
    pricePaise: variant.price,
    effectiveTax: variantEffectiveTax(ctx, product, variant),
    active: productActive && variantActive,
  };
}

// MOQ + pack-multiple clamping lives in src/lib/quantity.ts — ONE shared,
// pure implementation used by this service, the orders twin, and the client
// steppers, so all four always agree. Re-exported for existing importers.
export { clampQuantity } from "@/lib/quantity";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The whole cart for a customer, gated to the viewer. Prices are attached ONLY
 * when `canSeePrices(viewer)`; a lapsed/pending viewer sees their lines with
 * `unitPricePaise: null` and a `null` subtotal (prices lock, placement blocked
 * by the actions layer). Each line carries live validity flags so the UI can
 * show a diff before placement.
 *
 * The `viewer` MUST be the customer whose cart this is (the actions layer
 * guarantees this by passing viewer.customerId only).
 */
export async function getCart(viewer: CustomerViewer): Promise<Cart> {
  const priced = canSeePrices(viewer);
  const rows = await prisma.cartItem.findMany({
    where: { customerId: viewer.customerId },
    orderBy: { createdAt: "asc" },
    select: {
      productId: true,
      variantId: true,
      quantity: true,
      breakdown: true,
      note: true,
      attachments: true,
    },
  });

  // GST context + the buyer's place of supply — ONLY when the viewer is priced
  // (a gated viewer never receives any amount, tax included) and the kill-switch
  // is on. `ctx === null` ⇒ no tax anywhere ⇒ cart looks exactly as pre-GST.
  const [ctx, placeOfSupply] = priced
    ? await Promise.all([
        loadCartTaxContext(),
        resolveCustomerPlaceOfSupply(viewer.customerId),
      ])
    : [null, null];

  // Resolve every referenced model name in ONE query (breakdown display).
  const allModelIds = [
    ...new Set(
      rows.flatMap((r) =>
        parseStoredBreakdown(r.breakdown).flatMap((e) =>
          isCustomEntry(e) ? [] : [e.modelId],
        ),
      ),
    ),
  ];
  const modelRows = allModelIds.length
    ? await prisma.deviceModel.findMany({
        where: { id: { in: allModelIds } },
        select: { id: true, name: true, status: true },
      })
    : [];
  const modelById = new Map(modelRows.map((m) => [m.id, m]));

  const lines: CartLine[] = [];
  let itemCount = 0;
  let subtotalPaise = 0;
  // Order-preview tax accumulators (over ORDERABLE lines).
  let taxTotalTaxable = 0;
  let taxTotalTax = 0;
  let taxTotalGross = 0;
  let anyTaxed = false;

  for (const row of rows) {
    const unit = await resolveUnit(row.productId, row.variantId ?? null, ctx);
    // Product row vanished entirely — surface as an inactive placeholder so the
    // customer can remove it; never counted toward a total.
    const issues: CartLineIssue[] = [];
    let available: boolean;
    let name: string;
    let sku: string;
    let brand: string | null;
    let brandId: string | null;
    let imageUrl: string | null;
    let variantLbl: string | null;
    let moq: number;
    let packMultiple: number;
    let maxQty: number;
    let unitFlagAllowNotes: boolean;
    let stockStatus: StockStatus;
    let pricePaise: number | null;

    if (!unit) {
      available = false;
      issues.push("inactive");
      name = "Unavailable product";
      sku = "";
      brand = null;
      brandId = null;
      imageUrl = null;
      variantLbl = null;
      moq = MIN_QTY_PER_LINE;
      packMultiple = 1;
      maxQty = normaliseMaxQty(null);
      unitFlagAllowNotes = false;
      stockStatus = "OUT_OF_STOCK";
      pricePaise = null;
    } else {
      name = unit.name;
      sku = unit.sku;
      brand = unit.brand;
      brandId = unit.brandId;
      imageUrl = unit.imageUrl;
      variantLbl = unit.variantLabel;
      moq = unit.moq;
      packMultiple = unit.packMultiple;
      maxQty = unit.maxQty;
      unitFlagAllowNotes = unit.allowRequirementNotes;
      stockStatus = unit.stockStatus;
      pricePaise = priced ? unit.pricePaise : null;

      if (!unit.active) issues.push("inactive");
      if (unit.stockStatus === "OUT_OF_STOCK") issues.push("out-of-stock");
      else if (unit.stockStatus === "LOW") issues.push("low-stock");
      if (row.quantity < minOrderableQty(unit.moq, unit.packMultiple)) {
        issues.push("below-moq");
      } else if (unit.packMultiple > 1 && row.quantity % unit.packMultiple !== 0) {
        issues.push("off-pack");
      }

      // Allocation health: a required line must carry a split that sums to the
      // quantity and references only live models. Anything else is flagged —
      // placement treats it as fatal (the server never repairs a split).
      if (unit.allocation?.required) {
        const entries = parseStoredBreakdown(row.breakdown);
        const sum = entries.reduce((acc, e) => acc + e.qty, 0);
        const allowed =
          unit.allocation.modelIds.length > 0
            ? new Set(unit.allocation.modelIds)
            : null;
        // Custom (typed) lines are always healthy model-wise — they reference
        // no master row, and the restriction list does not apply to them.
        const modelsOk = entries.every((e) => {
          if (isCustomEntry(e)) return true;
          const m = modelById.get(e.modelId);
          return m && m.status === "ACTIVE" && (!allowed || allowed.has(e.modelId));
        });
        if (entries.length === 0 || sum !== row.quantity || !modelsOk) {
          issues.push("breakdown-mismatch");
        }
      }

      available =
        unit.active && unit.stockStatus !== "OUT_OF_STOCK";
    }

    const lineTotalPaise =
      pricePaise === null ? null : pricePaise * row.quantity;

    // Per-line GST breakup for the displayed line total. Only for a priced,
    // available line with a resolved effective rate (kill-switch on). Blocked
    // lines carry no tax (they're excluded from the order + totals).
    let lineTax: CartLineTax | null = null;
    const eff = unit?.effectiveTax ?? null;
    if (priced && available && lineTotalPaise !== null && eff) {
      const t = computeLineTax({
        amountPaise: lineTotalPaise,
        gstRateBps: eff.gstRateBps,
        treatment: eff.treatment,
      });
      lineTax = {
        gstRateBps: eff.gstRateBps,
        taxInclusive: eff.treatment === "TAX_INCLUSIVE",
        taxablePaise: t.taxablePaise,
        taxPaise: t.taxPaise,
      };
      taxTotalTaxable += t.taxablePaise;
      taxTotalTax += t.taxPaise;
      taxTotalGross += t.grossPaise;
      anyTaxed = true;
    }

    lines.push({
      productId: row.productId,
      variantId: row.variantId ?? null,
      name,
      sku,
      brand,
      brandId,
      imageUrl,
      variantLabel: variantLbl,
      quantity: row.quantity,
      moq,
      packMultiple,
      maxQty,
      allowRequirementNotes: unitFlagAllowNotes,
      note: sanitizeNote(row.note),
      attachments: sanitizeAttachments(row.attachments, r2PublicBase()),
      allocationRequired: unit?.allocation?.required ?? false,
      minPerModel: unit?.allocation?.required
        ? (unit.allocation.minPerModel ?? null)
        : null,
      breakdown: (() => {
        const entries = parseStoredBreakdown(row.breakdown);
        if (entries.length === 0) return null;
        return entries.map((e) =>
          isCustomEntry(e)
            ? { modelId: null, custom: true, name: e.name, qty: e.qty }
            : {
                modelId: e.modelId,
                name: modelById.get(e.modelId)?.name ?? "Removed model",
                qty: e.qty,
              },
        );
      })(),
      stockStatus,
      unitPricePaise: pricePaise,
      lineTotalPaise,
      available,
      issues,
      tax: lineTax,
    });

    itemCount += row.quantity;
    if (priced && available && lineTotalPaise !== null) {
      subtotalPaise += lineTotalPaise;
    }
  }

  // Order-preview GST summary over the orderable lines. Split by supply type
  // (derived once from seller state vs. the buyer's place of supply). When the
  // supply type is unknown (no place of supply) the tax stays combined.
  let tax: CartTaxSummary | null = null;
  if (ctx && anyTaxed) {
    const supplyType = determineSupplyType(ctx.sellerStateCode, placeOfSupply);
    const split =
      supplyType === null
        ? { cgstPaise: 0, sgstPaise: 0, igstPaise: 0 }
        : splitTax(taxTotalTax, supplyType);
    const grossBeforeRound = taxTotalGross;
    let roundOffPaise = 0;
    let grandTotalPaise = grossBeforeRound;
    if (ctx.roundingMode === "INVOICE") {
      grandTotalPaise = Math.round(grossBeforeRound / 100) * 100;
      roundOffPaise = grandTotalPaise - grossBeforeRound;
    }
    tax = {
      supplyType,
      totalTaxablePaise: taxTotalTaxable,
      totalTaxPaise: taxTotalTax,
      totalCgstPaise: split.cgstPaise,
      totalSgstPaise: split.sgstPaise,
      totalIgstPaise: split.igstPaise,
      roundOffPaise,
      grandTotalPaise,
      roundingMode: ctx.roundingMode,
    };
  }

  // Billing groups (priced viewers only — the result carries amounts): bucket
  // the ORDERABLE lines under the current rules. One indexed read, done once
  // for the whole cart (never inside the per-line loop).
  let billing: BucketedCart | null = null;
  if (priced) {
    billing = await bucketizeCartLines(
      lines
        .filter((l) => l.available && l.lineTotalPaise !== null)
        .map((l) => ({
          key: lineKey(l.productId, l.variantId),
          brandId: l.brandId,
          lineTotalPaise: l.lineTotalPaise as number,
        })),
    );
  }

  return {
    lines,
    itemCount,
    lineCount: lines.length,
    subtotalPaise: priced ? subtotalPaise : null,
    priced,
    tax,
    billing,
  };
}

/**
 * The buyer's place of supply: GSTIN-derived state wins, else the explicit
 * billing state, else null (no GSTIN → supply type undetermined). IDOR-safe.
 */
async function resolveCustomerPlaceOfSupply(
  customerId: string,
): Promise<string | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { gstStateCode: true, placeOfSupplyStateCode: true },
  });
  if (!customer) return null;
  return customer.gstStateCode ?? customer.placeOfSupplyStateCode ?? null;
}

/** How many distinct lines a customer's cart holds (header badge helper). */
export async function cartLineCount(customerId: string): Promise<number> {
  return prisma.cartItem.count({ where: { customerId } });
}

/** Sum of units across all lines (header badge count). */
export async function cartItemCount(customerId: string): Promise<number> {
  const rows = await prisma.cartItem.findMany({
    where: { customerId },
    select: { quantity: true },
  });
  return rows.reduce((sum, r) => sum + r.quantity, 0);
}

/**
 * Header/shell cart entry point count for an arbitrary viewer.
 *
 * Returns the customer's live item count when — and ONLY when — the viewer is
 * an APPROVED, price-authorised customer (the same gate that unlocks carting).
 * For anon, admin, and pending/expired/blocked customers it returns
 * `undefined`, which the shell reads as "do not render the cart badge". Carries
 * no price. Never throws — a lookup failure degrades to no badge.
 */
export async function cartCountForViewer(
  viewer: ViewerContext,
): Promise<number | undefined> {
  if (!canSeePrices(viewer)) return undefined;
  const customerId = (viewer as CustomerViewer).customerId;
  try {
    return await cartItemCount(customerId);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Mutations — all require an APPROVED viewer and are scoped to customerId.
// ---------------------------------------------------------------------------

export interface CartMutationResult {
  /** The stored quantity of the affected line after the mutation. */
  quantity: number;
  /** Fresh unit count for the header badge. */
  itemCount: number;
  /** Fresh distinct-line count. */
  lineCount: number;
  /** True when the requested qty was clamped to the MOQ floor / cap. */
  clamped: boolean;
}

/**
 * One stored slice of an allocation line: a MASTER-LIST model by id, or a
 * CUSTOM line carrying the name the buyer typed (their model was missing from
 * the master). Legacy rows only ever contain the master shape — the stored
 * JSON stays backward-compatible by construction.
 */
type BreakdownEntry =
  | { modelId: string; qty: number }
  | { custom: true; name: string; qty: number };

/** Narrow a breakdown entry to the custom (typed) shape. */
function isCustomEntry(
  e: BreakdownEntry,
): e is { custom: true; name: string; qty: number } {
  return "custom" in e && e.custom === true;
}

/** Stable dedupe/merge key: the model id, or the normalized typed name. */
function breakdownKey(e: BreakdownEntry): string {
  return isCustomEntry(e)
    ? `custom:${normalizeModelText(e.name)}`
    : e.modelId;
}

/** Parse a STORED breakdown JSON defensively — corrupt data yields []. */
function parseStoredBreakdown(raw: unknown): BreakdownEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: BreakdownEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const rec = e as { modelId?: unknown; custom?: unknown; name?: unknown; qty?: unknown };
    if (!Number.isSafeInteger(rec.qty) || (rec.qty as number) <= 0) continue;
    if (typeof rec.modelId === "string") {
      out.push({ modelId: rec.modelId, qty: rec.qty as number });
    } else if (rec.custom === true && typeof rec.name === "string") {
      const name = rec.name
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_CUSTOM_MODEL_NAME);
      if (name !== "") {
        out.push({ custom: true, name, qty: rec.qty as number });
      }
    }
  }
  return out;
}

/**
 * Validate a merged breakdown against the allocation config and the live
 * DeviceModel master: every MASTER model must exist, be ACTIVE, and (when the
 * allocation restricts) be on the allow-list. Throws BREAKDOWN_INVALID naming
 * the first offending model so the buyer knows what to fix.
 *
 * CUSTOM (typed) lines are exempt from the master checks BY DESIGN — even on
 * a RESTRICTED product. The restriction pins which MASTER models may be
 * picked, but free text exists precisely because the master list (and thus
 * any allow-list built from it) is incomplete; the admin sees the typed name
 * marked as custom and vets it when packing. A custom name that duplicates a
 * master model ALREADY IN this breakdown is rejected, mirroring the UI's
 * case-insensitive dedupe.
 */
async function assertBreakdownModels(
  allocation: Allocation,
  entries: BreakdownEntry[],
): Promise<void> {
  const ids = entries.flatMap((e) => (isCustomEntry(e) ? [] : [e.modelId]));
  const rows = ids.length
    ? await prisma.deviceModel.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, status: true },
      })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const allowed =
    allocation.modelIds.length > 0 ? new Set(allocation.modelIds) : null;
  const masterNames = new Set(rows.map((r) => normalizeModelText(r.name)));
  for (const e of entries) {
    if (isCustomEntry(e)) {
      const norm = normalizeModelText(e.name);
      // A punctuation-only "name" is meaningless to the packer.
      if (norm === "") {
        throw new CartError(
          "BREAKDOWN_INVALID",
          "Type a real model name for your custom model.",
        );
      }
      if (masterNames.has(norm)) {
        throw new CartError(
          "BREAKDOWN_INVALID",
          `"${e.name}" is already in your list as a catalog model.`,
        );
      }
      continue;
    }
    const row = byId.get(e.modelId);
    if (!row || row.status !== "ACTIVE") {
      throw new CartError(
        "BREAKDOWN_INVALID",
        "One of the selected models is no longer available — remove it and retry.",
      );
    }
    if (allowed && !allowed.has(e.modelId)) {
      throw new CartError(
        "BREAKDOWN_INVALID",
        `"${row.name}" is not available for this product.`,
      );
    }
  }
}

/**
 * Resolve the final (quantity, breakdown) for an allocation-required line.
 *
 * The invariant this protects: `quantity === sum(breakdown)` at ALL times —
 * money follows quantity, and the split is what the seller packs. So when the
 * MOQ/pack clamp would CHANGE the total, we REJECT with the corrected total
 * in `details` instead of silently inventing per-model quantities; the client
 * re-opens the builder pre-filled and asks the buyer to place the remainder.
 */
function settleBreakdownTotal(
  unit: ResolvedUnit,
  entries: BreakdownEntry[],
): { quantity: number; breakdown: BreakdownEntry[] } {
  const total = entries.reduce((acc, e) => acc + e.qty, 0);
  const clamped = clampQty(total, unit.moq, unit.packMultiple, unit.maxQty);
  if (clamped !== total) {
    throw new CartError(
      "BREAKDOWN_SUM_MISMATCH",
      unit.packMultiple > 1
        ? `This product is sold in packs of ${unit.packMultiple} (minimum ${minOrderableQty(unit.moq, unit.packMultiple)}). Adjust the split to total ${clamped}.`
        : `Minimum order is ${unit.moq}. Adjust the split to total ${clamped}.`,
      { requiredTotal: clamped, providedTotal: total },
    );
  }
  return { quantity: total, breakdown: entries };
}


/**
 * Add a unit to the cart, or increment it when the exact (product, variant)
 * line already exists. Validates the product is live + orderable, clamps the
 * resulting quantity to [MOQ, cap], and enforces the distinct-line ceiling.
 *
 * REQUIRES an approved viewer (re-checked here). The stored row carries NO
 * price — only the quantity.
 */
export async function addToCart(
  viewer: CustomerViewer,
  input: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    breakdown?: BreakdownEntryInput[];
  },
): Promise<CartMutationResult> {
  await assertApproved(viewer);
  const customerId = viewer.customerId;
  const variantId = input.variantId ?? null;

  const unit = await resolveUnit(input.productId, variantId);
  if (!unit || !unit.active) {
    throw new CartError(
      variantId ? "VARIANT_UNAVAILABLE" : "PRODUCT_UNAVAILABLE",
      "This product is not available to order.",
    );
  }
  if (unit.stockStatus === "OUT_OF_STOCK") {
    throw new CartError("OUT_OF_STOCK", "This product is out of stock.");
  }

  const existing = await prisma.cartItem.findFirst({
    where: { customerId, productId: input.productId, variantId },
    select: { id: true, quantity: true, breakdown: true },
  });

  // Enforce the distinct-line ceiling only when adding a NEW line.
  if (!existing) {
    const lineCount = await prisma.cartItem.count({ where: { customerId } });
    if (lineCount >= MAX_CART_LINES) {
      throw new CartError(
        "LINE_LIMIT",
        `A cart can hold at most ${MAX_CART_LINES} different products.`,
      );
    }
  }

  // ---- Allocation products: the breakdown IS the quantity. ----------------
  if (unit.allocation?.required) {
    if (!input.breakdown || input.breakdown.length === 0) {
      throw new CartError(
        "BREAKDOWN_REQUIRED",
        "Choose the models and quantities for this product first.",
      );
    }
    // Merge per-model with the stored split (repeat adds accumulate). Master
    // rows merge on the model id; custom rows merge on the normalized typed
    // name (so "iPhone 12" and "iphone-12" become one line, first name wins).
    const merged = new Map<string, BreakdownEntry>();
    for (const e of [
      ...parseStoredBreakdown(existing?.breakdown),
      ...(input.breakdown as BreakdownEntry[]),
    ]) {
      const key = breakdownKey(e);
      const prev = merged.get(key);
      if (prev) {
        prev.qty += e.qty;
      } else {
        merged.set(key, { ...e });
      }
    }
    const entries = [...merged.values()];
    if (entries.length > MAX_BREAKDOWN_ENTRIES) {
      throw new CartError(
        "BREAKDOWN_INVALID",
        `A line can carry at most ${MAX_BREAKDOWN_ENTRIES} models.`,
      );
    }
    await assertBreakdownModels(unit.allocation, entries);
    const settled = settleBreakdownTotal(unit, entries);

    if (existing) {
      await prisma.cartItem.update({
        where: { id: existing.id },
        data: {
          quantity: settled.quantity,
          breakdown: settled.breakdown as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
    } else {
      await createLine(
        customerId,
        input.productId,
        variantId,
        settled.quantity,
        settled.breakdown,
      );
    }
    return summarise(customerId, settled.quantity, false);
  }

  // ---- Normal products (stray breakdowns are simply ignored). -------------
  const desired = (existing?.quantity ?? 0) + input.quantity;
  const quantity = clampQty(desired, unit.moq, unit.packMultiple, unit.maxQty);
  const clamped = quantity !== desired;

  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity },
      select: { id: true },
    });
  } else {
    await createLine(customerId, input.productId, variantId, quantity);
  }

  return summarise(customerId, quantity, clamped);
}

/**
 * Create a line, tolerating a concurrent insert of the same (customer, product,
 * variant): on a unique-constraint race we fall back to incrementing the row
 * that won, so a double-tap never errors and never duplicates a line.
 */
async function createLine(
  customerId: string,
  productId: string,
  variantId: string | null,
  quantity: number,
  breakdown?: BreakdownEntry[],
): Promise<void> {
  const breakdownJson =
    breakdown && breakdown.length > 0
      ? (breakdown as unknown as Prisma.InputJsonValue)
      : undefined;
  try {
    await prisma.cartItem.create({
      data: {
        customerId,
        productId,
        variantId,
        quantity,
        ...(breakdownJson !== undefined ? { breakdown: breakdownJson } : {}),
      },
      select: { id: true },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      await prisma.cartItem.updateMany({
        where: { customerId, productId, variantId },
        data: {
          quantity,
          ...(breakdownJson !== undefined ? { breakdown: breakdownJson } : {}),
        },
      });
      return;
    }
    throw error;
  }
}

/**
 * Set the EXACT quantity of a line (from the cart's stepper). Clamps to
 * [MOQ, cap]. If the line does not exist, it is treated as an add. Requires an
 * approved viewer; the product is re-validated live.
 */
export async function updateQuantity(
  viewer: CustomerViewer,
  input: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    breakdown?: BreakdownEntryInput[];
  },
): Promise<CartMutationResult> {
  await assertApproved(viewer);
  const customerId = viewer.customerId;
  const variantId = input.variantId ?? null;

  const unit = await resolveUnit(input.productId, variantId);
  if (!unit || !unit.active) {
    throw new CartError(
      variantId ? "VARIANT_UNAVAILABLE" : "PRODUCT_UNAVAILABLE",
      "This product is not available to order.",
    );
  }

  // Allocation lines are edited by REPLACING the whole split (the cart's edit
  // dialog sends the complete breakdown); a bare quantity write is rejected
  // because the server will not invent per-model quantities.
  if (unit.allocation?.required) {
    if (!input.breakdown || input.breakdown.length === 0) {
      throw new CartError(
        "BREAKDOWN_REQUIRED",
        "Edit the per-model quantities for this product instead.",
      );
    }
    await assertBreakdownModels(unit.allocation, input.breakdown);
    const settled = settleBreakdownTotal(unit, input.breakdown);
    const row = await prisma.cartItem.findFirst({
      where: { customerId, productId: input.productId, variantId },
      select: { id: true },
    });
    if (row) {
      await prisma.cartItem.update({
        where: { id: row.id },
        data: {
          quantity: settled.quantity,
          breakdown: settled.breakdown as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
    } else {
      const lineCount = await prisma.cartItem.count({ where: { customerId } });
      if (lineCount >= MAX_CART_LINES) {
        throw new CartError(
          "LINE_LIMIT",
          `A cart can hold at most ${MAX_CART_LINES} different products.`,
        );
      }
      await createLine(
        customerId,
        input.productId,
        variantId,
        settled.quantity,
        settled.breakdown,
      );
    }
    return summarise(customerId, settled.quantity, false);
  }

  const quantity = clampQty(input.quantity, unit.moq, unit.packMultiple, unit.maxQty);
  const clamped = quantity !== input.quantity;

  const existing = await prisma.cartItem.findFirst({
    where: { customerId, productId: input.productId, variantId },
    select: { id: true },
  });

  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity },
      select: { id: true },
    });
  } else {
    const lineCount = await prisma.cartItem.count({ where: { customerId } });
    if (lineCount >= MAX_CART_LINES) {
      throw new CartError(
        "LINE_LIMIT",
        `A cart can hold at most ${MAX_CART_LINES} different products.`,
      );
    }
    await createLine(customerId, input.productId, variantId, quantity);
  }

  return summarise(customerId, quantity, clamped);
}

/**
 * Remove a single line. Scoped to customerId, so it can only ever delete the
 * current customer's own row. Idempotent — removing a line that isn't there is
 * a no-op. Reads (removal) are allowed even when access lapsed so a frozen
 * customer can still prune their cart.
 */
export async function removeItem(
  customerId: string,
  ref: { productId: string; variantId?: string | null },
): Promise<{ itemCount: number; lineCount: number }> {
  await prisma.cartItem.deleteMany({
    where: {
      customerId,
      productId: ref.productId,
      variantId: ref.variantId ?? null,
    },
  });
  const [itemCount, lineCount] = await Promise.all([
    cartItemCount(customerId),
    cartLineCount(customerId),
  ]);
  return { itemCount, lineCount };
}

/**
 * Empty the customer's cart entirely. Scoped to customerId. Idempotent. Used
 * both by an explicit "clear cart" control and (by the placement transaction,
 * a sibling agent) atomically with order creation.
 */
export async function clearCart(customerId: string): Promise<void> {
  await prisma.cartItem.deleteMany({ where: { customerId } });
}

/** Recompute the header counts after a mutation, in one round trip. */
async function summarise(
  customerId: string,
  quantity: number,
  clamped: boolean,
): Promise<CartMutationResult> {
  const rows = await prisma.cartItem.findMany({
    where: { customerId },
    select: { quantity: true },
  });
  const itemCount = rows.reduce((sum, r) => sum + r.quantity, 0);
  return { quantity, itemCount, lineCount: rows.length, clamped };
}

/**
 * Set / clear a line's requirement note + photo attachments. Allowed ONLY on
 * products the admin flagged (`allowRequirementNotes`); the note is bounded,
 * and attachment URLs are accepted only under OUR `order-notes/` storage
 * prefix (see src/lib/requirement-notes.ts) — never arbitrary URLs.
 */
export async function setCartRequirement(
  viewer: CustomerViewer,
  input: {
    productId: string;
    variantId?: string | null;
    note?: unknown;
    attachments?: unknown;
  },
): Promise<
  | { ok: true; note: string | null; attachments: { url: string }[] }
  | { ok: false; reason: "not-in-cart" | "not-allowed" }
> {
  await assertApproved(viewer);
  const variantId = input.variantId ?? null;

  const row = await prisma.cartItem.findFirst({
    where: { customerId: viewer.customerId, productId: input.productId, variantId },
    select: { id: true },
  });
  if (!row) return { ok: false, reason: "not-in-cart" };

  const product = await prisma.product.findFirst({
    where: { id: input.productId, deletedAt: null },
    select: { allowRequirementNotes: true },
  });
  if (product?.allowRequirementNotes !== true) {
    return { ok: false, reason: "not-allowed" };
  }

  const note = sanitizeNote(input.note);
  const attachments = sanitizeAttachments(input.attachments, r2PublicBase());
  await prisma.cartItem.update({
    where: { id: row.id },
    data: {
      note,
      attachments: attachments as unknown as Prisma.InputJsonValue,
    },
  });
  return { ok: true, note, attachments };
}
