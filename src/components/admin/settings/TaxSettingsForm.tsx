"use client"

import * as React from "react"
import { toast } from "sonner"
import { Percent, Info, CheckCircle2, XCircle } from "lucide-react"

import { computeLineTax } from "@/lib/gst"
import { formatPaise } from "@/lib/money"
import { isValidGstin, gstinStateCode, GST_STATE_CODES } from "@/lib/gstin"
import { cn } from "@/lib/utils"
import { saveTaxProfileAction } from "@/server/actions/tax-settings"
import type { TaxProfileFormInput } from "@/server/actions/tax-settings-schema"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** The form's initial values (rate as a percent, strings for text fields). */
export interface TaxSettingsInitial {
  gstEnabled: boolean
  gstin: string
  legalName: string
  stateCode: string
  priceEntryMode: "TAX_EXCLUSIVE" | "TAX_INCLUSIVE"
  displayMode: "INCLUSIVE" | "EXCLUSIVE"
  roundingMode: "LINE" | "INVOICE"
  defaultGstRatePercent: number
  defaultHsnCode: string
}

const STATE_ITEMS = [
  { value: "", label: "— Not set —" },
  ...Object.entries(GST_STATE_CODES).map(([code, name]) => ({
    value: code,
    label: `${code} · ${name}`,
  })),
]

const TREATMENT_ITEMS = [
  { value: "TAX_EXCLUSIVE", label: "Exclusive (price + GST)" },
  { value: "TAX_INCLUSIVE", label: "Inclusive (GST already in price)" },
]

const DISPLAY_ITEMS = [
  { value: "EXCLUSIVE", label: "Show price then + GST" },
  { value: "INCLUSIVE", label: "Show GST-inclusive price" },
]

const ROUNDING_ITEMS = [
  { value: "LINE", label: "Per line (standard)" },
  { value: "INVOICE", label: "Once on the invoice total" },
]

