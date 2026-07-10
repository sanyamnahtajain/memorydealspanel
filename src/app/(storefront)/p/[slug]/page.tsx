import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { getViewer } from "@/server/auth/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";
import { getBySlugForViewer } from "@/server/dal/products";
import type { PublicProduct, PricedProduct } from "@/server/dto/product";
import type { StockStatus } from "@/lib/schemas/shared";
import { APP_NAME } from "@/lib/constants";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { StatusChip, type StatusChipVariant } from "@/components/common";
import { FadeUp } from "@/components/motion/primitives";
import { ProductGallery } from "@/components/storefront/ProductGallery";
import { SpecTable } from "@/components/storefront/SpecTable";
import { EnquireButton } from "@/components/storefront/EnquireButton";
import { recordProductView } from "@/server/services/pageviews";
import { ProductPriceArea } from "./ProductPriceArea";

/**
 * Product detail page.
 *
 * The DAL (`getBySlugForViewer`) is THE price gate: an anon/pending/expired
 * viewer gets a `PublicProduct` with NO price fields, so nothing on this page
 * — including metadata and any structured data — can leak a price. When the
 * viewer is price-authorised the page must be dynamic; otherwise it is a
 * price-free public page and is ISR-friendly.
 */

// Anonymous renders are identical & price-free, so allow ISR. A price-
// authorised viewer forces per-request rendering via `dynamic` below, which
// Next honours because we read the (dynamic) session inside `getViewer()`.
export const revalidate = 300;

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

export default async function ProductDetailPage({ params }: PageParams) {
  const { slug } = await params;
  const viewer = await getViewer();
  const product = await getBySlugForViewer(viewer, slug);

  if (!product) {
    notFound();
  }

  const showPrices = canSeePrices(viewer);
  const customerStatus = isCustomer(viewer) ? viewer.status : undefined;

  // Record the view for the dashboard's "Most viewed" aggregation. This is
  // best-effort analytics: `recordProductView` never throws, we do NOT await
  // it into the render path, and it reads nothing gated — so it can neither
  // block the page nor alter price-gate behaviour.
  void recordProductView(
    product.id,
    isCustomer(viewer) ? viewer.customerId : null,
  );
  const primaryImage =
    product.images.find((img) => img.isPrimary) ?? product.images[0] ?? null;

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
        <Breadcrumb name={product.name} />

        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <FadeUp>
            <ProductGallery
              images={product.images}
              productName={product.name}
              productId={product.id}
            />
          </FadeUp>

          <FadeUp delay={0.05}>
            <div className="flex flex-col gap-5">
              <header className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {product.brand ? (
                    <span className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
                      {product.brand}
                    </span>
                  ) : null}
                  <StatusChip
                    variant={STOCK_CHIP[product.stockStatus]}
                    label={STOCK_LABEL[product.stockStatus]}
                  />
                </div>
                <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
                  {product.name}
                </h1>
                <p className="text-xs text-muted-foreground">
                  SKU: {product.sku}
                </p>
              </header>

              <ProductPriceArea
                product={product as PublicProduct | PricedProduct}
                showPrices={showPrices}
                status={customerStatus}
              />

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

              <EnquireButton productName={product.name} sku={product.sku} />

              <SpecTable specs={product.specs} />
            </div>
          </FadeUp>
        </div>
      </div>
    </StorefrontShell>
  );
}

function Breadcrumb({ name }: { name: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 text-sm text-muted-foreground"
    >
      <Link href="/" className="transition-colors hover:text-foreground">
        Catalog
      </Link>
      <ChevronRight aria-hidden className="size-4 shrink-0" />
      <span className="truncate font-medium text-foreground">{name}</span>
    </nav>
  );
}
