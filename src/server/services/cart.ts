import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import type { CustomerViewer, ViewerContext } from "@/server/types/viewer";
import { canSeePrices } from "@/server/types/viewer";
import type { StockStatus } from "@/lib/schemas/shared";
import {
  MAX_CART_LINES,
  MAX_QTY_PER_LINE,
  MIN_QTY_PER_LINE,
} from "@/lib/schemas/cart";
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
  constructor(code: CartErrorCode, message: string) {
    super(message);
    this.name = "CartError";
    this.code = code;
  }
}

export type CartErrorCode =
  | "NOT_APPROVED"
  | "PRODUCT_UNAVAILABLE"
  | "VARIANT_UNAVAILABLE"
  | "OUT_OF_STOCK"
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
  | "below-moq"; // stored qty is under the live MOQ (clamped on next update)

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
  /** Primary image url for the line thumbnail, when any. */
  imageUrl: string | null;
  /** Human option label for a variant line, e.g. "20000mAh · Black". */
  variantLabel: string | null;
  /** The stored quantity (already an integer). */
  quantity: number;
  /** The live minimum order quantity for this line (>= 1). */
  moq: number;
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
  imageUrl: string | null;
  variantLabel: string | null;
  moq: number;
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
  brandRef: { select: { name: true } },
  price: true,
  moq: true,
  stockStatus: true,
  status: true,
  deletedAt: true,
  hasVariants: true,
  // NON-MONETARY GST metadata — safe to select on the gated path; feeds the
  // effective-tax resolver only, never read as an amount.
  hsnCode: true,
  gstRateBps: true,
  taxTreatment: true,
  category: { select: { defaultHsnCode: true, defaultGstRateBps: true } },
  images: { select: { url: true, thumbUrl: true, isPrimary: true, sortOrder: true } },
} satisfies Prisma.ProductSelect;

const VARIANT_SELECT = {
  id: true,
  sku: true,
  optionValues: true,
  price: true,
  moq: true,
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
        imageUrl: firstImageUrl(product),
        variantLabel: null,
        moq: normaliseMoq(product.moq),
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
    imageUrl: firstImageUrl(product),
    variantLabel: null,
    moq: normaliseMoq(product.moq),
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
    imageUrl: firstImageUrl(product),
    variantLabel: variantLabel(variant.optionValues),
    moq: normaliseMoq(variant.moq ?? product.moq),
    stockStatus: variant.stockStatus,
    pricePaise: variant.price,
    effectiveTax: variantEffectiveTax(ctx, product, variant),
    active: productActive && variantActive,
  };
}

/** A product's MOQ is optional; treat missing/invalid as the absolute floor. */
function normaliseMoq(moq: number | null | undefined): number {
  if (typeof moq !== "number" || !Number.isFinite(moq) || moq < MIN_QTY_PER_LINE) {
    return MIN_QTY_PER_LINE;
  }
  return Math.min(Math.trunc(moq), MAX_QTY_PER_LINE);
}

/**
 * Clamp a requested quantity into the valid window for a unit: at least the
 * live MOQ (never below), at most the per-line ceiling. Non-integers are
 * truncated defensively (the schema already blocks them at the edge).
 */
export function clampQuantity(requested: number, moq: number): number {
  const q = Number.isFinite(requested) ? Math.trunc(requested) : moq;
  const floor = Math.max(MIN_QTY_PER_LINE, moq);
  return Math.min(MAX_QTY_PER_LINE, Math.max(floor, q));
}

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
    select: { productId: true, variantId: true, quantity: true },
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
    let imageUrl: string | null;
    let variantLbl: string | null;
    let moq: number;
    let stockStatus: StockStatus;
    let pricePaise: number | null;

    if (!unit) {
      available = false;
      issues.push("inactive");
      name = "Unavailable product";
      sku = "";
      brand = null;
      imageUrl = null;
      variantLbl = null;
      moq = MIN_QTY_PER_LINE;
      stockStatus = "OUT_OF_STOCK";
      pricePaise = null;
    } else {
      name = unit.name;
      sku = unit.sku;
      brand = unit.brand;
      imageUrl = unit.imageUrl;
      variantLbl = unit.variantLabel;
      moq = unit.moq;
      stockStatus = unit.stockStatus;
      pricePaise = priced ? unit.pricePaise : null;

      if (!unit.active) issues.push("inactive");
      if (unit.stockStatus === "OUT_OF_STOCK") issues.push("out-of-stock");
      else if (unit.stockStatus === "LOW") issues.push("low-stock");
      if (row.quantity < unit.moq) issues.push("below-moq");

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
      imageUrl,
      variantLabel: variantLbl,
      quantity: row.quantity,
      moq,
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

  return {
    lines,
    itemCount,
    lineCount: lines.length,
    subtotalPaise: priced ? subtotalPaise : null,
    priced,
    tax,
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
 * Add a unit to the cart, or increment it when the exact (product, variant)
 * line already exists. Validates the product is live + orderable, clamps the
 * resulting quantity to [MOQ, cap], and enforces the distinct-line ceiling.
 *
 * REQUIRES an approved viewer (re-checked here). The stored row carries NO
 * price — only the quantity.
 */
export async function addToCart(
  viewer: CustomerViewer,
  input: { productId: string; variantId?: string | null; quantity: number },
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
    select: { id: true, quantity: true },
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

  const desired = (existing?.quantity ?? 0) + input.quantity;
  const quantity = clampQuantity(desired, unit.moq);
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
): Promise<void> {
  try {
    await prisma.cartItem.create({
      data: { customerId, productId, variantId, quantity },
      select: { id: true },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      await prisma.cartItem.updateMany({
        where: { customerId, productId, variantId },
        data: { quantity },
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
  input: { productId: string; variantId?: string | null; quantity: number },
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

  const quantity = clampQuantity(input.quantity, unit.moq);
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
