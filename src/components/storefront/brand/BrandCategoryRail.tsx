import Link from "next/link";
import { LayoutGrid } from "lucide-react";

import { cn } from "@/lib/utils";
import { catalogImageUrl } from "@/lib/image-loader";
import type { BrandCategory } from "@/server/dal/brands";

/**
 * The brand page's category rail — Blinkit's left sidebar: a column of tinted
 * photo tiles with two-line names, the active one marked by a bar on its
 * edge. On phones it is a narrow sticky column beside the product grid; from
 * md: up the tiles become rows (photo + name) in a wider column.
 *
 * Order, photo and name per category are the owner's per-brand layout,
 * already applied by `listBrandCategories`. Plain links (no client JS): a tap
 * re-renders the page with `?cat=` and the rail simply stays put.
 */
export function BrandCategoryRail({
  brandSlug,
  categories,
  activeId,
  totalLabel,
}: {
  brandSlug: string;
  categories: BrandCategory[];
  /** The selected category, or null for "All". */
  activeId: string | null;
  /** e.g. "All boAt" — the first tile's label. */
  totalLabel: string;
}) {
  return (
    <nav
      aria-label="Categories in this brand"
      className="no-scrollbar sticky top-[6.75rem] max-h-[calc(100dvh-6.75rem-var(--md-tab-h,3.5rem)-1rem)] self-start overflow-y-auto border-r border-border/70 pr-0.5 md:top-20 md:max-h-[calc(100dvh-6rem)] md:pr-3"
    >
      <ul className="flex flex-col gap-1">
        <li>
          <RailItem href={`/b/${brandSlug}`} active={activeId === null} label={totalLabel} image={null} />
        </li>
        {categories.map((c) => (
          <li key={c.id}>
            <RailItem
              href={`/b/${brandSlug}?cat=${c.id}`}
              active={activeId === c.id}
              label={c.name}
              image={c.image}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function RailItem({
  href,
  active,
  label,
  image,
}: {
  href: string;
  active: boolean;
  label: string;
  image: string | null;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex flex-col items-center gap-1 rounded-xl px-0.5 py-1.5 text-center outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        "md:flex-row md:gap-3 md:px-2 md:text-left",
        active ? "bg-primary/[0.06]" : "hover:bg-muted/60",
      )}
    >
      {/* Blinkit's active marker: a bar on the rail's outer edge. */}
      <span
        aria-hidden
        className={cn(
          "absolute top-2 bottom-2 -right-0.5 w-1 rounded-l-full bg-primary transition-opacity md:-right-3",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <span className="md-tile flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={catalogImageUrl(image, 160)}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <LayoutGrid aria-hidden className="size-5 text-primary" />
        )}
      </span>
      <span
        className={cn(
          "line-clamp-2 text-[10px] leading-tight break-words md:text-sm",
          active ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
        )}
      >
        {label}
      </span>
    </Link>
  );
}
