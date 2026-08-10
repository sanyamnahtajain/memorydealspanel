"use client";

import * as React from "react";
import { NotebookPen } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CART_LINE_ADDED_EVENT,
  type CartLineAddedDetail,
} from "@/components/storefront/cart/cart-events";
import { RequirementSheet } from "./RequirementSheet";

/**
 * RequirementPrompt — the PDP affordance for products that accept requirement
 * notes & photos. Two jobs:
 *
 *  1. A visible card ("Have a long model list? …") that opens the sheet.
 *  2. Auto-open: when THIS product is added to the cart (cart-events bus),
 *     the sheet slides up by itself — the app-like moment where the customer
 *     photographs their handwritten list right after adding.
 *
 * Saving requires the line in the cart; the server action answers with a
 * friendly "add it first" message otherwise, so the card is safe to show
 * before the add too.
 */
export function RequirementPrompt({
  productId,
  productName,
  canAdd,
  initialNote = null,
  initialAttachments = [],
}: {
  productId: string;
  productName: string;
  /** Approved customers only — a gated viewer can't have a cart line. */
  canAdd: boolean;
  /** Stored values from an existing cart line, so edits never start blank. */
  initialNote?: string | null;
  initialAttachments?: { url: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [saved, setSaved] = React.useState<{
    note: string | null;
    attachments: { url: string }[];
  }>({ note: initialNote, attachments: initialAttachments });

  React.useEffect(() => {
    if (!canAdd) return;
    function onAdded(event: Event) {
      const detail = (event as CustomEvent<CartLineAddedDetail>).detail;
      if (detail?.productId === productId) setOpen(true);
    }
    window.addEventListener(CART_LINE_ADDED_EVENT, onAdded);
    return () => window.removeEventListener(CART_LINE_ADDED_EVENT, onAdded);
  }, [canAdd, productId]);

  if (!canAdd) return null;

  const hasContent = saved.note !== null || saved.attachments.length > 0;

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <NotebookPen
            aria-hidden
            className="size-4.5 shrink-0 text-muted-foreground"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {hasContent
              ? "Requirement attached to your cart item."
              : "Long model list? Write it or snap a photo — we prepare your order from it."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 pointer-coarse:min-h-10"
          onClick={() => setOpen(true)}
        >
          {hasContent ? "Edit" : "Add note"}
        </Button>
      </div>

      <RequirementSheet
        open={open}
        onOpenChange={setOpen}
        productId={productId}
        productName={productName}
        initialNote={saved.note}
        initialAttachments={saved.attachments}
        onSaved={(note, attachments) => setSaved({ note, attachments })}
      />
    </>
  );
}
