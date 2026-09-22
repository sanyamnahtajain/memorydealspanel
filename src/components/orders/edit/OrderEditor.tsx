"use client";

import * as React from "react";
import Image from "next/image";
import { AlertTriangle, ImageOff, Minus, Plus, Search, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/money";
import {
  MAX_EDIT_NOTE,
  MAX_EDIT_REASON,
  editLineKey,
  type OrderEditInput,
  type OrderEditPreviewDTO,
  type OrderEditProductPick,
  type OrderTotalsView,
} from "@/lib/order-edits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { OrderChangesList } from "./OrderChangesList";

/**
 * The order editor — ONE component for the admin console and the storefront.
 *
 * It holds a DRAFT of the order's lines and asks the server to price it (the
 * client never computes money); the two surfaces differ only in the actions
 * they hand in and in `mode`, which decides whether a note field is offered
 * (customers) or a reason field (staff).
 *
 * Quantities are validated by the server preview against each product's
 * rules, and the preview's `constraints` drive the stepper (its step is the
 * pack multiple; its floor the MOQ) so a customer is nudged onto a valid
 * quantity instead of being told off after the fact. Allocation lines (per-
 * model splits) are edited inline and must add up — the split is what gets
 * packed, so the server refuses to guess it.
 */

export type ActionResult<T> = { ok: true } & T | { ok: false; error: string };

export interface EditorSeedLine {
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  brand: string | null;
  variantLabel: string | null;
  imageUrl: string | null;
  quantity: number;
  breakdown: { modelName: string; qty: number }[] | null;
}

interface DraftLine extends EditorSeedLine {
  key: string;
  added: boolean;
  /** Present when this product needs a per-model split. */
  allocation: boolean;
}

export interface OrderEditorProps {
  orderNumber: string;
  version: number;
  /** Whether this viewer may see money. Amounts render as "—" otherwise. */
  priced: boolean;
  mode: "admin" | "customer";
  initialLines: EditorSeedLine[];
  initialNote: string | null;
  preview: (input: OrderEditInput) => Promise<ActionResult<{ preview: OrderEditPreviewDTO }>>;
  save: (input: OrderEditInput) => Promise<ActionResult<{ version: number; summary: string }>>;
  search: (query: string) => Promise<ActionResult<{ products: OrderEditProductPick[] }>>;
  onSaved: (summary: string) => void;
  onCancel: () => void;
}

const PREVIEW_DEBOUNCE_MS = 350;
const SEARCH_DEBOUNCE_MS = 250;

function money(value: number | null): string {
  return value === null ? "—" : formatPaise(value);
}

/** Lowest valid quantity for a product rule set. */
function startingQuantity(moq: number, packMultiple: number | null): number {
  const floor = Math.max(1, moq);
  if (!packMultiple || packMultiple <= 1) return floor;
  return Math.ceil(floor / packMultiple) * packMultiple;
}

export function OrderEditor({
  orderNumber,
  version,
  priced,
  mode,
  initialLines,
  initialNote,
  preview,
  save,
  search,
  onSaved,
  onCancel,
}: OrderEditorProps) {
  const [lines, setLines] = React.useState<DraftLine[]>(() =>
    initialLines.map((l) => ({
      ...l,
      key: editLineKey(l.productId, l.variantId),
      added: false,
      allocation: !!l.breakdown && l.breakdown.length > 0,
    })),
  );
  const [note, setNote] = React.useState(initialNote ?? "");
  const [reason, setReason] = React.useState("");
  const [result, setResult] = React.useState<OrderEditPreviewDTO | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const buildInput = React.useCallback(
    (): OrderEditInput => ({
      expectedVersion: version,
      lines: lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        quantity: l.quantity,
        ...(l.allocation ? { breakdown: l.breakdown ?? [] } : {}),
      })),
      ...(mode === "customer" ? { note: note.trim() === "" ? null : note } : {}),
      ...(mode === "admin" && reason.trim() !== "" ? { reason } : {}),
    }),
    [lines, mode, note, reason, version],
  );

  // Live pricing, debounced, latest-wins. A stale response never overwrites
  // a newer one — the same discipline as the storefront's search box.
  const requestSeq = React.useRef(0);
  React.useEffect(() => {
    // Nothing to price for an empty draft; the panel says so from `lines`
    // directly (no state write here — the lint rule is right that an effect
    // setting state synchronously is a re-render for nothing).
    if (lines.length === 0) return;
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      setPreviewing(true);
      void preview(buildInput())
        .then((res) => {
          if (seq !== requestSeq.current) return;
          if (res.ok) {
            setResult(res.preview);
            setPreviewError(null);
          } else {
            setPreviewError(res.error);
          }
        })
        .catch(() => {
          if (seq === requestSeq.current) setPreviewError("Couldn't price that change.");
        })
        .finally(() => {
          if (seq === requestSeq.current) setPreviewing(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [buildInput, lines.length, preview]);

  const constraintsFor = (key: string) =>
    result?.lines.find((l) => l.key === key)?.constraints ?? null;

  const setQuantity = (key: string, quantity: number) =>
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, Math.floor(quantity)) } : l)),
    );
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));
  const setBreakdown = (key: string, breakdown: { modelName: string; qty: number }[]) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, breakdown } : l)));

  const addPick = (pick: OrderEditProductPick, variant: { id: string; label: string; sku: string } | null) => {
    const key = editLineKey(pick.id, variant?.id ?? null);
    if (lines.some((l) => l.key === key)) return;
    const quantity = startingQuantity(pick.moq, pick.packMultiple);
    setLines((prev) => [
      ...prev,
      {
        key,
        productId: pick.id,
        variantId: variant?.id ?? null,
        name: pick.name,
        sku: variant?.sku ?? pick.sku,
        brand: pick.brand,
        variantLabel: variant?.label ?? null,
        imageUrl: pick.thumbUrl,
        quantity,
        breakdown: pick.allocation ? [{ modelName: "", qty: quantity }] : null,
        added: true,
        allocation: pick.allocation,
      },
    ]);
  };

  const empty = lines.length === 0;
  const shownError = empty ? "An order needs at least one item." : previewError;
  const shownResult = empty ? null : result;
  const changes = shownResult?.changes ?? [];
  const canSave = !!shownResult && !shownError && changes.length > 0 && !previewing && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await save(buildInput());
      if (!res.ok) {
        setPreviewError(res.error);
        return;
      }
      onSaved(res.summary);
    } catch {
      setPreviewError("Couldn't save that change. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {lines.map((line) => {
          const c = constraintsFor(line.key);
          const step = c?.packMultiple && c.packMultiple > 1 ? c.packMultiple : 1;
          const floor = mode === "customer" ? Math.max(1, c?.moq ?? 1) : 1;
          const previewed = result?.lines.find((l) => l.key === line.key) ?? null;
          const sum = (line.breakdown ?? []).reduce((s, e) => s + e.qty, 0);
          const splitOff = line.allocation && sum !== line.quantity;
          return (
            <li key={line.key} className="space-y-3 p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {line.imageUrl ? (
                    <Image src={line.imageUrl} alt="" fill sizes="56px" className="object-cover" />
                  ) : (
                    <ImageOff className="absolute inset-0 m-auto size-5 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">
                    {line.name}
                    {line.variantLabel ? (
                      <span className="text-muted-foreground"> — {line.variantLabel}</span>
                    ) : null}
                    {line.added ? (
                      <span className="ml-2 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-emerald-700 dark:text-emerald-300">
                        New
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[line.brand, line.sku].filter(Boolean).join(" · ")}
                    {c && !c.available ? " · no longer available — reduce or remove" : ""}
                  </p>
                  {priced && previewed ? (
                    <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                      {money(previewed.unitPricePaise)} × {previewed.quantity} ={" "}
                      <span className="font-medium text-foreground">{money(previewed.lineTotalPaise)}</span>
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${line.name}`}
                  onClick={() => removeLine(line.key)}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center rounded-lg border border-input">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    disabled={line.quantity - step < floor}
                    onClick={() => setQuantity(line.key, line.quantity - step)}
                    className="p-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <Minus className="size-4" aria-hidden />
                  </button>
                  <Input
                    aria-label={`Quantity for ${line.name}`}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(/[^\d]/g, ""));
                      if (Number.isFinite(n)) setQuantity(line.key, n || 1);
                    }}
                    className="h-9 w-20 border-0 text-center tabular-nums shadow-none focus-visible:ring-0"
                  />
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    disabled={!!c && c.maxQty !== null && line.quantity + step > c.maxQty}
                    onClick={() => setQuantity(line.key, line.quantity + step)}
                    className="p-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <Plus className="size-4" aria-hidden />
                  </button>
                </div>
                {c && (c.moq > 1 || (c.packMultiple && c.packMultiple > 1)) ? (
                  <span className="text-xs text-muted-foreground">
                    {c.moq > 1 ? `min ${c.moq}` : ""}
                    {c.moq > 1 && c.packMultiple && c.packMultiple > 1 ? " · " : ""}
                    {c.packMultiple && c.packMultiple > 1 ? `packs of ${c.packMultiple}` : ""}
                  </span>
                ) : null}
              </div>

              {line.allocation ? (
                <BreakdownEditor
                  rows={line.breakdown ?? []}
                  quantity={line.quantity}
                  off={splitOff}
                  onChange={(rows) => setBreakdown(line.key, rows)}
                />
              ) : null}
            </li>
          );
        })}
        {lines.length === 0 ? (
          <li className="p-6 text-center text-sm text-muted-foreground">
            No items left. Add one below, or cancel the order instead.
          </li>
        ) : null}
      </ul>

      <ProductPicker
        search={search}
        exclude={new Set(lines.map((l) => l.key))}
        onPick={addPick}
      />

      {mode === "customer" ? (
        <div className="space-y-1.5">
          <label htmlFor="order-edit-note" className="text-sm font-medium text-foreground">
            Note for the shop (optional)
          </label>
          <textarea
            id="order-edit-note"
            value={note}
            maxLength={MAX_EDIT_NOTE}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Packing or delivery instructions…"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="order-edit-reason" className="text-sm font-medium text-foreground">
            Reason (optional, kept in the order&rsquo;s history)
          </label>
          <Input
            id="order-edit-reason"
            value={reason}
            maxLength={MAX_EDIT_REASON}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Customer called to change quantities"
          />
        </div>
      )}

      <TotalsPanel
        priced={priced}
        before={shownResult?.before ?? null}
        after={shownResult?.after ?? null}
        previewing={previewing && !empty}
        error={shownError}
        warnings={shownResult?.warnings ?? []}
      />

      {changes.length > 0 && !shownError ? (
        <div className="space-y-1.5 rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            What changes
          </p>
          <OrderChangesList changes={changes} className="space-y-1" />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void handleSave()} disabled={!canSave} aria-busy={saving || undefined}>
          {saving ? <Spinner size="sm" label="" /> : null}
          Save changes to #{orderNumber}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function BreakdownEditor({
  rows,
  quantity,
  off,
  onChange,
}: {
  rows: { modelName: string; qty: number }[];
  quantity: number;
  off: boolean;
  onChange: (rows: { modelName: string; qty: number }[]) => void;
}) {
  const sum = rows.reduce((s, e) => s + e.qty, 0);
  return (
    <div className={cn("space-y-2 rounded-lg border p-3", off ? "border-warning/60 bg-warning/5" : "border-border")}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Per-model split</p>
        <p className={cn("text-xs tabular-nums", off ? "font-semibold text-warning-foreground" : "text-muted-foreground")}>
          {sum} of {quantity}
        </p>
      </div>
      <ul className="space-y-1.5">
        {rows.map((row, i) => (
          <li key={i} className="flex items-center gap-2">
            <Input
              aria-label="Model name"
              value={row.modelName}
              placeholder="Model, e.g. iPhone 15"
              onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, modelName: e.target.value } : r)))}
              className="h-8 flex-1"
            />
            <Input
              aria-label="Quantity for this model"
              inputMode="numeric"
              value={row.qty}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/[^\d]/g, ""));
                onChange(rows.map((r, j) => (j === i ? { ...r, qty: Number.isFinite(n) ? n : 0 } : r)));
              }}
              className="h-8 w-20 text-center tabular-nums"
            />
            <button
              type="button"
              aria-label="Remove model"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
            >
              <X className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...rows, { modelName: "", qty: Math.max(0, quantity - sum) }])}
      >
        <Plus className="size-4" aria-hidden />
        Add model
      </Button>
      {off ? (
        <p className="text-xs text-warning-foreground">The split must add up to the quantity before you can save.</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ProductPicker({
  search,
  exclude,
  onPick,
}: {
  search: OrderEditorProps["search"];
  exclude: Set<string>;
  onPick: (pick: OrderEditProductPick, variant: { id: string; label: string; sku: string } | null) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<OrderEditProductPick[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [choosingVariant, setChoosingVariant] = React.useState<OrderEditProductPick | null>(null);
  const seq = React.useRef(0);

  const active = query.trim().length >= 2;
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      setBusy(true);
      void search(q)
        .then((res) => {
          if (mine !== seq.current) return;
          setResults(res.ok ? res.products : []);
        })
        .finally(() => {
          if (mine === seq.current) setBusy(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, search]);

  const choose = (pick: OrderEditProductPick, variant: { id: string; label: string; sku: string } | null) => {
    onPick(pick, variant);
    setQuery("");
    setResults([]);
    setChoosingVariant(null);
  };

  return (
    <div className="space-y-2">
      <label htmlFor="order-edit-search" className="text-sm font-medium text-foreground">
        Add an item
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id="order-edit-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, SKU or brand…"
          className="pl-9"
          autoComplete="off"
        />
        {busy ? <Spinner size="sm" label="" className="absolute top-1/2 right-3 -translate-y-1/2" /> : null}
      </div>
      {active && results.length > 0 ? (
        <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
          {results.map((p) => {
            const simpleKey = editLineKey(p.id, null);
            const already = p.variants.length === 0 && exclude.has(simpleKey);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={already}
                  onClick={() => (p.variants.length > 0 ? setChoosingVariant(p) : choose(p, null))}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 disabled:opacity-50"
                >
                  <div className="relative size-9 shrink-0 overflow-hidden rounded-md bg-muted">
                    {p.thumbUrl ? <Image src={p.thumbUrl} alt="" fill sizes="36px" className="object-cover" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[p.brand, p.sku].filter(Boolean).join(" · ")}
                      {p.variants.length > 0 ? ` · ${p.variants.length} variants` : ""}
                      {already ? " · already in the order" : ""}
                    </p>
                  </div>
                </button>
                {choosingVariant?.id === p.id ? (
                  <ul className="border-t border-border bg-muted/30 px-3 py-2">
                    {p.variants.map((v) => {
                      const taken = exclude.has(editLineKey(p.id, v.id));
                      return (
                        <li key={v.id}>
                          <button
                            type="button"
                            disabled={taken}
                            onClick={() => choose(p, v)}
                            className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                          >
                            {v.label}
                            <span className="text-muted-foreground"> · {v.sku}{taken ? " · already in the order" : ""}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TotalsPanel({
  priced,
  before,
  after,
  previewing,
  error,
  warnings,
}: {
  priced: boolean;
  before: OrderTotalsView | null;
  after: OrderTotalsView | null;
  previewing: boolean;
  error: string | null;
  warnings: string[];
}) {
  const row = (label: string, b: number | null | undefined, a: number | null | undefined, sign = "") => {
    if (!priced) return null;
    if ((b ?? 0) === 0 && (a ?? 0) === 0) return null;
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {before && after && b !== a ? (
            <>
              <span className="text-muted-foreground line-through">{sign}{money(b ?? 0)}</span>{" "}
            </>
          ) : null}
          <span className="font-medium text-foreground">{sign}{money(a ?? b ?? 0)}</span>
        </span>
      </div>
    );
  };
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-card p-4" aria-live="polite">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Totals</p>
        {previewing ? <Spinner size="sm" label="Pricing…" /> : null}
      </div>
      {error ? (
        <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      {after ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Items</span>
            <span className="tabular-nums">
              {before && before.itemCount !== after.itemCount ? (
                <span className="text-muted-foreground line-through">{before.itemCount} </span>
              ) : null}
              <span className="font-medium text-foreground">{after.itemCount}</span>
            </span>
          </div>
          {row("Subtotal", before?.subtotalPaise, after.subtotalPaise)}
          {row("Group discount", before?.groupDiscountPaise, after.groupDiscountPaise, "−")}
          {row("Coupon", before?.discountPaise, after.discountPaise, "−")}
          {row("GST", before?.taxPaise, after.taxPaise)}
          {row("Delivery", before?.deliveryChargePaise, after.deliveryChargePaise)}
          {priced ? (
            <div className="flex items-center justify-between border-t border-border pt-1.5 text-sm">
              <span className="font-medium text-foreground">Payable</span>
              <span className="tabular-nums">
                {before && before.payablePaise !== after.payablePaise ? (
                  <span className="text-muted-foreground line-through">{money(before.payablePaise)} </span>
                ) : null}
                <span className="text-base font-semibold text-foreground">{money(after.payablePaise)}</span>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      {warnings.map((w) => (
        <p key={w} className="text-xs text-muted-foreground">{w}</p>
      ))}
    </div>
  );
}
