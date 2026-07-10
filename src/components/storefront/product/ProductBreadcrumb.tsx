import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface ProductBreadcrumbCategory {
  name: string;
  slug: string;
}

export interface ProductBreadcrumbProps {
  /** Current product name (the terminal, non-link crumb). */
  productName: string;
  /** The product's category, when it resolves to an ACTIVE category. */
  category?: ProductBreadcrumbCategory | null;
}

/**
 * Home / Category / Product breadcrumb.
 *
 * Server component — price-free by construction. The category crumb links to
 * `/c/[slug]` when we could resolve an ACTIVE category; otherwise it is
 * omitted so we never render a dead link. Emits BreadcrumbList-friendly
 * markup (ordered list) for accessibility.
 */
export function ProductBreadcrumb({
  productName,
  category,
}: ProductBreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <li className="flex items-center gap-1">
          <Link
            href="/"
            className="rounded transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Home
          </Link>
        </li>
        {category ? (
          <li className="flex items-center gap-1">
            <ChevronRight aria-hidden className="size-4 shrink-0 opacity-70" />
            <Link
              href={`/c/${category.slug}`}
              className="max-w-[9rem] truncate rounded transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-none"
            >
              {category.name}
            </Link>
          </li>
        ) : null}
        <li className="flex min-w-0 items-center gap-1">
          <ChevronRight aria-hidden className="size-4 shrink-0 opacity-70" />
          <span
            aria-current="page"
            className="truncate font-medium text-foreground"
          >
            {productName}
          </span>
        </li>
      </ol>
    </nav>
  );
}
