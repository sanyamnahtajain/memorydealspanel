"use client";

/**
 * OrderPdfDownloadButton — the admin "Download PDF" action, upgraded to ASK for
 * the paper size (A4 / A5) before downloading (owner request). One dropdown,
 * two real download links: each item is an `<a download>` to the admin-gated
 * `/api/order-pdf/[id]?size=…` route, so the server renders the chosen sheet
 * and the browser saves it.
 *
 * Built on the design-system Menu primitive (never a native <select>), so it
 * carries the app's popup styling, keyboard navigation and focus ring.
 */

import { Menu } from "@base-ui/react/menu";
import { DownloadIcon, ChevronDownIcon } from "lucide-react";

import { ORDER_PDF_SIZES, ORDER_PDF_SIZE_LABELS } from "@/lib/order-pdf-size";

export function OrderPdfDownloadButton({ orderId }: { orderId: string }) {
  return (
    <Menu.Root>
      <Menu.Trigger className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background px-3.5 text-sm font-medium shadow-xs transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground">
        <DownloadIcon className="size-4" aria-hidden />
        Download PDF
        <ChevronDownIcon className="size-4 opacity-70" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="isolate z-50">
          <Menu.Popup className="min-w-44 origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Choose paper size
            </div>
            {ORDER_PDF_SIZES.map((size) => (
              <Menu.Item
                key={size}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                render={
                  <a href={`/api/order-pdf/${orderId}?size=${size}`} download>
                    <DownloadIcon className="size-4 text-muted-foreground" aria-hidden />
                    {ORDER_PDF_SIZE_LABELS[size]}
                  </a>
                }
              />
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
