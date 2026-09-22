"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PencilLine } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  editOrderAction,
  previewOrderEditAction,
  searchProductsForOrderEditAction,
} from "@/app/(storefront)/account/orders/actions";
import { OrderEditor } from "@/components/orders/edit/OrderEditor";
import type { OrderHistoryDetail } from "./types";

/**
 * "Edit order" for the buyer — offered only while the order is still PLACED
 * (the parent decides; this just renders). Money shows only when the viewer
 * is priced: the server strips it otherwise, and the editor renders "—".
 */
export function CustomerOrderEditor({ detail }: { detail: OrderHistoryDetail }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const preview = React.useCallback(
    (input: Parameters<typeof previewOrderEditAction>[1]) =>
      previewOrderEditAction(detail.orderNumber, input),
    [detail.orderNumber],
  );
  const save = React.useCallback(
    (input: Parameters<typeof editOrderAction>[1]) => editOrderAction(detail.orderNumber, input),
    [detail.orderNumber],
  );

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <PencilLine aria-hidden />
        Edit order
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit order #{detail.orderNumber}</DialogTitle>
          </DialogHeader>
          {open ? (
            <OrderEditor
              key={detail.version}
              orderNumber={detail.orderNumber}
              version={detail.version}
              priced={detail.priced}
              mode="customer"
              initialLines={detail.items.map((l) => ({
                productId: l.productId,
                variantId: l.variantId,
                name: l.name,
                sku: l.sku,
                brand: l.brand,
                variantLabel: l.variantLabel,
                imageUrl: l.imageUrl,
                quantity: l.quantity,
                breakdown: l.breakdown ?? null,
              }))}
              initialNote={detail.note}
              preview={preview}
              save={save}
              search={searchProductsForOrderEditAction}
              onCancel={() => setOpen(false)}
              onSaved={(summary) => {
                setOpen(false);
                toast.success(`Order updated — ${summary}`);
                router.refresh();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
