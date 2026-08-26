import type { Metadata } from "next";
import { cache } from "react";
import { googleOAuthConfigured } from "@/server/services/google-auth";
import { notFound } from "next/navigation";

import { getViewer } from "@/server/auth/viewer";
import { ANON_VIEWER, canSeePrices, isCustomer } from "@/server/types/viewer";
import {
  getBySlugForViewer,
  listByCategoryForViewer,
  listByIdsForViewer,
} from "@/server/dal/products";
import { listActive } from "@/server/dal/categories";
import type { PublicProduct, PricedProduct } from "@/server/dto/product";
import type { StockStatus } from "@/lib/schemas/shared";
import { APP_NAME } from "@/lib/constants";
import { formatPaise } from "@/lib/money";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { StatusChip, type StatusChipVariant } from "@/components/common";
import { FadeUp } from "@/components/motion/primitives";
import { ProductGallery } from "@/components/storefront/ProductGallery";
import { BrandBadge } from "@/components/storefront/BrandBadge";
import { SpecTable } from "@/components/storefront/SpecTable";
import { renderPriceSlot } from "@/components/storefront/priceSlot";
import { HeartButton } from "@/components/storefront/wishlist/HeartButton";
import { AddToCartButton } from "@/components/storefront/cart/AddToCartButton";
import { AllocationAddToCart } from "@/components/storefront/allocation/AllocationAddToCart";
import { wishlistProductIds } from "@/server/services/wishlist";
import { cartCountForViewer } from "@/server/services/cart";
import { recordProductView } from "@/server/services/pageviews";
import { getSellerTaxProfile } from "@/server/services/tax-profile";
import { coPurchasedProductIds } from "@/server/services/recommendations";
import { getGstViewPreference } from "@/server/prefs/gst-view";
import {
  ProductBreadcrumb,
  type ProductBreadcrumbCategory,
  WhatsAppEnquire,
  RelatedRail,
  type RelatedRailItem,
  StickyMobileBar,
  VariantProductView,
  CollapsibleSection,
  ReadMoreText,
  InfoPill,
  TrustRow,
  BoxGlyph,
  LayersGlyph,
  TruckGlyph,
  PRICE_PANEL_ID,
} from "@/components/storefront/product";
import { getDeliveryDisclosure } from "@/server/services/store-settings";
import { deliveryDisclosureCopy } from "@/lib/delivery";
import {
  whatsappEnquiryHrefForViewer,
  whatsappNumberForViewer,
} from "@/server/contact";
import { ProductPriceArea } from "./ProductPriceArea";
import { RequirementPrompt } from "@/components/storefront/requirements/RequirementPrompt";
import { effectivePerModelPack } from "@/lib/allocation";
import { prisma } from "@/server/db";
import { publicBaseOrEmpty } from "@/server/storage/r2";
import {
  sanitizeNote as sanitizeRequirementNote,
  sanitizeAttachments,
} from "@/lib/requirement-notes";

/**
 * Product detail page.
 *
 * The DAL (`getBySlugForViewer`) is THE price gate: an anon/pending/expired
 * viewer gets a `PublicProduct` with NO price fields, so nothing on this page
 * — including metadata, JSON-LD, the related rail, and the sticky mobile bar —
 * can leak a price. Related products go through the gated DAL reads (the
 * same gate) and their price cells are server-rendered `renderPriceSlot`
 * nodes, so no amount ever crosses into a client component for a gated viewer.
 *
 * RENDERING: reading the viewer (cookies) makes this dynamic so an approved
 * customer sees live pricing. It never embeds a price for a gated viewer.
 */
export const dynamic = "force-dynamic";

interface PageParams {
  params: Promise<{ slug: string }>;
}

const STOCK_LABEL: Record<StockStatus, string> = {
  IN_STOCK: "In stock",
  LOW: "Low stock",
  OUT_OF_STOCK: "Out of stock",
};

const STOCK_CHIP: Record<StockStatus, StatusChipVariant> = {
  IN_STOCK: "approved",
  LOW: "pending",
  OUT_OF_STOCK: "rejected",
};

/** Max related products shown in the "More in this category" rail. */
const RELATED_LIMIT = 12;

