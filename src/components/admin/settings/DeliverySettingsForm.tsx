"use client";

import * as React from "react";
import { toast } from "sonner";

import { parseRupees, formatPaise } from "@/lib/money";
import type { DeliveryRules } from "@/lib/delivery";
import { saveDeliveryRulesAction } from "@/server/actions/store-settings";
import { Plus, Trash2 } from "lucide-react";
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
/** A ladder row as typed: rupee strings, so a half-typed value is allowed. */
interface TierRow {
  /** Inclusive upper bound in rupees; "" means the open-ended top band. */
  upto: string;
  /** Charge in rupees. */
  charge: string;
}

/** The ladder a shop gets when it first turns banding on. */
const DEFAULT_LADDER: { uptoPaise: number | null; chargePaise: number }[] = [
  { uptoPaise: 10_000_00, chargePaise: 250_00 },
  { uptoPaise: 20_000_00, chargePaise: 350_00 },
  { uptoPaise: 50_000_00, chargePaise: 500_00 },
  { uptoPaise: 1_00_000_00, chargePaise: 750_00 },
  { uptoPaise: null, chargePaise: 1_000_00 },
];

function toRow(tier: { uptoPaise: number | null; chargePaise: number }): TierRow {
  return {
    upto: tier.uptoPaise === null ? "" : String(tier.uptoPaise / 100),
    charge: String(tier.chargePaise / 100),
  };
}

/** Row → stored tier, or null when the charge can't be read. */
function parseRow(row: TierRow): { uptoPaise: number | null; chargePaise: number } | null {
  const chargePaise = parseRupees(row.charge);
  if (chargePaise === null || chargePaise < 0) return null;
  if (row.upto.trim() === "") return { uptoPaise: null, chargePaise };
  const uptoPaise = parseRupees(row.upto);
  if (uptoPaise === null || uptoPaise <= 0) return null;
  return { uptoPaise, chargePaise };
}

export function DeliverySettingsForm({ initial }: { initial: DeliveryRules }) {
  const initialMin =
    initial.rules.find((r) => r.kind === "minCharge")?.minChargePaise ?? 250_00;
  const initialTiers =
    initial.rules.find((r) => r.kind === "valueTiers")?.tiers ?? null;

  const [enabled, setEnabled] = React.useState(initial.enabled);
  const [amount, setAmount] = React.useState(String(initialMin / 100));
  const [note, setNote] = React.useState(initial.note ?? "");
  /** Off ⇒ one flat charge; on ⇒ the value ladder below. */
  const [banded, setBanded] = React.useState(initialTiers !== null);
  const [rows, setRows] = React.useState<TierRow[]>(() =>
    initialTiers ? initialTiers.map(toRow) : DEFAULT_LADDER.map(toRow),
  );
  const [pending, startTransition] = React.useTransition();

  const parsedPaise = React.useMemo(() => {
    if (amount.trim() === "") return null;
    return parseRupees(amount);
  }, [amount]);
  const invalid = amount.trim() !== "" && parsedPaise === null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (enabled && !banded && (parsedPaise === null || parsedPaise <= 0)) {
      toast.error("Enter the minimum delivery charge in rupees (e.g. 250).");
      return;
    }
    let tiers: { uptoPaise: number | null; chargePaise: number }[] = [];
    if (enabled && banded) {
      const parsedRows = rows.map(parseRow);
      if (parsedRows.some((r) => r === null)) {
        toast.error("Every band needs an amount. Use a blank 'up to' for the top band.");
        return;
      }
      tiers = parsedRows as { uptoPaise: number | null; chargePaise: number }[];
      if (!tiers.some((t) => t.uptoPaise === null)) {
        // Without an open-ended band a very large order falls off the ladder.
        // The resolver copes (it charges the top band), but the admin should
        // decide that rather than discover it.
        toast.error(
          "Add a top band with an empty 'up to' so the biggest orders are covered.",
        );
        return;
      }
    }

    startTransition(async () => {
      try {
        const res = await saveDeliveryRulesAction({
          enabled,
          rules: banded
            ? [{ kind: "valueTiers", tiers }]
            : [{ kind: "minCharge", minChargePaise: parsedPaise ?? 250_00 }],
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
        {/* Flat charge vs a value ladder. Both are just rule kinds underneath
            (src/lib/delivery.ts), so switching costs nothing and a shop can
            move back. */}
        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-input px-3 py-2.5">
          <span className="min-w-0 space-y-0.5">
            <span className="block text-sm font-medium text-foreground">
              Charge by order value
            </span>
            <span className="block text-xs text-muted-foreground">
              Bigger orders pay more freight. Off, every order pays one flat
              minimum.
            </span>
          </span>
          <Switch
            checked={banded}
            onCheckedChange={setBanded}
            aria-label="Charge delivery by order value"
          />
        </label>

        {banded ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label>Bands</Label>
              <span className="text-xs text-muted-foreground">
                Order value up to → charge
              </span>
            </div>

            <ul className="space-y-2">
              {rows.map((row, index) => (
                <li key={index} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">up to ₹</span>
                  <Input
                    inputMode="decimal"
                    value={row.upto}
                    placeholder="any"
                    aria-label={`Band ${index + 1} upper limit in rupees`}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r, i) =>
                          i === index ? { ...r, upto: e.target.value } : r,
                        ),
                      )
                    }
                    className="max-w-28 font-tabular"
                  />
                  <span className="text-xs text-muted-foreground">pay ₹</span>
                  <Input
                    inputMode="decimal"
                    value={row.charge}
                    aria-label={`Band ${index + 1} delivery charge in rupees`}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r, i) =>
                          i === index ? { ...r, charge: e.target.value } : r,
                        ),
                      )
                    }
                    className="max-w-28 font-tabular"
                  />
                  <button
                    type="button"
                    aria-label={`Remove band ${index + 1}`}
                    disabled={rows.length <= 1}
                    onClick={() =>
                      setRows((prev) => prev.filter((_, i) => i !== index))
                    }
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((prev) => [...prev, { upto: "", charge: "" }])
              }
            >
              <Plus className="size-4" aria-hidden />
              Add band
            </Button>

            <p className="text-xs text-muted-foreground">
              Limits are inclusive — an order of exactly ₹10,000 pays the “up to
              ₹10,000” band. Leave one band’s limit blank: that is the top band,
              charged on everything above the rest. Order matters not at all;
              they are sorted when applied.
            </p>
          </div>
        ) : null}

        <div className={cn(banded && "hidden")}>
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
