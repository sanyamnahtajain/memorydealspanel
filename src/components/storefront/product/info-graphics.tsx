import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Small inline SVG glyphs for the product page's info rows, drawn in the
 * house illustration style (see src/components/common/EmptyState.tsx):
 * theme-token strokes (`stroke-muted-foreground`) with a single
 * `stroke-primary` accent per glyph. All are decorative (`aria-hidden`);
 * the text beside them carries the meaning.
 *
 * This module is server-safe (no hooks, no "use client") so the server page
 * AND client components (VariantSelector) can both render the same glyphs.
 * It carries no pricing.
 */

type IconProps = React.SVGProps<SVGSVGElement>;

function baseProps(props: IconProps): IconProps {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true,
    ...props,
  };
}

/** Carton box — minimum order quantity. */
export function BoxGlyph(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        d="M4.5 8.4 12 4.2l7.5 4.2v7.2L12 19.8l-7.5-4.2V8.4Z"
        className="stroke-muted-foreground"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 8.4 12 12.6l7.5-4.2M12 12.6v7.2"
        className="stroke-muted-foreground"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m8.2 6.3 7.6 4.2"
        className="stroke-primary"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Layered sheets — pack size / sold-in-packs. */
export function LayersGlyph(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        d="M12 3.8 4.4 7.6 12 11.4l7.6-3.8L12 3.8Z"
        className="stroke-muted-foreground"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m4.4 12.2 7.6 3.8 7.6-3.8"
        className="stroke-muted-foreground"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m4.4 16.4 7.6 3.8 7.6-3.8"
        className="stroke-primary"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Delivery truck — the delivery-charge note. */
export function TruckGlyph(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        d="M4 7h9.5v9H6.8M4 16h-.5"
        className="stroke-muted-foreground"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 10h3.6l3.4 3.2V16h-2"
        className="stroke-muted-foreground"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="8.7"
        cy="16.6"
        r="1.9"
        className="fill-card stroke-muted-foreground"
        strokeWidth="1.6"
      />
      <circle
        cx="16.6"
        cy="16.6"
        r="1.9"
        className="fill-card stroke-muted-foreground"
        strokeWidth="1.6"
      />
      <path
        d="M1.5 9.5h1.8M1 12.2h2.3"
        className="stroke-primary"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Shield with a tick — verified wholesale buyers. */
export function ShieldTickGlyph(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        d="M12 3.4 5.2 5.9v5c0 4.3 2.8 7.4 6.8 8.7 4-1.3 6.8-4.4 6.8-8.7v-5L12 3.4Z"
        className="stroke-muted-foreground"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m9.1 11.7 2.1 2.1 3.7-4"
        className="stroke-primary"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Zig-bottom receipt — GST invoice with every order. */
export function ReceiptGlyph(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        d="M7 3.5h10v16.4l-1.7-1.2-1.6 1.2-1.7-1.2-1.7 1.2-1.6-1.2L7 19.9V3.5Z"
        className="stroke-muted-foreground"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M10 8h4.5M10 11.5h4.5"
        className="stroke-primary"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Document with folded corner — clean wholesale billing. */
export function BillGlyph(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path
        d="M6.5 3.5H14l4 4v13H6.5v-17Z"
        className="stroke-muted-foreground"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14 3.5v4h4"
        className="stroke-muted-foreground"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 12h5M9.5 15.5h5"
        className="stroke-primary"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* InfoPill — a small labelled pill for MOQ / pack facts               */
/* ------------------------------------------------------------------ */

export interface InfoPillProps {
  /** One of the glyphs above (decorative). */
  icon: React.ReactNode;
  /** Quiet label, e.g. "Min. order". */
  label: string;
  /** The fact itself, e.g. "10 units". */
  value: string;
  className?: string;
}

/** A quiet labelled pill: glyph + label + value. Price-free by construction. */
export function InfoPill({ icon, label, value, className }: InfoPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 py-1.5 pr-3 pl-2",
        className,
      )}
    >
      <span aria-hidden className="shrink-0 [&_svg]:size-4">
        {icon}
      </span>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold text-foreground tabular-nums">
        {value}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* TrustRow — quiet reassurance chips near the CTA                     */
/* ------------------------------------------------------------------ */

export interface TrustRowProps {
  /**
   * Whether the shop's GST profile is enabled — the "GST invoice" chip only
   * renders when it is TRUE of this shop. Never invent claims here.
   */
  gstInvoice: boolean;
  className?: string;
}

/**
 * The reassurance row under the primary CTA. Every claim here is true of
 * this shop today: buyers are approved before they can order (the access
 * gate), billing is wholesale, and — when GST is on — orders carry a GST
 * invoice. Do NOT add warranty/returns claims the shop does not make.
 */
export function TrustRow({ gstInvoice, className }: TrustRowProps) {
  const items: Array<{ icon: React.ReactNode; label: string }> = [
    { icon: <ShieldTickGlyph />, label: "Approved shops only" },
    { icon: <BillGlyph />, label: "Wholesale billing" },
  ];
  if (gstInvoice) {
    items.push({ icon: <ReceiptGlyph />, label: "GST invoice" });
  }
  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-3.5",
        className,
      )}
    >
      {items.map((item) => (
        <li
          key={item.label}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
        >
          <span aria-hidden className="shrink-0 [&_svg]:size-4">
            {item.icon}
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