/**
 * ANON-projection detail read, deduped per request with React `cache()` —
 * the same pattern `categories.getBySlug` documents. Every product view runs
 * `generateMetadata` (always anon — metadata must never see a price) AND the
 * page body; for a GATED viewer both reads are byte-identical, so sharing
 * this one memoised fetch halves the detail queries on the hottest page.
 * Priced viewers still get their own (priced) query in the page body.
 */
const getBySlugAnonCached = cache(async (slug: string) =>
  getBySlugForViewer(ANON_VIEWER, slug),
);

/**
 * OpenGraph / SEO metadata. NEVER includes a price — we resolve the product
 * through the anonymous public projection so a price cannot even be in scope
 * here regardless of who requests the page.
 */
export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { slug } = await params;
  const product = await getBySlugAnonCached(slug);
  if (!product) {
    return { title: `Product not found — ${APP_NAME}` };
  }

  const title = product.brand
    ? `${product.name} · ${product.brand} — ${APP_NAME}`
    : `${product.name} — ${APP_NAME}`;
  const description =
    product.description?.slice(0, 200) ??
    `${product.name} available on ${APP_NAME}. Enquire for wholesale pricing.`;
  const image = product.images.find((img) => img.isPrimary) ?? product.images[0];

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: image ? [{ url: image.url, alt: product.name }] : undefined,
    },
  };
}

/**
 * Resolves the product's category to a { name, slug } for the breadcrumb.
 * Categories are few and cached; we map the ACTIVE set by id. Returns null
 * when the category is inactive/missing so no dead crumb is rendered.
 */
async function resolveCategory(
  categoryId: string,
): Promise<ProductBreadcrumbCategory | null> {
  const categories = await listActive();
  const match = categories.find((c) => c.id === categoryId);
  return match ? { name: match.name, slug: match.slug } : null;
}

