"use client";

import * as React from "react";

import type {
  ProductOptionType,
  PublicProductImage,
} from "@/server/dto/product";
import type { PublicVariant, PricedVariant } from "@/server/dto/variant";
import type { CustomerStatus } from "@/lib/schemas/shared";
import { FadeUp } from "@/components/motion/primitives";
import { ProductGallery } from "@/components/storefront/ProductGallery";
import { VariantSelector } from "./VariantSelector";

/**
 * Client coordinator for a VARIANT product's detail hero — the shared boundary
 * that lets the gallery and the variant selector react to the same selection.
 *
 * It renders the two-column hero (gallery + selection panel). Picking a variant
 * in the {@link VariantSelector} swaps the gallery to that variant's images
 * when it has any, and otherwise falls back to the product-level images. The
 * selector owns the gated price/stock/enquire render; this wrapper owns only
 * the image coordination.
 *
 * Mounted ONLY when `product.hasVariants` is true. Non-variant products keep
 * the server-rendered static hero unchanged (see the page).
 *
 * PRICE-GATE SAFETY: `variants` arrive already gated by the DAL (PublicVariant
 * for gated viewers, no price in scope). `showPrices` is the authoritative
 * verdict passed straight through to the selector.
 */
export interface VariantProductViewProps {
  productName: string;
  /** Product-level images — the fallback when a variant has none of its own. */
  productImages: PublicProductImage[];
  productId: string;
  /** Product-level MOQ — the add-to-cart quantity floor. */
  moq?: number | null;
  packMultiple?: number | null;
  optionTypes: ProductOptionType[];
  variants: Array<PublicVariant | PricedVariant>;
  showPrices: boolean;
  status?: CustomerStatus;
  /** Rendered between the header and the selector (name, brand, SKU, etc.). */
  header?: React.ReactNode;
  /** Rendered after the selector (moq, description, specs). */
  footer?: React.ReactNode;
  /** Google-only access gate — routes "Request access" to Google when set. */
  googleGateHref?: string | null;
  /** Shop WhatsApp number — server-gated; `null` when the viewer can't contact. */
  whatsappNumber: string | null;
  /**
   * Floating control rendered over the gallery's top-right corner (the wishlist
   * heart). Positioned here so the variant hero matches the static hero.
   */
  galleryOverlay?: React.ReactNode;
  /** Server-rendered reassurance row, forwarded into the selector's panel. */
  trustSlot?: React.ReactNode;
}

export function VariantProductView({
  productName,
  productImages,
  productId,
  moq,
  packMultiple,
  optionTypes,
  variants,
  showPrices,
  status,
  header,
  footer,
  googleGateHref = null,
  whatsappNumber,
  galleryOverlay,
  trustSlot,
}: VariantProductViewProps) {
  const [selectedImages, setSelectedImages] =
    React.useState<PublicProductImage[]>(productImages);

  const handleVariantChange = React.useCallback(
    (variant: PublicVariant | PricedVariant | null) => {
      const images =
        variant && variant.images.length > 0 ? variant.images : productImages;
      setSelectedImages(images);
    },
    [productImages],
  );

  return (
    <div className="mt-4 grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:gap-10 lg:gap-12">
      <FadeUp>
        <div className="relative md:sticky md:top-20">
          <ProductGallery
            images={selectedImages}
            productName={productName}
            productId={productId}
          />
          {galleryOverlay ? (
            <div className="absolute top-3 right-3 z-10">{galleryOverlay}</div>
          ) : null}
        </div>
      </FadeUp>

      <FadeUp delay={0.06}>
        <div className="flex flex-col gap-5 sm:gap-6">
          {header}
          <VariantSelector
            googleGateHref={googleGateHref}
            whatsappNumber={whatsappNumber}
            productName={productName}
            productId={productId}
            moq={moq}
            packMultiple={packMultiple}
            optionTypes={optionTypes}
            variants={variants}
            showPrices={showPrices}
            status={status}
            onVariantChange={handleVariantChange}
            trustSlot={trustSlot}
          />
          {footer}
        </div>
      </FadeUp>
    </div>
  );
}
