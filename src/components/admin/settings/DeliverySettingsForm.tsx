"use client";

import * as React from "react";
import { toast } from "sonner";

import { parseRupees, formatPaise } from "@/lib/money";
import type { DeliveryRules } from "@/lib/delivery";
import { saveDeliveryRulesAction } from "@/server/actions/store-settings";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Delivery rules form (owner request): today one rule — the minimum delivery
 * charge always collected — plus an optional note. The disclosure appears on
 * the cart, order pages and the staff PDF the moment it's saved; placed
 * orders keep the copy they were placed with. Mirrors the other settings
 * forms (useState + useTransition + toast; master switch greys the rest).
 */
export function DeliverySettingsForm({ initial }: { initial: DeliveryRules }) {
  const initialMin =
    initial.rules.find((r) => r.kind === "minCharge")?.minChargePaise ?? 250_00;
  const [enabled, setEnabled] = React.useState(initial.enabled);
  const [amount, setAmount] = React.useState(String(initialMin / 100));
  const [note, setNote] = React.useState(initial.note ?? "");
  const [pending, startTransition] = React.useTransition();

  const parsedPaise = React.useMemo(() => {
    if (amount.trim() === "") return null;
    return parseRupees(amount);
  }, [amount]);
  const invalid = amount.trim() !== "" && parsedPaise === null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (enabled && (parsedPaise === null || parsedPaise <= 0)) {
      toast.error("Enter the minimum delivery charge in rupees (e.g. 250).");
      return;
    }
    startTransition(async () => {
      try {
        const res = await saveDeliveryRulesAction({
          enabled,
          rules: [{ kind: "minCharge", minChargePaise: parsedPaise ?? 250_00 }],
          note: note.trim() === "" ? null : note.trim(),
        });
        if (res.ok) toast.success("Delivery rules saved");
        else toast.error(res.error);
      } catch {
        toast.error("Could not save delivery rules.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Show a minimum delivery charge
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Customers see it on the cart, their orders, and the bill PDF.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label="Show a minimum delivery charge"
        />
      </div>

      <fieldset
        disabled={!enabled}
        className={cn(
          "space-y-4 transition-opacity",
          !enabled && "pointer-events-none opacity-50",
        )}
      >
        <div>
          <Label htmlFor="delivery-min">Minimum delivery charge</Label>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">₹</span>
            <Input
              id="delivery-min"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={invalid}
              className="max-w-32 font-tabular"
            />
            {parsedPaise !== null && !invalid ? (
              <span className="text-xs text-muted-foreground">
                Shown as “at least {formatPaise(parsedPaise)} extra”
              </span>
            ) : null}
          </div>
          {invalid ? (
            <p className="mt-1 text-xs text-destructive">
              Enter a rupee amount, e.g. 250.
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="delivery-note">Extra note (optional)</Label>
          <textarea
            id="delivery-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={300}
            placeholder="e.g. Delivery is free for orders above ₹50,000."
            className="mt-1.5 w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            The standard line always shows: final charge depends on parcel
            weight, size and PIN code.
          </p>
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save delivery rules"}
      </Button>
    </form>
  );
}
