"use client";

import * as React from "react";
import { toast } from "sonner";

import {
  SLABY_PLACEMENTS,
  SLABY_PLACEMENT_LABELS,
  type SlabyBrandingConfig,
  type SlabyPlacement,
} from "@/lib/slaby/branding";
import { saveSlabyBrandingAction } from "@/server/actions/store-settings";
import { SlabyWordmark } from "@/components/slaby/SlabyMark";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Admin form for the "Built with Slaby" branding: one master switch, a
 * per-placement toggle each, and the promo-card frequency. Mirrors the
 * TaxSettingsForm mechanics (useState + useTransition + toast; the master
 * switch greys out the rest, fieldset-style).
 */
export function SlabyBrandingForm({ initial }: { initial: SlabyBrandingConfig }) {
  const [enabled, setEnabled] = React.useState(initial.enabled);
  const [placements, setPlacements] = React.useState(initial.placements);
  const [frequency, setFrequency] = React.useState(String(initial.promoFrequencyDays));
  const [pending, startTransition] = React.useTransition();

  const days = Number(frequency);
  const frequencyInvalid = !Number.isInteger(days) || days < 1 || days > 365;

  function toggle(placement: SlabyPlacement, on: boolean) {
    setPlacements((prev) => ({ ...prev, [placement]: on }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (frequencyInvalid) {
      toast.error("Promo frequency must be between 1 and 365 days.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await saveSlabyBrandingAction({
          enabled,
          placements,
          promoFrequencyDays: days,
        });
        if (res.ok) toast.success("Slaby branding saved");
        else toast.error(res.error);
      } catch {
        toast.error("Could not save Slaby branding.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            Show <SlabyWordmark className="h-4" /> branding
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Quiet “Built with Slaby” badges on the storefront. Nothing shows
            anywhere while this is off.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label="Show Slaby branding"
        />
      </div>

      <fieldset
        disabled={!enabled}
        className={cn(
          "space-y-4 transition-opacity",
          !enabled && "pointer-events-none opacity-50",
        )}
      >
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {SLABY_PLACEMENTS.map((placement) => (
              <li key={placement} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {SLABY_PLACEMENT_LABELS[placement].label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {SLABY_PLACEMENT_LABELS[placement].hint}
                  </p>
                </div>
                <Switch
                  checked={placements[placement]}
                  onCheckedChange={(on) => toggle(placement, on)}
                  aria-label={SLABY_PLACEMENT_LABELS[placement].label}
                />
              </li>
            ))}
          </ul>
        </div>

        <div className="max-w-xs">
          <Label htmlFor="slaby-frequency">Promo card frequency (days)</Label>
          <Input
            id="slaby-frequency"
            type="number"
            min={1}
            max={365}
            value={frequency}
            onChange={(event) => setFrequency(event.target.value)}
            aria-invalid={frequencyInvalid}
            className="mt-1.5 max-w-28 font-tabular"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            A visitor sees the promo card at most once every this many days.
          </p>
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save Slaby branding"}
      </Button>
    </form>
  );
}