export default async function ProductDetailPage({ params }: PageParams) {
  const { slug } = await params;
  const viewer = await getViewer();
  const showPrices = canSeePrices(viewer);
  // One detail query per request (perf finding 5): a gated viewer's read is
  // byte-identical to the anon projection `generateMetadata` already fetched,
  // so share the request-cached anon read. Priced viewers branch to their own
  // priced query — the gate itself is untouched.
  const product = showPrices
    ? await getBySlugForViewer(viewer, slug)
    : await getBySlugAnonCached(slug);

  if (!product) {
    notFound();
  }
  const customerStatus = isCustomer(viewer) ? viewer.status : undefined;

  // Record the view for the dashboard's "Most viewed" aggregation. Best-effort
  // analytics: never throws, not awaited into render, reads nothing gated.
  void recordProductView(
    product.id,
    isCustomer(viewer) ? viewer.customerId : null,
  );

  // Category (breadcrumb) + related products, both gated, PLUS the tax
  // profile — one parallel round instead of a sequential await before it.
  //
  // "Related" now leads with CO-PURCHASE data — what shops actually order
  // together (src/lib/recommend.ts) — and fills any remaining slots with
  // category peers, which is also the complete fallback while a product has
  // no order history yet. Category peers are over-fetched so the rail still
  // fills after dropping the current product and any co-purchase duplicates.
  const [taxProfile, category, coPurchasedIds, categoryPeers, savedIds, cartCount, deliveryDisclosure] = await Promise.all([
    getSellerTaxProfile(),
    resolveCategory(product.categoryId),
    coPurchasedProductIds(product.id, RELATED_LIMIT),
    listByCategoryForViewer(viewer, product.categoryId, {
      page: 1,
      take: RELATED_LIMIT + 1,
    }),
    // Seed the save heart's filled state for a logged-in customer. Anon/admin
    // get an empty set (heart renders empty and prompts login on tap). Reads no
    // price — only this customer's own saved product ids.
    isCustomer(viewer)
      ? wishlistProductIds(viewer.customerId)
      : Promise.resolve(new Set<string>()),
    // Header cart badge — a count only for an approved customer, else undefined.
    cartCountForViewer(viewer),
    // Delivery-charge disclosure for the PDP's delivery note. Fetched ONLY for
    // a viewer with live price access — the public page shows no amounts of
    // any kind, delivery included.
    showPrices ? getDeliveryDisclosure() : Promise.resolve(null),
  ]);

  // GST view preference — only wording of the tax line; inert while GST is off.
  const gstView = taxProfile.gstEnabled
    ? await getGstViewPreference()
    : undefined;

  const initialSaved = savedIds.has(product.id);

  // Resolve the ranked co-purchase ids through the same gated read the rest
  // of the storefront uses (hidden products drop out; order is preserved).
  const coPurchased = coPurchasedIds.length
    ? await listByIdsForViewer(viewer, coPurchasedIds)
    : [];
  const seen = new Set<string>([product.id]);
  const relatedRaw = [...coPurchased, ...categoryPeers].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  const related: RelatedRailItem[] = relatedRaw
    .slice(0, RELATED_LIMIT)
    .map((p) => ({
      // The rail is a client component; hand it only the public projection.
      product: toPublicShape(p),
      priceSlot: renderPriceSlot(p, viewer, "sm"),
    }));

  const primaryImage =
    product.images.find((img) => img.isPrimary) ?? product.images[0] ?? null;

  // The sticky mobile bar receives a *formatted string* only when the gate is
  // open — never a raw amount. When gated this is undefined and the bar shows
  // the "See price" affordance / a status word.
  const stickyPriceLabel =
    showPrices && hasPrice(product) ? formatPaise(product.price) : undefined;
  // WhatsApp gate (owner request): the wa.me link — and the number the variant
  // selector needs — exist ONLY for a viewer with live access. Gated viewers
  // get `null`, and every CTA renders a locked "request access" affordance.
  const enquireHref = whatsappEnquiryHrefForViewer(viewer, {
    productName: product.name,
    sku: product.sku,
  });
  const whatsappNumber = whatsappNumberForViewer(viewer);

  // Google gate for every price CTA on this page. returnTo is THIS product —
  // a shopper who signs in from a product page lands back on it, not /account.
  const googleGateHref = googleOAuthConfigured()
    ? `/auth/google/start?returnTo=${encodeURIComponent(`/p/${slug}`)}`
    : null;

  // A product opts into variants per-row. When it does, a client coordinator
  // (VariantProductView) owns the gallery + selector so picking a variant
  // updates the gated price, stock, images, and enquiry CTA together. When it
  // doesn't (the catalog default), the static server hero renders exactly as
  // before. The header/footer JSX is shared across both paths.
  const showVariantHero =
    product.hasVariants && product.variants.length > 0;

  // Title block: brand as a tappable chip, the name in confident display
  // type, then ONE quiet line with the SKU and the stock chip. The wishlist
  // heart now floats over the gallery (see `galleryHeart`), not up here.
  const heroHeader = (
    <header className="space-y-2.5">
      {product.brandRef ? (
        <div>
          <BrandBadge
            name={product.brandRef.name}
            slug={product.brandRef.slug}
            size="md"
          />
        </div>
      ) : product.brand ? (
        <span className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {product.brand}
        </span>
      ) : null}
      <h1 className="font-heading text-[1.65rem] leading-[1.15] font-semibold tracking-tight text-balance sm:text-3xl lg:text-4xl">
        {product.name}
      </h1>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <StatusChip
          variant={STOCK_CHIP[product.stockStatus]}
          label={STOCK_LABEL[product.stockStatus]}
        />
        {product.sku ? (
          <span className="text-xs text-muted-foreground">
            SKU {product.sku}
          </span>
        ) : null}
      </div>
    </header>
  );

  // Save to wishlist — floats over the gallery's corner. Carries no price;
  // prompts login for anon.
  const galleryHeart = (
    <span className="inline-flex rounded-full bg-background/90 shadow-md ring-1 ring-foreground/10 backdrop-blur-sm">
      <HeartButton
        productId={product.id}
        initialSaved={initialSaved}
        size="default"
      />
    </span>
  );

  // Reassurance chips near the CTA — only claims that are true of this shop
  // (see TrustRow). GST invoice appears only while the GST profile is on.
  const trustRow = <TrustRow gstInvoice={taxProfile.gstEnabled} />;

  // Below-the-panel content: collapsible sections (collapsed on phones,
  // expanded from md: up) and the delivery note. Every field the old page
  // showed still renders — nothing was cut, only foldered.
  const heroFooter = (
    <>
      <SpecSection specs={product.specs} />

      {product.description ? (
        // Description (owner note): the admin's typed line breaks are
        // preserved (whitespace-pre-line); long text clamps with "Read more".
        <CollapsibleSection title="Description">
          <ReadMoreText text={product.description} />
        </CollapsibleSection>
      ) : null}

      {deliveryDisclosure ? (
        <DeliveryNote
          minChargePaise={deliveryDisclosure.minChargePaise}
          note={deliveryDisclosure.note}
        />
      ) : null}
    </>
  );

  // JSON-LD: deliberately OMITS `offers`/`price` — the price gate applies to
  // structured data too. Only price-free descriptive fields are emitted.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    ...(product.brand
      ? { brand: { "@type": "Brand", name: product.brand } }
      : {}),
    ...(product.description ? { description: product.description } : {}),
    ...(primaryImage ? { image: primaryImage.url } : {}),
  };

  // Approved customers may add THIS product to their cart. Out-of-stock and
  // gated viewers get a locked/blocked affordance from the button itself. For a
  // variant product the AddToCartButton lives inside VariantProductView (it
  // needs the selected variant + its MOQ), so the non-variant hero owns it here.
  const canAdd = showPrices && !showVariantHero;

  // The pack that governs per-model quantities: the product's own pack wins,
  // else the allocation config's (category-default) pack — see
  // effectivePerModelPack. Also what the "Pack of" pill shows, so the fact a
  // buyer reads matches the rule the builder enforces.
  const effectivePack = product.allocation?.required
    ? effectivePerModelPack(product.allocation.packMultiple, product.packMultiple)
    : product.packMultiple;

  // Sticky-bar one-tap add (ORDER_FLOW proposal 1): the same gate as the
  // inline AddToCartButton — a PRICED viewer on a non-variant product — and
  // only when the flow is genuinely one tap: an allocation product's flow is
  // the breakdown builder and an out-of-stock product cannot be added, so
  // both keep the bar's current layout. Gated viewers never get this prop,
  // so every locked branch of the bar renders exactly as before. Carries NO
  // money — ids and quantity rules only.
  const stickyAddToCart =
    canAdd &&
    !product.allocation?.required &&
    product.stockStatus !== "OUT_OF_STOCK"
      ? {
          productId: product.id,
          moq: product.moq,
          packMultiple: product.packMultiple,
        }
      : null;

  // Requirement notes & photos: when this product allows them and the viewer
  // already carries a cart line, seed the PDP sheet with the stored values so
  // reopening never silently overwrites what was written earlier.
  let requirementInitial: {
    note: string | null;
    attachments: { url: string }[];
  } | null = null;
  if (product.allowRequirementNotes && canAdd && isCustomer(viewer)) {
    const row = await prisma.cartItem.findFirst({
      where: { customerId: viewer.customerId, productId: product.id },
      select: { note: true, attachments: true },
    });
    const base = publicBaseOrEmpty();
    requirementInitial = {
      note: sanitizeRequirementNote(row?.note ?? null),
      attachments: sanitizeAttachments(row?.attachments ?? null, base),
    };
  }

  return (
    <StorefrontShell cartCount={cartCount}>
      <script
        type="application/ld+json"
        // Static, price-free object — no user input is interpolated.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* No horizontal padding here: StorefrontShell's <main> already applies
          px-4 (md:px-6). This container used to add its own on top, so the
          product page sat in double the gutter of every other page — most
          obvious in the installed app on a phone, where screen width is
          scarcest. Vertical padding is tighter on small screens too. */}
      <div className="mx-auto w-full max-w-5xl py-3 sm:py-8">
        <ProductBreadcrumb productName={product.name} category={category} />

        {showVariantHero ? (
          <VariantProductView
            googleGateHref={googleGateHref}
            whatsappNumber={whatsappNumber}
            productName={product.name}
            productImages={product.images}
            productId={product.id}
            moq={product.moq}
            packMultiple={product.packMultiple}
            optionTypes={product.optionTypes}
            variants={product.variants}
            showPrices={showPrices}
            status={customerStatus}
            header={heroHeader}
            footer={heroFooter}
            galleryOverlay={galleryHeart}
            trustSlot={trustRow}
          />
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:gap-10 lg:gap-12">
            <FadeUp>
              <div className="relative md:sticky md:top-20">
                <ProductGallery
                  images={product.images}
                  productName={product.name}
                  productId={product.id}
                />
                <div className="absolute top-3 right-3 z-10">{galleryHeart}</div>
              </div>
            </FadeUp>

            <div className="flex flex-col gap-5 sm:gap-6">
              <FadeUp delay={0.06}>{heroHeader}</FadeUp>

              {/* THE PRICE PANEL — the page's visual anchor: one elevated card
                  holding the price (or the gate), the GST line, the MOQ/pack
                  pills, the primary CTA and the reassurance row. Its id lets
                  the StickyMobileBar spring in once it scrolls out of view. */}
              <FadeUp delay={0.12}>
                <section
                  id={PRICE_PANEL_ID}
                  aria-label="Price and ordering"
                  className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-foreground/5 sm:p-6"
                >
                  <ProductPriceArea
                    googleGateHref={googleGateHref}
                    product={product as PublicProduct | PricedProduct}
                    showPrices={showPrices}
                    status={customerStatus}
                    gstView={gstView}
                  />

                  {/* MOQ / pack facts as small labelled pills (same data the
                      old sentence carried). */}
                  {product.moq || effectivePack ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {product.moq ? (
                        <InfoPill
                          icon={<BoxGlyph />}
                          label="Min. order"
                          value={`${product.moq} units`}
                        />
                      ) : null}
                      {effectivePack ? (
                        <InfoPill
                          icon={<LayersGlyph />}
                          label="Pack of"
                          value={String(effectivePack)}
                        />
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-col gap-3">
                    {/* Add to cart — approved-only. The button self-gates: an
                        unapproved/anon viewer sees a locked CTA that routes to
                        login/request-access; OUT_OF_STOCK is blocked. It sends
                        only { productId, quantity } — never a price. */}
                    {product.allocation?.required ? (
                      <AllocationAddToCart
                        productId={product.id}
                        moq={product.moq}
                        packMultiple={effectivePack}
                        // Per-model minimum from the allocation config — the
                        // builder seeds rows at the pack-aligned minimum and
                        // shows the same inline errors the server would send.
                        minPerModel={product.allocation?.minPerModel ?? null}
                        canAdd={canAdd}
                        isCustomer={isCustomer(viewer)}
                        outOfStock={product.stockStatus === "OUT_OF_STOCK"}
                      />
                    ) : (
                      <AddToCartButton
                        productId={product.id}
                        moq={product.moq}
                        packMultiple={product.packMultiple}
                        canAdd={canAdd}
                        isCustomer={isCustomer(viewer)}
                        outOfStock={product.stockStatus === "OUT_OF_STOCK"}
                      />
                    )}

                    {/* Requirement notes & photos — admin-flagged products
                        only. Auto-opens right after an add via the cart-events
                        bus. */}
                    {product.allowRequirementNotes ? (
                      <RequirementPrompt
                        productId={product.id}
                        productName={product.name}
                        canAdd={canAdd}
                        initialNote={requirementInitial?.note ?? null}
                        initialAttachments={requirementInitial?.attachments ?? []}
                      />
                    ) : null}

                    {/* Inline Enquire — hidden on mobile where the sticky bar
                        owns it. */}
                    <div className="hidden md:block">
                      <WhatsAppEnquire
                        href={enquireHref}
                        productName={product.name}
                        status={customerStatus}
                        googleGateHref={googleGateHref}
                      />
                    </div>
                  </div>

                  <div className="mt-5">{trustRow}</div>
                </section>
              </FadeUp>

              <FadeUp delay={0.18} className="flex flex-col gap-4">
                {heroFooter}
              </FadeUp>
            </div>
          </div>
        )}

        {related.length > 0 ? (
          <FadeUp delay={0.1}>
            <section className="mt-12" aria-labelledby="related-heading">
              <h2
                id="related-heading"
                className="mb-4 font-heading text-lg font-semibold tracking-tight sm:text-xl"
              >
                Shops also ordered
              </h2>
              <RelatedRail items={related} bleed />
            </section>
          </FadeUp>
        ) : null}
      </div>

      <StickyMobileBar
        googleGateHref={googleGateHref}
        enquireHref={enquireHref}
        canSeePrices={showPrices}
        priceLabel={stickyPriceLabel}
        status={customerStatus}
        addToCart={stickyAddToCart}
      />
    </StorefrontShell>
  );
}

/** Narrows a product DTO to its priced form without trusting a leaked field. */
function hasPrice(
  product: PublicProduct | PricedProduct,
): product is PricedProduct {
  return "price" in product && typeof product.price === "number";
}

/**
 * Strips any price fields off a DTO before it crosses into the client rail.
 * For a gated viewer the DAL already returned a PublicProduct (no money), but
 * this explicit allow-list is belt-and-braces so a PricedProduct handed to a
 * *client* component can never carry an amount.
 */
function toPublicShape(p: PublicProduct | PricedProduct): PublicProduct {
  return {
    id: p.id,
    categoryId: p.categoryId,
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    brand: p.brand,
    brandRef: p.brandRef,
    description: p.description,
    specs: p.specs,
    moq: p.moq,
    packMultiple: p.packMultiple,
    maxQty: p.maxQty,
    allowRequirementNotes: p.allowRequirementNotes,
    allocation: p.allocation,
    stockStatus: p.stockStatus,
    status: p.status,
    tags: p.tags,
    images: p.images,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    // The related rail renders cards off the denormalized "from" price only —
    // it never needs variant rows, so we drop them here (also keeps the client
    // payload lean). Non-variant products already carry empty axes.
    hasVariants: p.hasVariants,
    optionTypes: p.optionTypes,
    variants: [],
    // NON-MONETARY GST metadata (HSN / rate bps / inclusive flag) — carries no
    // paise, so it is safe to keep on the public shape crossing into the client.
    tax: p.tax,
  };
}

/**
 * True when `specs` has at least one printable key/value — mirrors the empty
 * check in {@link SpecTable} so we can hide the whole section (heading
 * included) when there's nothing to show.
 */
function hasPrintableSpecs(specs: unknown): boolean {
  if (specs === null || typeof specs !== "object" || Array.isArray(specs)) {
    return false;
  }
  return Object.values(specs as Record<string, unknown>).some((v) => {
    if (typeof v === "string") return v.trim().length > 0;
    if (typeof v === "number" || typeof v === "boolean") return true;
    if (Array.isArray(v)) return v.some((item) => String(item ?? "").trim().length > 0);
    return false;
  });
}

/**
 * Specs section — a collapsible chevron row (collapsed on phones, expanded on
 * md+); renders nothing when there are no printable specs.
 */
function SpecSection({ specs }: { specs: unknown }) {
  if (!hasPrintableSpecs(specs)) return null;
  return (
    <CollapsibleSection title="Specifications">
      {/* The section card already provides the surface — flatten the table's
          own chrome to a quiet inset. */}
      <SpecTable specs={specs} className="rounded-xl border-border/60 bg-muted/20" />
    </CollapsibleSection>
  );
}

/**
 * Delivery note — the PDP presentation of the canonical delivery-charge
 * disclosure (src/lib/delivery.ts wording, house-style truck glyph). Rendered
 * ONLY for a viewer with live price access: the public page shows no amounts
 * of any kind. The cart/orders keep the shared DeliveryNotice component.
 */
function DeliveryNote({
  minChargePaise,
  note,
}: {
  minChargePaise: number;
  note: string | null;
}) {
  const copy = deliveryDisclosureCopy(formatPaise(minChargePaise));
  return (
    <section
      aria-label="Delivery"
      className="flex items-start gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/5 sm:p-5"
    >
      <TruckGlyph className="mt-0.5 size-6 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{copy.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {copy.detail}
        </p>
        {note ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {note}
          </p>
        ) : null}
      </div>
    </section>
  );
}
