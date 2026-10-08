"use client";

import * as React from "react";

import { StorefrontListing } from "@/components/storefront/listing/StorefrontListing";
import type { StorefrontListingProps } from "@/components/storefront/listing/StorefrontListing";

import { DiscoveryFilters } from "./DiscoveryFilters";
import type { FacetData } from "./types";

export interface DiscoveryListingProps extends Omit<StorefrontListingProps, "filterSlot"> {
  facets: FacetData;
}

/**
 * DiscoveryListing — {@link DiscoveryFilters} wrapped around a
 * {@link StorefrontListing}, with the phone "Filters" trigger + active chips
 * placed INSIDE the listing's single sticky pill bar (next to Sort) instead of
 * stacking a second row above the count line. A server page cannot hand a
 * render function across the client boundary, so this client component does
 * the composition for /search and the brand × category page; every prop is
 * forwarded unchanged and nothing here reads a price.
 */
export function DiscoveryListing({ facets, total, ...listing }: DiscoveryListingProps) {
  return (
    <DiscoveryFilters facets={facets} resultCount={total}>
      {({ filterSlot }) => (
        <StorefrontListing {...listing} total={total} filterSlot={filterSlot} />
      )}
    </DiscoveryFilters>
  );
}
