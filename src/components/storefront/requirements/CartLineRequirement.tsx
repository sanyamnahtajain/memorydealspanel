"use client";

import * as React from "react";
import { NotebookPen, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RequirementSheet } from "./RequirementSheet";

/**
 * CartLineRequirement — the cart-line view of a requirement note + photos:
 * a compact preview (first line of the note + thumbnail strip) with an
 * edit/add button opening the same RequirementSheet used on the PDP.
 */
export function CartLineRequirement({
  productId,
  variantId,
  productName,
  note,
  attachments,
  disabled = false,
  onSaved,
}: {
  productId: string;
  variantId: string | null;
  productName: string;
  note: string | null;
  attachments: { url: string }[];
  disabled?: boolean;
  onSaved: (note: string | null, attachments: { url: string }[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const hasContent = note !== null || attachments.length > 0;

  return (
    <div className="mt-2">
      {hasContent ? (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
          <div className="min-w-0 flex-1">
            {note ? (
              <p className="line-clamp-2 text-xs whitespace-pre-line text-muted-foreground">
                {note}
              </p>
            ) : null}
            {attachments.length > 0 ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                {attachments.slice(0, 4).map((a) => (
                  // Small stored thumbnails; next/image is off anyway.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={a.url}
                    src={a.url}
                    alt="Requirement photo"
                    loading="lazy"
                    className="size-9 rounded-md border border-border object-cover"
                  />
                ))}
                {attachments.length > 4 ? (
                  <span className="text-[0.7rem] text-muted-foreground">
                    +{attachments.length - 4}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 px-2 text-xs"
            disabled={disabled}
            onClick={() => setOpen(true)}
          >
            <Pencil aria-hidden className="size-3" />
            Edit
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-dashed"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <NotebookPen aria-hidden className="size-3.5" />
          Add note &amp; photos
        </Button>
      )}

      <RequirementSheet
        open={open}
        onOpenChange={setOpen}
        productId={productId}
        variantId={variantId}
        productName={productName}
        initialNote={note}
        initialAttachments={attachments}
        onSaved={onSaved}
      />
    </div>
  );
}
