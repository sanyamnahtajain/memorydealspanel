"use client";

import * as React from "react";

import { recordRecentlyViewed } from "./store";

/**
 * Mounted on the product page: records a price-free card for this product in
 * the browser's recently-viewed list. Renders nothing.
 */
export function RecentlyViewedRecorder({
  id,
  slug,
  name,
  brand,
  imageUrl,
}: {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
}) {
  React.useEffect(() => {
    recordRecentlyViewed({ id, slug, name, brand, imageUrl });
  }, [id, slug, name, brand, imageUrl]);
  return null;
}
