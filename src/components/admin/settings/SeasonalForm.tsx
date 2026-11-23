"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { saveSeasonalAction } from "@/server/actions/store-settings";
import {
  resolveSeason,
  WINTER_WINDOW,
  type SeasonalSettings,
  type SeasonMode,
  type SnowLevel,
} from "@/lib/seasonal";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const windowLabel = `${WINTER_WINDOW.from.day} ${MONTHS[WINTER_WINDOW.from.month - 1]} – ${WINTER_WINDOW.until.day} ${MONTHS[WINTER_WINDOW.until.month - 1]}`;

/**
 * Seasonal look (owner switch). Purely decorative — snow behind the content,
 * snow on the header, a hat on the logo — so it saves without a confirm, and
 * shows plainly whether it is showing right now.
 */
export function SeasonalForm({ initial }: { initial: SeasonalSettings }) {
  const router = useRouter();
  const [value, setValue] = React.useState<SeasonalSettings>(initial);
  const [saving, setSaving] = React.useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  const live = resolveSeason(value).winter;

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await saveSeasonalAction(value);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(live ? "Winter look is on — refresh any open page to see it." : "Seasonal look is off.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <p
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
          live
            ? "border-sky-300/60 bg-sky-50 text-sky-800 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200"
            : "border-border bg-muted text-muted-foreground",
        )}
        role="status"
      >
        <span aria-hidden>{live ? "❄" : "○"}</span>
        {live ? "Showing now on the shop" : "Not showing right now"}
      </p>

      <Choice<SeasonMode>
        label="When"
        value={value.mode}
        onChange={(mode) => setValue((v) => ({ ...v, mode }))}
        options={[
          { value: "auto", label: "Auto", hint: `Every year, ${windowLabel}` },
          { value: "on", label: "On", hint: "From now until you switch it off" },
          { value: "off", label: "Off", hint: "No seasonal touches" },
        ]}
      />

      <Choice<SnowLevel>
        label="Snowfall"
        value={value.snow}
        onChange={(snow) => setValue((v) => ({ ...v, snow }))}
        options={[
          { value: "light", label: "Light", hint: "A few flakes (best for phones)" },
          { value: "normal", label: "Normal", hint: "More flakes on big screens" },
          { value: "off", label: "No snowfall", hint: "Keep only the snow on edges" },
        ]}
      />

      <div className="space-y-3">
        <Toggle
          id="seasonal-christmas"
          label="Christmas touches"
          hint="Santa hat on the logo, twinkling lights under the header, and now and then Santa&rsquo;s sleigh or cart passing by."
          checked={value.christmas}
          onChange={(christmas) => setValue((v) => ({ ...v, christmas }))}
        />
        <Toggle
          id="seasonal-sounds"
          label="Sound effects"
          hint="Soft sleigh bells when Santa&rsquo;s sleigh flies by — once per visit, and only after the visitor has tapped something."
          checked={value.sounds}
          onChange={(sounds) => setValue((v) => ({ ...v, sounds }))}
        />
        <Toggle
          id="seasonal-admin"
          label="Also in this admin panel"
          hint="Lighter snowfall here. Turn off if it distracts staff."
          checked={value.admin}
          onChange={(admin) => setValue((v) => ({ ...v, admin }))}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Snow always falls behind the products and buttons, never on top — it can&rsquo;t get in the way of an
        order. People who turn on “reduce motion” or Data Saver on their phone see no snowfall.
      </p>

      <div className="flex justify-end">
        <Button onClick={save} disabled={!dirty} loading={saving}>
          Save
        </Button>
      </div>
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; hint: string }[];
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-foreground">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted",
              )}
            >
              <span className="block text-sm font-semibold text-foreground">{o.label}</span>
              <span className="block text-xs text-muted-foreground">{o.hint}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
      <label htmlFor={id} className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
