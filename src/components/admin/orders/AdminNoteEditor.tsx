"use client";

/**
 * AdminNoteEditor — a private, admin-only note on an order (never shown to the
 * buyer). Autosizes, length-capped, saves via the guarded action with a busy
 * state and a toast. Dirty-tracked so "Save" only enables on a real change.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { setOrderAdminNoteAction } from "@/server/actions/admin-orders";

const MAX_NOTE = 2000;

export function AdminNoteEditor({
  orderId,
  note,
}: {
  orderId: string;
  note: string | null;
}) {
  const router = useRouter();
  const initial = note ?? "";
  const [value, setValue] = React.useState(initial);
  const [saved, setSaved] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);

  const dirty = value.trim() !== saved.trim();

  const save = React.useCallback(async () => {
    setBusy(true);
    try {
      const trimmed = value.trim();
      const res = await setOrderAdminNoteAction({
        id: orderId,
        note: trimmed === "" ? null : trimmed,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSaved(trimmed);
      toast.success("Note saved.");
      router.refresh();
    } catch {
      toast.error("Couldn't save the note. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [orderId, router, value]);

  return (
    <div className="space-y-2">
      <label
        htmlFor={`admin-note-${orderId}`}
        className="text-sm font-semibold text-foreground"
      >
        Internal note
      </label>
      <p className="text-xs text-muted-foreground">
        Private to the team — the customer never sees this.
      </p>
      <textarea
        id={`admin-note-${orderId}`}
        value={value}
        maxLength={MAX_NOTE}
        rows={4}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add context, fulfilment details, or follow-ups…"
        className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground tabular-nums">
          {value.length}/{MAX_NOTE}
        </span>
        <Button size="sm" onClick={save} disabled={!dirty || busy}>
          {busy ? <Spinner size="sm" label="" /> : null}
          Save note
        </Button>
      </div>
    </div>
  );
}
