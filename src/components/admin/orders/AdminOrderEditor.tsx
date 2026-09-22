"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PencilLine } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { orderNotEditableReason } from "@/lib/order-edits";
import {
  applyOrderEditAction,
  previewOrderEditAction,
  searchProductsForOrderEditAction,
  type OrderDetailDTO,
} from "@/server/actions/admin-orders";
import { OrderEditor } from "@/components/orders/edit/OrderEditor";

/**
 * "Edit order" for staff: a dialog around the shared OrderEditor, wired to
 * the admin actions. Staff always see money; the reason field is theirs.
 */
export function AdminOrderEditor({ order }: { order: OrderDetailDTO }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const blocked = orderNotEditableReason(order.status, "admin");

  const preview = React.useCallback(
    (input: Parameters<typeof previewOrderEditAction>[1]) => previewOrderEditAction(order.id, input),
    [order.id],
  );
  const save = React.useCallback(
    (input: Parameters<typeof applyOrderEditAction>[1]) => applyOrderEditAction(order.id, input),
    [order.id],
  );

  const trigger = (
    <Button type="button" variant="outline" size="sm" disabled={!!blocked} onClick={() => setOpen(true)}>
      <PencilLine className="size-4" aria-hidden />
      Edit order
    </Button>
  );

  return (
    <>
      {blocked ? <Tooltip content={blocked}><span className="inline-flex">{trigger}</span></Tooltip> : trigger}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit order #{order.orderNumber}</DialogTitle>
          </DialogHeader>
          {open ? (
            <OrderEditor
              key={order.version}
              orderNumber={order.orderNumber}
              version={order.version}
              priced
              mode="admin"
              initialLines={order.items.map((l) => ({
                productId: l.productId,
                variantId: l.variantId,
                name: l.name,
                sku: l.sku,
                brand: l.brand,
                variantLabel: l.variantLabel,
                imageUrl: l.imageUrl,
                quantity: l.quantity,
                breakdown: l.breakdown,
              }))}
              initialNote={order.note}
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
