import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getViewer } from "@/server/auth/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";
import {
  getBySlugForViewer,
  listByCategoryForViewer,
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
import { wishlistProductIds } from "@/server/services/wishlist";
import { recordProductView } from "@/server/services/pageviews";
import {
  ProductBreadcrumb,
  type ProductBreadcrumbCategory,
  WhatsAppEnquire,
  RelatedRail,
  type RelatedRailItem,
  StickyMobileBar,
  buildWhatsAppEnquiryLink,
  VariantProductView,
} from "@/components/storefront/product";
import { ProductPriceArea } from "./ProductPriceArea";

/**
 * Product detail page.
 *
 * The DAL (`getBySlugForViewer`) is THE price gate: an anon/pending/expired
 * viewer gets a `PublicProduct` with NO price fields, so nothing on this page
 * — including metadata, JSON-LD, the related rail, and the sticky mobile bar —
 * can leak a price. Related products go through `listByCategoryForViewer` (the
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
 * OpenGraph / SEO metadata. NEVER includes a price — we resolve the product
 * through the anonymous public projection so a price cannot even be in scope
 * here regardless of who requests the page.
 */
export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { slug } = await params;
  const product = await getBySlugForViewer({ kind: "anon" }, slug);
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
  const product = await getBySlugForViewer(viewer, slug);

  if (!product) {
    notFound();
  }

  const showPrices = canSeePrices(viewer);
  const customerStatus = isCustomer(viewer) ? viewer.status : undefined;

  // Record the view for the dashboard's "Most viewed" aggregation. Best-effort
  // analytics: never throws, not awaited into render, reads nothing gated.
  void recordProductView(
    product.id,
    isCustomer(viewer) ? viewer.customerId : null,
  );

  // Category (breadcrumb) + related products (same category), both gated. We
  // over-fetch by one so we can drop the current product and still fill the
  // rail. `renderPriceSlot` produces the per-viewer price cell server-side.
  const [category, relatedRaw, savedIds] = await Promise.all([
    resolveCategory(product.categoryId),
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
  ]);

  const initialSaved = savedIds.has(product.id);

  const related: RelatedRailItem[] = relatedRaw
    .filter((p) => p.id !== product.id)
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
  const enquireHref = buildWhatsAppEnquiryLink({
    productName: product.name,
    sku: product.sku,
  });

  // A product opts into variants per-row. When it does, a client coordinator
  // (VariantProductView) owns the gallery + selector so picking a variant
  // updates the gated price, stock, images, and enquiry CTA together. When it
  // doesn't (the catalog default), the static server hero renders exactly as
  // before. The header/footer JSX is shared across both paths.
  const showVariantHero =
    product.hasVariants && product.variants.length > 0;

  const heroHeader = (
    <header className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {product.brandRef ? (
          <BrandBadge
            name={product.brandRef.name}
            slug={product.brandRef.slug}
            size="md"
          />
        ) : product.brand ? (
          <span className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            {product.brand}
          </span>
        ) : null}
        <StatusChip
          variant={STOCK_CHIP[product.stockStatus]}
          label={STOCK_LABEL[product.stockStatus]}
        />
      </div>
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {product.name}
        </h1>
        {/* Save to wishlist — carries no price; prompts login for anon. */}
        <HeartButton
          productId={product.id}
          initialSaved={initialSaved}
          size="default"
          className="-mr-1 shrink-0"
        />
      </div>
      {/* For a variant product the per-variant SKU shows in the selector. */}
      {showVariantHero ? null : (
        <p className="text-xs text-muted-foreground">SKU: {product.sku}</p>
      )}
    </header>
  );

  const heroFooter = (
    <>
      {product.moq ? (
        <p className="text-sm text-muted-foreground">
          Minimum order quantity:{" "}
          <span className="font-medium text-foreground">
            {product.moq} units
          </span>
        </p>
      ) : null}

      {product.description ? (
        <p className="text-sm leading-relaxed text-foreground/80">
          {product.description}
        </p>
      ) : null}

      <SpecSection specs={product.specs} />
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

  return (
    <StorefrontShell>
      <script
        type="application/ld+json"
        // Static, price-free object — no user input is interpolated.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">
        <ProductBreadcrumb productName={product.name} category={category} />

        {showVariantHero ? (
          <VariantProductView
            productName={product.name}
            productImages={product.images}
            productId={product.id}
            optionTypes={product.optionTypes}
            variants={product.variants}
            showPrices={showPrices}
            status={customerStatus}
            header={heroHeader}
            footer={heroFooter}
          />
        ) : (
          <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <FadeUp>
              <div className="lg:sticky lg:top-20">
                <ProductGallery
                  images={product.images}
                  productName={product.name}
                  productId={product.id}
                />
              </div>
            </FadeUp>

            <FadeUp delay={0.05}>
              <div className="flex flex-col gap-5">
                {heroHeader}

                <ProductPriceArea
                  product={product as PublicProduct | PricedProduct}
                  showPrices={showPrices}
                  status={customerStatus}
                />

                {/* Inline Enquire — hidden on mobile where the sticky bar owns it. */}
                <div className="hidden md:block">
                  <WhatsAppEnquire
                    productName={product.name}
                    sku={product.sku}
                  />
                </div>

                {heroFooter}
              </div>
            </FadeUp>
          </div>
        )}

        {related.length > 0 ? (
          <FadeUp delay={0.1}>
            <section className="mt-12" aria-labelledby="related-heading">
              <h2
                id="related-heading"
                className="mb-4 font-heading text-lg font-semibold tracking-tight sm:text-xl"
              >
                More in {category ? category.name : "this category"}
              </h2>
              <RelatedRail items={related} />
            </section>
          </FadeUp>
        ) : null}
      </div>

      <StickyMobileBar
        enquireHref={enquireHref}
        canSeePrices={showPrices}
        priceLabel={stickyPriceLabel}
        status={customerStatus}
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

/** Specs block with a heading; renders nothing when there are no specs. */
function SpecSection({ specs }: { specs: unknown }) {
  if (!hasPrintableSpecs(specs)) return null;
  return (
    <div className="space-y-3">
      <h2 className="font-heading text-base font-semibold tracking-tight">
        Specifications
      </h2>
      <SpecTable specs={specs} />
    </div>
  );
}
