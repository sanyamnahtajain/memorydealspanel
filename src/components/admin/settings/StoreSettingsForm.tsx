"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPaise, parseRupees } from "@/lib/money";
import { saveStoreSettingsAction } from "@/server/actions/store-settings";

/**
 * Ordering settings — currently the MINIMUM ORDER VALUE. The input is rupee
 * text ("5,000" / "5000.50"); it is parsed to integer paise client-side (via
 * lib/money, the same parser the product forms use) and validated again
 * server-side. Empty = no minimum.
 */
export function StoreSettingsForm({
  initialMinOrderValuePaise,
}: {
  initialMinOrderValuePaise: number | null;
}) {
  const [value, setValue] = React.useState(() =>
    initialMinOrderValuePaise != null
      ? String(initialMinOrderValuePaise / 100)
      : "",
  );
  const [saving, setSaving] = React.useState(false);

  const parsedPaise = React.useMemo(() => {
    if (value.trim() === "") return null;
    return parseRupees(value);
  }, [value]);
  const invalid = value.trim() !== "" && parsedPaise === null;

  async function handleSave() {
    if (saving || invalid) return;
    setSaving(true);
    try {
      const result = await saveStoreSettingsAction({
        minOrderValuePaise: parsedPaise,
      });
      if (result.ok) {
        toast.success(
          parsedPaise
            ? `Minimum order value set to ${formatPaise(parsedPaise)}.`
            : "Minimum order value removed.",
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
          htmlFor="minOrderValue"
          className="text-sm font-medium text-foreground"
        >
          Minimum order value (₹)
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">₹</span>
          <Input
            id="minOrderValue"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="No minimum"
            aria-invalid={invalid || undefined}
            className="max-w-45 font-tabular"
          />
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || invalid}
            aria-busy={saving || undefined}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
        {invalid ? (
          <p className="text-xs text-destructive">
            Enter a valid amount, e.g. 5000 or 5,000.50.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Customers cannot place an order below this cart value
            {parsedPaise ? ` (currently ${formatPaise(parsedPaise)})` : ""}.
            Leave empty for no minimum.
          </p>
        )}
      </div>
    </div>
  );
}
