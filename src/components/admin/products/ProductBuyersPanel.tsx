import Link from "next/link";
import { ArrowUpRight, Megaphone, MessageCircle, ShoppingBag } from "lucide-react";

import { APP_NAME } from "@/lib/constants";
import { buildWhatsAppLink, followUpMessageLines } from "@/lib/whatsapp-link";
import { productBuyers } from "@/server/services/product-buyers";
import { EmptyState, StatusChip, type StatusChipVariant } from "@/components/common";
import { CopyPhonesButton } from "./CopyPhonesButton";

const numberFmt = new Intl.NumberFormat("en-IN");
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

/**
 * "Who bought this?" — the follow-up panel on the admin product page.
 *
 * One row per shop that ordered the product (cancelled orders excluded),
 * newest purchase first: units, orders, last order, and a WhatsApp button
 * pre-filled with a short follow-up note (restock, new rate — the admin adds
 * the detail). The header offers the three bulk moves: the orders queue
 * filtered to this product, a push notification to every buyer, and the
 * phone numbers copied for a WhatsApp broadcast list.
 *
 * Admin-only by placement (the product page is already gated); the panel
 * itself streams in behind a skeleton so it never delays the editor.
 */
export async function ProductBuyersPanel({
  productId,
  productName,
  sku,
}: {
  productId: string;
  productName: string;
  sku: string;
}) {
  const { buyers, orders, units } = await productBuyers(productId, 50);

  return (
    <section
      aria-labelledby="product-buyers-heading"
      className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-5"
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="product-buyers-heading" className="font-heading text-base font-semibold tracking-tight text-foreground">
            Buyers
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {buyers.length === 0
              ? "No shop has ordered this product yet."
              : `${numberFmt.format(buyers.length)} ${buyers.length === 1 ? "shop" : "shops"} · ${numberFmt.format(orders)} ${orders === 1 ? "order" : "orders"} · ${numberFmt.format(units)} pcs, newest first.`}
          </p>
        </div>
        {buyers.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/orders?product=${productId}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ShoppingBag aria-hidden className="size-3.5" />
              Orders
            </Link>
            <Link
              href={`/admin/notifications?product=${productId}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Megaphone aria-hidden className="size-3.5" />
              Notify buyers
            </Link>
            <CopyPhonesButton phones={buyers.map((b) => b.phone)} />
          </div>
        ) : null}
      </header>

      {buyers.length === 0 ? (
        <EmptyState
          illustration="empty-box"
          title="No buyers yet"
          description="Once a shop orders this product, it shows up here with a one-tap WhatsApp follow-up."
          className="py-6"
        />
      ) : (
        <ul className="mt-4 divide-y divide-border/60">
          {buyers.map((b) => {
            const href = buildWhatsAppLink(
              b.phone,
              followUpMessageLines({ appName: APP_NAME, contactName: b.contactName || b.businessName, productName, sku }),
            );
            return (
              <li key={b.customerId} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/admin/customers/${b.customerId}`}
                      className="truncate text-sm font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {b.businessName}
                    </Link>
                    {b.status !== "APPROVED" ? (
                      <StatusChip variant={b.status.toLowerCase() as StatusChipVariant} label={b.status.charAt(0) + b.status.slice(1).toLowerCase()} />
                    ) : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
                    {[b.contactName, b.city].filter(Boolean).join(" · ")}
                    {" · "}
                    <span className="font-tabular">{numberFmt.format(b.units)} pcs</span>
                    {" in "}
                    <span className="font-tabular">{numberFmt.format(b.orders)} {b.orders === 1 ? "order" : "orders"}</span>
                    {" · last "}
                    <time dateTime={b.lastOrderAt.toISOString()}>{dateFmt.format(b.lastOrderAt)}</time>
                    {b.lastOrderNumber ? ` (#${b.lastOrderNumber})` : ""}
                  </p>
                </div>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`WhatsApp ${b.businessName} about ${productName}`}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[#25D366]/15 text-[#128C7E] outline-none transition-colors hover:bg-[#25D366]/25 focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-[#25D366]"
                >
                  <MessageCircle aria-hidden className="size-4" />
                </a>
                <Link
                  href={`/admin/orders?product=${productId}&q=${encodeURIComponent(b.phone)}`}
                  aria-label={`Orders by ${b.businessName} containing ${productName}`}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <ArrowUpRight aria-hidden className="size-4" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ProductBuyersPanelSkeleton() {
  return (
    <section aria-hidden className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="h-4 w-20 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-3 w-56 animate-pulse rounded bg-muted" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-40 animate-pulse rounded bg-muted" />
              <div className="h-3 w-64 animate-pulse rounded bg-muted" />
            </div>
            <div className="size-9 animate-pulse rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </section>
  );
}
