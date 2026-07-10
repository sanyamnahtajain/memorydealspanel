"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import type { EntityStatus } from "@/lib/schemas/shared";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ConfirmSheet } from "@/components/common";
import { useIsMobile } from "@/components/common";
import {
  duplicateProductAction,
  setProductStatusAction,
  softDeleteProductAction,
} from "@/server/actions/products";

export interface ProductRowActionsProps {
  productId: string;
  productName: string;
  status: EntityStatus;
}

/**
 * Per-row actions for the products table: Edit, Duplicate, Toggle active and
 * Delete (behind a ConfirmSheet). Desktop shows inline icon buttons; mobile
 * folds them into a bottom sheet behind a "More" trigger to keep rows tappable.
 * Each mutation calls its server action and toasts the outcome.
 */
export function ProductRowActions({
  productId,
  productName,
  status,
}: ProductRowActionsProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [busy, setBusy] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);

  const isActive = status === "ACTIVE";

  const run = React.useCallback(
    async (
      fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
      successMsg: string,
    ) => {
      setBusy(true);
      try {
        const result = await fn();
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(successMsg);
        router.refresh();
      } catch {
        toast.error("Something went wrong. Please try again.");
      } finally {
        setBusy(false);
        setMoreOpen(false);
      }
    },
    [router],
  );

  const onEdit = () => router.push(`/admin/products/${productId}`);

  const onDuplicate = () =>
    run(() => duplicateProductAction(productId), "Duplicated to a draft");

  const onToggle = () =>
    run(
      () =>
        setProductStatusAction(productId, isActive ? "INACTIVE" : "ACTIVE"),
      isActive ? "Product hidden" : "Product published",
    );

  const onDelete = () =>
    run(() => softDeleteProductAction(productId), "Moved to Trash");

  const deleteConfirm = (
    <ConfirmSheet
      title="Move to Trash?"
      description={`“${productName}” will be hidden from the catalog. You can restore it from Trash.`}
      confirmLabel="Move to Trash"
      destructive
      onConfirm={onDelete}
      trigger={
        <Button
          variant="ghost"
          size={isMobile ? "sm" : "icon-sm"}
          disabled={busy}
          aria-label="Delete product"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon aria-hidden />
          {isMobile ? "Move to Trash" : null}
        </Button>
      }
    />
  );

  if (isMobile) {
    return (
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${productName}`}
              className="text-muted-foreground"
            >
              <MoreHorizontalIcon aria-hidden />
            </Button>
          }
        />
        <SheetContent side="bottom" className="rounded-t-2xl pb-safe">
          <div
            aria-hidden
            className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted"
          />
          <SheetHeader>
            <SheetTitle className="truncate">{productName}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-1 p-3">
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={onEdit}
            >
              <PencilIcon aria-hidden />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={busy}
              onClick={onDuplicate}
            >
              <CopyIcon aria-hidden />
              Duplicate
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={busy}
              onClick={onToggle}
            >
              {isActive ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
              {isActive ? "Hide from catalog" : "Publish"}
            </Button>
            {deleteConfirm}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Edit product"
        disabled={busy}
        onClick={onEdit}
        className="text-muted-foreground hover:text-foreground"
      >
        <PencilIcon aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Duplicate product"
        disabled={busy}
        onClick={onDuplicate}
        className="text-muted-foreground hover:text-foreground"
      >
        <CopyIcon aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={isActive ? "Hide from catalog" : "Publish product"}
        disabled={busy}
        onClick={onToggle}
        className="text-muted-foreground hover:text-foreground"
      >
        {isActive ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
      </Button>
      {deleteConfirm}
    </div>
  );
}
