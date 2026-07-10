"use client";

import * as React from "react";
import { Stagger } from "@/components/motion/primitives";
import { TrashCard } from "./TrashCard";
import type { TrashedProduct } from "./types";

interface TrashListProps {
  products: TrashedProduct[];
  /** Reference "now" (epoch ms) for the retention countdowns. */
  now: number;
}

/**
 * Responsive, staggered grid of {@link TrashCard}s. The parent page guarantees
 * a non-empty list (it renders an EmptyState otherwise).
 */
export function TrashList({ products, now }: TrashListProps) {
  return (
    <Stagger
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      itemClassName="min-w-0"
    >
      {products.map((product) => (
        <TrashCard key={product.id} product={product} now={now} />
      ))}
    </Stagger>
  );
}
