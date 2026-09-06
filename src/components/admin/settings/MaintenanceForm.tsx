"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { saveMaintenanceAction } from "@/server/actions/store-settings";
import { MAX_MAINTENANCE_MESSAGE_CHARS } from "@/lib/maintenance";

/**
 * Maintenance mode. Takes the STOREFRONT down; this console stays reachable
 * so the switch can always be flipped back (see src/lib/maintenance.ts).
 *
 * The confirm step is deliberate: every other toggle here is reversible in
 * private, this one is visible to every customer the instant it lands.
 */
export function MaintenanceForm({
  initialEnabled,
  initialMessage,
  initialUntil,
}: {
  initialEnabled: boolean;
  initialMessage: string | null;
  /** ISO instant, or null. */
  initialUntil: string | null;
}) {
  const [enabled, setEnabled] = React.useState(initialEnabled);
  const [message, setMessage] = React.useState(initialMessage ?? "");
  // <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in LOCAL time.
  const [until, setUntil] = React.useState(() => toLocalInput(initialUntil));
  const [saving, setSaving] = React.useState(false);

  const over = message.length > MAX_MAINTENANCE_MESSAGE_CHARS;
  const dirty =
    enabled !== initialEnabled ||
    message !== (initialMessage ?? "") ||
    until !== toLocalInput(initialUntil);

  async function handleSave() {
    if (saving || over) return;
    // Only the destructive direction asks; bringing the shop back is never
    // something to slow down.
    if (enabled && !initialEnabled) {
      const ok = window.confirm(
        "Take the storefront offline now?\n\nCustomers will see the maintenance screen immediately. " +
          "This admin console stays available, so you can switch it back at any time.",
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const result = await saveMaintenanceAction({
        enabled,
        message: message.trim() === "" ? null : message,
        until: until === "" ? null : new Date(until).toISOString(),
      });
      if (result.ok) {
        toast.success(
          enabled
            ? "Storefront is now under maintenance."
            : "Storefront is back online.",
        );
      } else {
        toast.error(result.error);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-input px-3 py-2.5 dark:bg-input/30">
        <span className="min-w-0 space-y-0.5">
          <span className="block text-sm font-medium text-foreground">
            Storefront under maintenance
          </span>
          <span className="block text-xs text-muted-foreground">
            Customers see a notice instead of the shop. This console stays
            open, so you can always switch it back.
          </span>
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={saving}
          aria-label="Storefront under maintenance"
        />
      </label>

      {enabled ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            While this is on, nobody can browse or place an order. Changes
            reach every server within about ten seconds.
          </span>
        </p>
      ) : null}

      <div className="space-y-1.5">
        <label
          htmlFor="maintenanceMessage"
          className="text-sm font-medium text-foreground"
        >
          Message for customers
        </label>
        <textarea
          id="maintenanceMessage"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          disabled={saving}
          placeholder="We're updating our stock. We'll be back soon."
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
            ? `Too long — ${message.length}/${MAX_MAINTENANCE_MESSAGE_CHARS} characters.`
            : "Leave empty to use the default wording."}
        </p>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="maintenanceUntil"
          className="text-sm font-medium text-foreground"
        >
          Expected back by (optional)
        </label>
        <Input
          id="maintenanceUntil"
          type="datetime-local"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          disabled={saving}
          className="max-w-64"
        />
        <p className="text-xs text-muted-foreground">
          Shown to customers on the notice. It does <strong>not</strong> switch
          maintenance off by itself — you always bring the shop back yourself.
        </p>
      </div>

      <Button
        type="button"
        onClick={handleSave}
        disabled={saving || over || !dirty}
        aria-busy={saving || undefined}
        variant={enabled && !initialEnabled ? "destructive" : "default"}
      >
        {saving
          ? "Saving…"
          : enabled && !initialEnabled
            ? "Take storefront offline"
            : "Save"}
      </Button>
    </div>
  );
}

/** ISO instant → the "YYYY-MM-DDTHH:mm" local string the input expects. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `T${pad(when.getHours())}:${pad(when.getMinutes())}`
  );
}
