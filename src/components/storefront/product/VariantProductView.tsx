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
  optionTypes: ProductOptionType[];
  variants: Array<PublicVariant | PricedVariant>;
  showPrices: boolean;
  status?: CustomerStatus;
  /** Rendered between the header and the selector (name, brand, SKU, etc.). */
  header?: React.ReactNode;
  /** Rendered after the selector (moq, description, specs). */
  footer?: React.ReactNode;
}

export function VariantProductView({
  productName,
  productImages,
  productId,
  optionTypes,
  variants,
  showPrices,
  status,
  header,
  footer,
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
    <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <FadeUp>
        <div className="lg:sticky lg:top-20">
          <ProductGallery
            images={selectedImages}
            productName={productName}
            productId={productId}
          />
        </div>
      </FadeUp>

      <FadeUp delay={0.05}>
        <div className="flex flex-col gap-5">
          {header}
          <VariantSelector
            productName={productName}
            optionTypes={optionTypes}
            variants={variants}
            showPrices={showPrices}
            status={status}
            onVariantChange={handleVariantChange}
          />
          {footer}
        </div>
      </FadeUp>
    </div>
  );
}
