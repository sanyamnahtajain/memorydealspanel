import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * BrandBadge — a small, public brand chip that links to the brand landing page
 * at `/b/[slug]`. Carries NO pricing (brand data is public), so it is safe to
 * render on any card or detail surface regardless of the viewer's price access.
 *
 * Two visual weights:
 *  - `size="sm"` (default): a compact uppercase label, optionally with a tiny
 *    logo mark — sits on product cards under the image.
 *  - `size="md"`: a padded pill with a border, for the product detail header.
 *
 * When `href` linking is undesirable (e.g. inside another interactive element),
 * pass `asLink={false}` to render a plain inline chip instead of an anchor.
 */

export interface BrandBadgeProps {
  /** Brand display name (shown as the label). */
  name: string;
  /** Brand slug — the badge links to `/b/[slug]`. */
  slug: string;
  /** Optional square logo mark URL. */
  logo?: string | null;
  /** Visual weight. Defaults to "sm". */
  size?: "sm" | "md";
  /** Render as a link to the brand page (default) or a plain chip. */
  asLink?: boolean;
  /** Extra classes for layout tweaks at the call site. */
  className?: string;
}

const LOGO_PX = { sm: 14, md: 18 } as const;

export function BrandBadge({
  name,
  slug,
  logo,
  size = "sm",
  asLink = true,
  className,
}: BrandBadgeProps) {
  const px = LOGO_PX[size];

  const inner = (
    <>
      {logo ? (
        <span
          className="relative shrink-0 overflow-hidden rounded-[3px] bg-white"
          style={{ width: px, height: px }}
        >
          <Image
            src={logo}
            alt=""
            fill
            sizes={`${px}px`}
            className="object-contain"
            aria-hidden
          />
        </span>
      ) : null}
      <span className="truncate">{name}</span>
    </>
  );

  const base =
    "inline-flex max-w-full items-center gap-1.5 font-medium tracking-wide uppercase";

  if (size === "md") {
    const chip =
      "rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground";
    if (!asLink) {
      return (
        <span className={cn(base, chip, className)} title={name}>
          {inner}
        </span>
      );
    }
    return (
      <Link
        href={`/b/${slug}`}
        title={`Browse ${name}`}
        className={cn(
          base,
          chip,
          "outline-none transition-colors hover:border-primary/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        {inner}
      </Link>
    );
  }

  // size === "sm"
  const sm = "text-[0.7rem] text-muted-foreground";
  if (!asLink) {
    return (
      <span className={cn(base, sm, className)} title={name}>
        {inner}
      </span>
    );
  }
  return (
    <Link
      href={`/b/${slug}`}
      title={`Browse ${name}`}
      className={cn(
        base,
        sm,
        "rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {inner}
    </Link>
  );
}
