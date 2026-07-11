import { Boxes, LayoutGrid, Tag, ShieldCheck } from "lucide-react";

/**
 * A compact credibility strip under the hero: catalogue size at a glance.
 * Counts are plain integers (no pricing) — safe on the ISR home shell.
 */
export function StatsBar({
  products,
  brands,
  categories,
}: {
  products: number;
  brands: number;
  categories: number;
}) {
  const stats = [
    { icon: Boxes, value: `${products}+`, label: "Products" },
    { icon: Tag, value: `${brands}`, label: "Brands" },
    { icon: LayoutGrid, value: `${categories}`, label: "Categories" },
    { icon: ShieldCheck, value: "Trade", label: "Prices on approval" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <s.icon className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block font-heading text-lg font-bold tabular-nums text-foreground">
              {s.value}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {s.label}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
