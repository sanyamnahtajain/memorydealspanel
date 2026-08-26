"use client";

import * as React from "react";
import { CheckIcon, CopyIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import type { EntryGate } from "@/lib/entry-gate";
import { normalizeEntryCode } from "@/lib/entry-gate";
import { saveEntryGateAction } from "@/server/actions/entry-gate";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Shop code settings (the entry gate — see src/lib/entry-gate.ts). One card:
 * a master switch, the current code with a Copy button (the owner reads it
 * back out to share it — that is why it is stored retrievably), and a
 * change-code flow with the lockout warning front and centre: the device
 * cookie is bound to the code, so rotating it kicks out every old copy.
 * Mirrors DeliverySettingsForm (useState + useTransition + toast).
 */

/** A-Z and 2-9 without the lookalikes 0/O and 1/I — read-aloud friendly. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateFriendlyCode(): string {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  let suffix = "";
  for (const b of bytes) suffix += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `TMD-${suffix}`;
}

export function EntryGateForm({ initial }: { initial: EntryGate }) {
  const [enabled, setEnabled] = React.useState(initial.enabled);
  const [currentCode, setCurrentCode] = React.useState(initial.code);
  const [newCode, setNewCode] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [justCopied, setJustCopied] = React.useState(false);

  const currentCodeRef = React.useRef<HTMLInputElement>(null);
  const copiedTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null)
        window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const trimmedNew = newCode.trim();
  const newCodeTooShort = trimmedNew.length > 0 && trimmedNew.length < 4;
  /** What a save would store: the new code if one is typed, else the current. */
  const effectiveCode = trimmedNew || currentCode;

  async function copyCurrentCode() {
    try {
      await navigator.clipboard.writeText(currentCode);
      setJustCopied(true);
      if (copiedTimerRef.current !== null)
        window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(
        () => setJustCopied(false),
        1500,
      );
      toast.success("Code copied");
    } catch {
      // No clipboard permission (http, old browser): select the text so a
      // manual copy is one keypress away.
      currentCodeRef.current?.select();
      toast.error("Could not copy — the code is selected, press Ctrl+C / Cmd+C.");
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (enabled && effectiveCode.length < 4) {
      toast.error("The code needs at least 4 characters.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await saveEntryGateAction({
          enabled,
          code: effectiveCode,
        });
        if (res.ok) {
          setCurrentCode(normalizeEntryCode(effectiveCode));
          setNewCode("");
          toast.success(
            enabled ? "Shop code saved" : "Shop code turned off",
          );
        } else {
          toast.error(res.error);
        }
      } catch {
        toast.error("Could not save the shop code settings.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Ask new customers for a shop code
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            New customers must enter this code before they can ask for prices.
            People who already have an account are never asked.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label="Ask new customers for a shop code"
        />
      </div>

      <fieldset
        disabled={!enabled}
        className={cn(
          "space-y-4 transition-opacity",
          !enabled && "pointer-events-none opacity-50",
        )}
      >
        {/* Current code — shown in the clear on purpose: the owner shares it. */}
        <div>
          <Label htmlFor="entry-gate-current">Current code</Label>
          {currentCode ? (
            <div className="mt-1.5 flex items-center gap-2">
              <Input
                id="entry-gate-current"
                ref={currentCodeRef}
                readOnly
                value={currentCode}
                onFocus={(event) => event.currentTarget.select()}
                className="max-w-56 bg-muted/50 font-mono tracking-widest"
                aria-label="Current shop code"
              />
              <Button
                type="button"
                variant="outline"
                onClick={copyCurrentCode}
                aria-label="Copy the shop code"
              >
                {justCopied ? (
                  <CheckIcon className="text-success" aria-hidden />
                ) : (
                  <CopyIcon aria-hidden />
                )}
                {justCopied ? "Copied" : "Copy"}
              </Button>
            </div>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground">
              No code yet — set one below, then save.
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Share it on WhatsApp or in the shop. Small or capital letters both
            work.
          </p>
        </div>

        {/* Change code */}
        <div>
          <Label htmlFor="entry-gate-new">
            {currentCode ? "Change the code" : "Set the code"}
          </Label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Input
              id="entry-gate-new"
              value={newCode}
              onChange={(event) => setNewCode(event.target.value)}
              placeholder={currentCode ? "New code" : "e.g. TMD-8FKP"}
              maxLength={32}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={newCodeTooShort}
              aria-describedby={
                newCodeTooShort ? "entry-gate-new-error" : undefined
              }
              className="max-w-56 font-mono tracking-widest uppercase"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setNewCode(generateFriendlyCode())}
            >
              <SparklesIcon aria-hidden />
              Generate
            </Button>
          </div>
          {newCodeTooShort ? (
            <p
              id="entry-gate-new-error"
              className="mt-1 text-xs text-destructive"
            >
              The code needs at least 4 characters.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              At least 4 characters. Leave empty to keep the current code.
            </p>
          )}
        </div>

        {/* Rotation is lockout — that is the point, but say it out loud. */}
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
          <TriangleAlertIcon
            className="mt-0.5 size-4 shrink-0 text-warning"
            aria-hidden
          />
          <p className="text-sm text-foreground">
            Changing the code locks out everyone who had the old one. Share the
            new code again.
          </p>
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save shop code"}
      </Button>
    </form>
  );
}
