"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Info } from "lucide-react";

import { GST_STATE_CODES, isValidGstin, gstinStateCode } from "@/lib/gstin";
import { cn } from "@/lib/utils";
import { updateBusinessProfileAction } from "@/server/actions/customers-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScaleTap } from "@/components/motion/primitives";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * BusinessProfileForm — the retailer's own GST identity capture on the account
 * page. Client component; persists through `updateBusinessProfileAction`, which
 * is IDOR-safe (writes `viewer.customerId` only) and derives `gstStateCode`
 * from the GSTIN server-side.
 *
 * We only render this when the seller has GST enabled (the parent gates on
 * `gstEnabled`). Everything here is inert while GST is off.
 */

export interface BusinessProfileFormProps {
  initial: {
    businessName: string;
    gstNumber: string;
    placeOfSupplyStateCode: string;
  };
}

/** Place-of-supply Select items: an explicit "not set" plus every GST state. */
const STATE_ITEMS = [
  { value: "", label: "— Not set —" },
  ...Object.entries(GST_STATE_CODES).map(([code, name]) => ({
    value: code,
    label: `${code} · ${name}`,
  })),
];

export function BusinessProfileForm({ initial }: BusinessProfileFormProps) {
  const [businessName, setBusinessName] = React.useState(initial.businessName);
  const [gstNumber, setGstNumber] = React.useState(initial.gstNumber);
  const [placeOfSupply, setPlaceOfSupply] = React.useState(
    initial.placeOfSupplyStateCode,
  );
  const [pending, startTransition] = React.useTransition();

  // Inline GSTIN validity (mirrors the admin tax settings form).
  const trimmedGstin = gstNumber.trim().toUpperCase();
  const gstinValid = trimmedGstin === "" ? null : isValidGstin(trimmedGstin);
  const derivedState =
    gstinValid && gstinStateCode(trimmedGstin)
      ? GST_STATE_CODES[gstinStateCode(trimmedGstin) as string]
      : null;

  const nameValid = businessName.trim().length > 0;
  const canSave =
    !pending && nameValid && (trimmedGstin === "" || gstinValid === true);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    startTransition(async () => {
      const result = await updateBusinessProfileAction({
        businessName,
        gstNumber,
        placeOfSupplyStateCode: placeOfSupply,
      });
      if (result.ok) {
        toast.success("Business details saved.");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="businessName">Business name</Label>
        <Input
          id="businessName"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder="Registered business name"
          maxLength={200}
          aria-invalid={!nameValid || undefined}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gstNumber">GSTIN</Label>
        <Input
          id="gstNumber"
          value={gstNumber}
          onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
          placeholder="27AAPFU0939F1ZV"
          maxLength={15}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={gstinValid === false || undefined}
        />
        {gstinValid === true && (
          <p className="flex items-center gap-1 text-xs text-primary">
            <CheckCircle2 className="size-3.5" aria-hidden />
            Valid{derivedState ? ` · ${derivedState}` : ""}
          </p>
        )}
        {gstinValid === false && (
          <p className="flex items-center gap-1 text-xs text-destructive">
            <XCircle className="size-3.5" aria-hidden />
            Not a valid GSTIN
          </p>
        )}
        {gstinValid === null && (
          <p className="text-xs text-muted-foreground">
            Optional. Registered buyers should add their GSTIN so invoices carry it.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="placeOfSupply">Place of supply (billing state)</Label>
        <Select
          value={placeOfSupply}
          onValueChange={(v) => setPlaceOfSupply((v as string | null) ?? "")}
          items={STATE_ITEMS}
        >
          <SelectTrigger id="placeOfSupply" className="w-full">
            <SelectValue placeholder="Select your state" />
          </SelectTrigger>
          <SelectContent>
            {STATE_ITEMS.map((it) => (
              <SelectItem key={it.value} value={it.value}>
                {it.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground",
        )}
      >
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <p>
          Your billing state decides how GST is split on your orders: within the
          seller&apos;s state you&apos;re charged CGST + SGST, and across states
          IGST. Keeping this accurate ensures your invoices show the correct
          split.
        </p>
      </div>

      <div className="flex justify-end">
        <ScaleTap className="inline-block">
          <Button type="submit" className="h-9" disabled={!canSave}>
            {pending ? "Saving…" : "Save details"}
          </Button>
        </ScaleTap>
      </div>
    </form>
  );
}
