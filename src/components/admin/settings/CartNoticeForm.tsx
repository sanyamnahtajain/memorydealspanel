"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { saveCartNoticeAction } from "@/server/actions/store-settings";

/** Mirrors MAX_CART_NOTICE_CHARS server-side (the server re-validates). */
const MAX_CHARS = 500;

/**
 * Cart notice — free-text copy shown under the cart's order summary. The
 * owner uses it for billing terms ("ERD, Portronics … prices are WITH GST
 * bill; the rest are without — message the WhatsApp group for a GST bill").
 * Empty clears it and the cart shows nothing.
 */
export function CartNoticeForm({ initial }: { initial: string | null }) {
  const [value, setValue] = React.useState(initial ?? "");
  const [saving, setSaving] = React.useState(false);
  const over = value.length > MAX_CHARS;

  async function handleSave() {
    if (saving || over) return;
    setSaving(true);
    try {
      const result = await saveCartNoticeAction({
        cartNotice: value.trim() === "" ? null : value,
      });
      if (result.ok) {
        toast.success(
          value.trim() === "" ? "Cart notice removed." : "Cart notice saved.",
        );
      } else {
        toast.error(result.error);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label
          htmlFor="cartNotice"
          className="text-sm font-medium text-foreground"
        >
          Notice under the cart total
        </label>
        <textarea
          id="cartNotice"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={4}
          placeholder={
            "e.g. ERD, Portronics, Digitek, Ambrane & Zebronics prices are " +
            "with GST bill. All other prices are without bill — if you need " +
            "a GST bill, please message us in your WhatsApp group."
          }
          aria-invalid={over || undefined}
          className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
        />
        <p
          className={
            over
              ? "text-xs font-medium text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {over
            ? `Too long — ${value.length}/${MAX_CHARS} characters.`
            : "Shown to every customer on the cart page, under the order summary. Leave empty to hide."}
        </p>
      </div>
      <Button
        type="button"
        onClick={handleSave}
        disabled={saving || over}
        aria-busy={saving || undefined}
      >
        {saving ? "Saving…" : "Save notice"}
      </Button>
    </div>
  );
}
