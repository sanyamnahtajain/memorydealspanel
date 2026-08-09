"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { clampQuantity } from "@/lib/quantity";
import { updateCartQuantityAction } from "@/server/actions/cart";
import { broadcastCartCount } from "@/components/storefront/cart/CartBadge";
import {
  ModelAllocationBuilder,
  type AllocationRow,
} from "./ModelAllocationBuilder";

/**
 * EditBreakdownSheet — "Edit models" on an allocation cart line. Opens the
 * builder pre-filled with the stored split; saving REPLACES the whole split
 * (the server rule: a bare quantity write is refused for these lines).
 */
export function EditBreakdownSheet({
  productId,
  variantId,
  moq,
  packMultiple,
  initial,
  disabled = false,
  onSaved,
}: {
  productId: string;
  variantId: string | null;
  moq: number;
  packMultiple: number;
  initial: AllocationRow[];
  disabled?: boolean;
  /** Reconcile the parent's optimistic state with the server's quantity. */
  onSaved: (quantity: number, rows: AllocationRow[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<AllocationRow[]>(initial);
  const [saving, setSaving] = React.useState(false);

  // Re-seed from the line whenever the sheet opens.
  function handleOpenChange(next: boolean) {
    if (next) setRows(initial);
    setOpen(next);
  }

  const total = rows.reduce((acc, r) => acc + r.qty, 0);
  const ready =
    total > 0 && clampQuantity(total, moq, packMultiple) === total && !saving;

  async function handleSave() {
    if (!ready) return;
    setSaving(true);
    try {
      const result = await updateCartQuantityAction({
        productId,
        ...(variantId ? { variantId } : {}),
        quantity: total,
        breakdown: rows.map((r) => ({ modelId: r.modelId, qty: r.qty })),
      });
      if (result.ok) {
        broadcastCartCount(result.itemCount);
        onSaved(result.quantity, rows);
        setOpen(false);
        toast.success("Model split updated.");
      } else {
        toast.error(result.message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            className="h-8 gap-1.5"
          />
        }
      >
        <Pencil aria-hidden className="size-3.5" />
        Edit models
      </SheetTrigger>
      <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-2xl p-4">
        <SheetHeader className="p-0 pb-3">
          <SheetTitle>Edit model split</SheetTitle>
          <SheetDescription>
            Adjust the quantity per model — the line total follows the split.
          </SheetDescription>
        </SheetHeader>
        <ModelAllocationBuilder
          value={rows}
          onChange={setRows}
          productId={productId}
          moq={moq}
          packMultiple={packMultiple}
          disabled={saving}
        />
        <Button
          type="button"
          className="mt-3 w-full"
          disabled={!ready}
          aria-busy={saving || undefined}
          onClick={handleSave}
        >
          {saving ? "Saving…" : `Save split (${total} units)`}
        </Button>
      </SheetContent>
    </Sheet>
  );
}