export function TaxSettingsForm({ initial }: { initial: TaxSettingsInitial }) {
  const [gstEnabled, setGstEnabled] = React.useState(initial.gstEnabled)
  const [gstin, setGstin] = React.useState(initial.gstin)
  const [legalName, setLegalName] = React.useState(initial.legalName)
  const [stateCode, setStateCode] = React.useState(initial.stateCode)
  const [priceEntryMode, setPriceEntryMode] = React.useState(initial.priceEntryMode)
  const [displayMode, setDisplayMode] = React.useState(initial.displayMode)
  const [roundingMode, setRoundingMode] = React.useState(initial.roundingMode)
  const [ratePercent, setRatePercent] = React.useState(
    String(initial.defaultGstRatePercent),
  )
  const [hsnCode, setHsnCode] = React.useState(initial.defaultHsnCode)
  const [pending, startTransition] = React.useTransition()

  // GSTIN inline validity.
  const trimmedGstin = gstin.trim().toUpperCase()
  const gstinValid = trimmedGstin === "" ? null : isValidGstin(trimmedGstin)
  const gstinState =
    gstinValid && gstinStateCode(trimmedGstin)
      ? GST_STATE_CODES[gstinStateCode(trimmedGstin) as string]
      : null

  // Worked example — server-authoritative math via computeLineTax.
  const parsedPercent = Number(ratePercent)
  const rateBps =
    Number.isFinite(parsedPercent) && parsedPercent >= 0
      ? Math.round(parsedPercent * 100)
      : 0
  const example = React.useMemo(() => {
    try {
      return computeLineTax({
        amountPaise: 100000, // ₹1,000.00
        gstRateBps: rateBps,
        treatment: priceEntryMode,
      })
    } catch {
      return null
    }
  }, [rateBps, priceEntryMode])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (gstinValid === false) {
      toast.error("Fix the GSTIN before saving.")
      return
    }
    if (!Number.isFinite(parsedPercent) || parsedPercent < 0 || parsedPercent > 100) {
      toast.error("Enter a GST rate between 0 and 100%.")
      return
    }

    const payload: TaxProfileFormInput = {
      gstEnabled,
      gstin: trimmedGstin || undefined,
      legalName: legalName.trim() || undefined,
      stateCode: (stateCode || undefined) as TaxProfileFormInput["stateCode"],
      priceEntryMode,
      displayMode,
      roundingMode,
      defaultGstRatePercent: parsedPercent,
      defaultHsnCode: hsnCode.trim() || undefined,
    }

    startTransition(async () => {
      try {
        const res = await saveTaxProfileAction(payload)
        if (res.ok) {
          toast.success("Tax settings saved")
        } else {
          toast.error(res.error)
        }
      } catch {
        toast.error("Could not save tax settings.")
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Kill-switch */}
      <Section
        title="GST"
        description="The master switch. While this is off, the catalogue and orders behave exactly as before — no tax is calculated or shown anywhere."
      >
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 p-3">
          <div className="min-w-0">
            <Label htmlFor="gstEnabled" className="text-sm font-medium">
              Enable GST
            </Label>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Turn on to apply GST to priced items and orders.
            </p>
          </div>
          <Switch
            id="gstEnabled"
            checked={gstEnabled}
            onCheckedChange={(next) => setGstEnabled(next === true)}
          />
        </div>
      </Section>

      <fieldset
        disabled={!gstEnabled}
        className={cn(
          "space-y-6 transition-opacity",
          !gstEnabled && "pointer-events-none opacity-50",
        )}
      >
        {/* Identity */}
        <Section
          title="Seller identity"
          description="Appears on tax invoices and decides intra- vs inter-state supply."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal name" htmlFor="legalName">
              <Input
                id="legalName"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Registered business name"
                maxLength={200}
              />
            </Field>

            <Field label="GSTIN" htmlFor="gstin">
              <Input
                id="gstin"
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="27AAPFU0939F1ZV"
                maxLength={15}
                autoCapitalize="characters"
                aria-invalid={gstinValid === false || undefined}
              />
              {gstinValid === true && (
                <p className="mt-1 flex items-center gap-1 text-xs text-primary">
                  <CheckCircle2 className="size-3.5" aria-hidden />
                  Valid{gstinState ? ` · ${gstinState}` : ""}
                </p>
              )}
              {gstinValid === false && (
                <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                  <XCircle className="size-3.5" aria-hidden />
                  Not a valid GSTIN
                </p>
              )}
            </Field>

            <Field
              label="Place of supply (origin state)"
              htmlFor="stateCode"
              hint="Defaults to the GSTIN's state when left unset."
            >
              <Select
                value={stateCode}
                onValueChange={(v) => setStateCode((v as string | null) ?? "")}
                items={STATE_ITEMS}
              >
                <SelectTrigger id="stateCode" className="w-full">
                  <SelectValue placeholder="Select a state" />
                </SelectTrigger>
                <SelectContent>
                  {STATE_ITEMS.map((it) => (
                    <SelectItem key={it.value} value={it.value}>
                      {it.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </Section>

        {/* Defaults */}
        <Section
          title="Tax defaults"
          description="Used for any product that doesn't set its own HSN code or GST rate (product → category → these defaults)."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Default GST rate"
              htmlFor="ratePercent"
              hint="Stored as basis points (18% = 1800 bps)."
            >
              <div className="relative">
                <Input
                  id="ratePercent"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.01"
                  value={ratePercent}
                  onChange={(e) => setRatePercent(e.target.value)}
                  className="pr-8"
                />
                <Percent
                  className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
              </div>
            </Field>

            <Field label="Default HSN code" htmlFor="hsn">
              <Input
                id="hsn"
                value={hsnCode}
                onChange={(e) => setHsnCode(e.target.value)}
                placeholder="8517"
                maxLength={20}
              />
            </Field>
          </div>
        </Section>

        {/* Treatment & display */}
        <Section
          title="Pricing & rounding"
          description="How stored prices are interpreted, how retailers see them, and how GST is rounded."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Price entry treatment"
              htmlFor="treatment"
              hint="What the prices you type already include."
            >
              <Select
                value={priceEntryMode}
                onValueChange={(v) =>
                  setPriceEntryMode(v as TaxSettingsInitial["priceEntryMode"])
                }
                items={TREATMENT_ITEMS}
              >
                <SelectTrigger id="treatment" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TREATMENT_ITEMS.map((it) => (
                    <SelectItem key={it.value} value={it.value}>
                      {it.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Default display to retailers"
              htmlFor="display"
              hint="Retailers can flip this per device."
            >
              <Select
                value={displayMode}
                onValueChange={(v) =>
                  setDisplayMode(v as TaxSettingsInitial["displayMode"])
                }
                items={DISPLAY_ITEMS}
              >
                <SelectTrigger id="display" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISPLAY_ITEMS.map((it) => (
                    <SelectItem key={it.value} value={it.value}>
                      {it.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Rounding" htmlFor="rounding">
              <Select
                value={roundingMode}
                onValueChange={(v) =>
                  setRoundingMode(v as TaxSettingsInitial["roundingMode"])
                }
                items={ROUNDING_ITEMS}
              >
                <SelectTrigger id="rounding" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUNDING_ITEMS.map((it) => (
                    <SelectItem key={it.value} value={it.value}>
                      {it.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Inclusive vs exclusive explainer */}
          <div className="mt-4 flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <span className="font-medium text-foreground">Exclusive</span> means
              the price you enter is the taxable base and GST is added on top.{" "}
              <span className="font-medium text-foreground">Inclusive</span> means
              the price you enter already contains GST, so the taxable base is
              back-calculated out of it. The maths is always integer-exact.
            </p>
          </div>

          {/* Live worked example */}
          {example && (
            <div className="mt-3 rounded-lg border border-border bg-card p-3">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Worked example
              </p>
              <p className="mt-1 text-sm text-foreground">
                {priceEntryMode === "TAX_EXCLUSIVE" ? (
                  <>
                    {formatPaise(example.taxablePaise)} at {ratePercent || "0"}%{" "}
                    <span className="text-muted-foreground">→ + GST</span>{" "}
                    {formatPaise(example.taxPaise)}{" "}
                    <span className="text-muted-foreground">=</span>{" "}
                    <span className="font-semibold">
                      {formatPaise(example.grossPaise)}
                    </span>
                  </>
                ) : (
                  <>
                    {formatPaise(example.grossPaise)} incl. {ratePercent || "0"}%{" "}
                    <span className="text-muted-foreground">→ base</span>{" "}
                    {formatPaise(example.taxablePaise)}{" "}
                    <span className="text-muted-foreground">+ GST</span>{" "}
                    <span className="font-semibold">
                      {formatPaise(example.taxPaise)}
                    </span>
                  </>
                )}
              </p>
            </div>
          )}
        </Section>
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save tax settings"}
        </Button>
      </div>
    </form>
  )
}

/* --------------------------------------------------------------------- */

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs">
      <div className="mb-4 min-w-0 space-y-0.5">
        <h2 className="font-heading text-base font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
