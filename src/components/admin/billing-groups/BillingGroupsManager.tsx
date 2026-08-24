"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Layers,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPaise, parseRupees } from "@/lib/money";
import { percentOfPaise, resolveTier } from "@/lib/billing-groups/engine";
import {
  GROUP_COLORS,
  type BillingGroupConfig,
  type DiscountTier,
  type GroupColor,
} from "@/lib/billing-groups/types";
import type { BillingGroupInput } from "@/lib/schemas/billing-group";
import type { BrandOption } from "@/server/services/brands";
import {
  deleteBillingGroupAction,
  previewBillingGroupImpactAction,
  saveBillingGroupAction,
  setBillingGroupActiveAction,
} from "@/server/actions/billing-groups";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ConfirmSheet, EmptyState, Tooltip, useIsMobile } from "@/components/common";

/**
 * BillingGroupsManager — the admin surface for billing groups.
 *
 * List of group cards (active switch, edit, delete) plus a create/edit Sheet
 * with a live "try a bucket amount" preview that runs the SAME pure engine
 * the cart uses (`resolveTier` / `percentOfPaise`), so what the admin sees
 * here is exactly what a customer would get.
 */

/* ------------------------------------------------------------------ */
/* Color tokens (static class map — Tailwind needs literal class names) */
/* ------------------------------------------------------------------ */

const DOT_CLASS: Record<GroupColor, string> = {
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  cyan: "bg-cyan-500",
  slate: "bg-slate-500",
};

const COLOR_LABEL: Record<GroupColor, string> = {
  blue: "Blue",
  emerald: "Emerald",
  violet: "Violet",
  amber: "Amber",
  rose: "Rose",
  cyan: "Cyan",
  slate: "Slate",
};

function isGroupColor(value: string): value is GroupColor {
  return (GROUP_COLORS as readonly string[]).includes(value);
}

function dotClass(color: string): string {
  return isGroupColor(color) ? DOT_CLASS[color] : DOT_CLASS.slate;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function tiersOf(group: BillingGroupConfig): DiscountTier[] {
  return group.rules.flatMap((r) => (r.kind === "tieredPercent" ? r.tiers : []));
}

function formatPercentBps(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2).replace(/0+$/, "")}%`;
}

/** "4% from ₹0 · 6% from ₹25,000" */
function tierSummary(tiers: DiscountTier[]): string {
  if (tiers.length === 0) return "No discount tiers";
  return tiers
    .slice()
    .sort((a, b) => a.fromPaise - b.fromPaise)
    .map((t) => `${formatPercentBps(t.percentBps)} from ${formatPaise(t.fromPaise)}`)
    .join(" · ");
}

/** "Dealer brands" → "DB"; "Samsung" → "SAM". */
function suggestCode(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "";
  const code = words.length === 1 ? words[0].slice(0, 3) : words.map((w) => w[0]).join("");
  const trimmed = code.slice(0, 6);
  return trimmed.length >= 2 ? trimmed : trimmed.padEnd(2, "X");
}

/* ------------------------------------------------------------------ */
/* Manager                                                             */
/* ------------------------------------------------------------------ */

export function BillingGroupsManager({
  groups,
  brands,
}: {
  groups: BillingGroupConfig[];
  brands: BrandOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<BillingGroupConfig | null | "new">(null);
  const [openKey, setOpenKey] = React.useState(0);

  const brandName = React.useMemo(() => {
    const map = new Map(brands.map((b) => [b.id, b.name]));
    return (id: string) => map.get(id) ?? "Unknown brand";
  }, [brands]);

  // brandId → the ACTIVE groups that claim it (for the overlap warning).
  const activeClaims = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const g of groups) {
      if (!g.active) continue;
      for (const id of g.matcher.brandIds) {
        map.set(id, [...(map.get(id) ?? []), g.id]);
      }
    }
    return map;
  }, [groups]);

  function openCreate() {
    setOpenKey((k) => k + 1);
    setEditing("new");
  }
  function openEdit(group: BillingGroupConfig) {
    setOpenKey((k) => k + 1);
    setEditing(group);
  }

  return (
    <div className="space-y-6">
      {/* Intro */}
      <section className="flex gap-3 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Layers className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="font-heading text-base font-semibold tracking-tight">
            How billing groups work
          </h2>
          <p className="text-sm text-muted-foreground">
            Carts split into buckets by brand; each bucket gets its own tiered discount
            and bill page. Everything not in a group is &ldquo;General&rdquo;. When two
            active groups claim the same brand, the one sorted first wins.
          </p>
        </div>
        {groups.length > 0 ? (
          <Button onClick={openCreate} className="hidden shrink-0 sm:inline-flex">
            <Plus aria-hidden />
            New group
          </Button>
        ) : null}
      </section>

      {groups.length > 0 ? (
        <div className="flex sm:hidden">
          <Button onClick={openCreate} className="w-full">
            <Plus aria-hidden />
            New group
          </Button>
        </div>
      ) : null}

      {/* List */}
      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card">
          <EmptyState
            title="No billing groups yet"
            description="Create a group to give a set of brands its own tiered discount and separate bill."
            action={
              <Button onClick={openCreate}>
                <Plus aria-hidden />
                Create your first group
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={group.id}>
              <GroupCard
                group={group}
                brandName={brandName}
                overlaps={
                  group.active &&
                  group.matcher.brandIds.some(
                    (id) => (activeClaims.get(id)?.length ?? 0) > 1,
                  )
                }
                onEdit={() => openEdit(group)}
                onChanged={() => router.refresh()}
              />
            </li>
          ))}
        </ul>
      )}

      <GroupSheet
        key={openKey}
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        initial={editing === "new" || editing === null ? null : editing}
        brands={brands}
        existingCodes={groups
          .filter((g) => editing === "new" || editing === null || g.id !== editing.id)
          .map((g) => g.code)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Group card                                                          */
/* ------------------------------------------------------------------ */

function GroupCard({
  group,
  brandName,
  overlaps,
  onEdit,
  onChanged,
}: {
  group: BillingGroupConfig;
  brandName: (id: string) => string;
  overlaps: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [active, setActive] = React.useState(group.active);
  const [pending, startTransition] = React.useTransition();
  const tiers = tiersOf(group);

  // Keep the optimistic switch in sync when the server row changes.
  const [prevActive, setPrevActive] = React.useState(group.active);
  if (group.active !== prevActive) {
    setPrevActive(group.active);
    setActive(group.active);
  }

  function toggle(next: boolean) {
    const before = active;
    setActive(next);
    startTransition(async () => {
      const res = await setBillingGroupActiveAction({ id: group.id, active: next });
      if (res.ok) {
        toast.success(next ? `${group.name} is on` : `${group.name} is off`);
        onChanged();
      } else {
        setActive(before);
        toast.error(res.error);
      }
    });
  }

  async function remove() {
    const res = await deleteBillingGroupAction({ id: group.id });
    if (!res.ok) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    toast.success(`Deleted ${group.name}`);
    onChanged();
  }

  return (
    <article
      className={cn(
        "rounded-xl border border-border bg-card p-4 text-card-foreground shadow-xs transition-opacity",
        !active && "opacity-70",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn("mt-1.5 size-3 shrink-0 rounded-full", dotClass(group.color))}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-heading text-base font-semibold tracking-tight">
              {group.name}
            </h3>
            <Badge variant="outline" className="font-mono">
              {group.code}
            </Badge>
            {!active ? <Badge variant="secondary">Off</Badge> : null}
            {group.separateBill ? <Badge variant="secondary">Billed separately</Badge> : null}
            {group.couponStacking ? <Badge variant="secondary">Coupons stack</Badge> : null}
            {overlaps ? (
              <Tooltip content="A brand in this group is also in another active group. The group sorted first wins.">
                <Badge variant="destructive" tabIndex={0}>
                  <AlertTriangle aria-hidden />
                  Overlap
                </Badge>
              </Tooltip>
            ) : null}
          </div>

          <p className="text-sm text-muted-foreground">{tierSummary(tiers)}</p>

          {group.matcher.brandIds.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {group.matcher.brandIds.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs"
                >
                  {brandName(id)}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No brands selected.</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Tooltip content={active ? "Turn off" : "Turn on"}>
            <Switch
              checked={active}
              disabled={pending}
              onCheckedChange={(next) => toggle(next === true)}
              aria-label={`${group.name} active`}
            />
          </Tooltip>
          <div className="flex items-center gap-1">
            <Tooltip content="Edit">
              <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit ${group.name}`}>
                <Pencil aria-hidden />
              </Button>
            </Tooltip>
            <ConfirmSheet
              title={`Delete ${group.name}?`}
              description="Placed orders keep their bill snapshots. Live carts re-bucket on their next load — these brands fall back to General."
              destructive
              confirmLabel="Delete"
              onConfirm={remove}
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${group.name}`}>
                  <Trash2 aria-hidden />
                </Button>
              }
            />
          </div>
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Create / edit sheet                                                 */
/* ------------------------------------------------------------------ */

interface TierRow {
  key: number;
  from: string; // rupees text
  percent: string; // percent text
}

const EXAMPLE_TIERS: TierRow[] = [
  { key: 1, from: "0", percent: "4" },
  { key: 2, from: "25,000", percent: "6" },
];

function toRows(tiers: DiscountTier[]): TierRow[] {
  return tiers.map((t, i) => ({
    key: i + 1,
    from: formatPaise(t.fromPaise).replace(/^₹\s?/, ""),
    percent: String(t.percentBps / 100),
  }));
}

function parseRow(row: TierRow): { tier: DiscountTier | null; error: string | null } {
  const fromPaise = row.from.trim() === "" ? 0 : parseRupees(row.from);
  if (fromPaise === null) return { tier: null, error: "Enter a valid amount" };
  const pct = Number(row.percent);
  if (row.percent.trim() === "" || !Number.isFinite(pct)) {
    return { tier: null, error: "Enter a percentage" };
  }
  if (pct < 0 || pct > 100) return { tier: null, error: "0–100%" };
  return { tier: { fromPaise, percentBps: Math.round(pct * 100) }, error: null };
}

function GroupSheet({
  open,
  onOpenChange,
  initial,
  brands,
  existingCodes,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: BillingGroupConfig | null;
  brands: BrandOption[];
  existingCodes: string[];
  onSaved: () => void;
}) {
  const isMobile = useIsMobile();
  const isEdit = initial !== null;

  const [name, setName] = React.useState(initial?.name ?? "");
  const [code, setCode] = React.useState(initial?.code ?? "");
  const [codeTouched, setCodeTouched] = React.useState(isEdit);
  const [color, setColor] = React.useState<GroupColor>(
    initial && isGroupColor(initial.color) ? initial.color : "blue",
  );
  const [sortOrder, setSortOrder] = React.useState(String(initial?.sortOrder ?? 0));
  const [brandIds, setBrandIds] = React.useState<string[]>(initial?.matcher.brandIds ?? []);
  const [rows, setRows] = React.useState<TierRow[]>(
    initial ? toRows(tiersOf(initial)) : [{ key: 1, from: "0", percent: "" }],
  );
  const nextKey = React.useRef(rows.length + 1);
  const [separateBill, setSeparateBill] = React.useState(initial?.separateBill ?? true);
  const [couponStacking, setCouponStacking] = React.useState(initial?.couponStacking ?? true);
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const [tryAmount, setTryAmount] = React.useState("30,000");
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Impact line — debounced whenever the brand set changes.
  const [impact, setImpact] = React.useState<number | null>(null);
  const [impactLoading, setImpactLoading] = React.useState(false);
  const brandKey = brandIds.slice().sort().join(",");
  React.useEffect(() => {
    // An empty brand set renders its own copy — nothing to fetch.
    if (!open || brandKey === "") return;
    let cancelled = false;
    // Debounced; all state writes happen inside the async callback so the
    // effect body itself never sets state synchronously.
    const handle = setTimeout(async () => {
      setImpactLoading(true);
      const res = await previewBillingGroupImpactAction({ brandIds: brandKey.split(",") });
      if (cancelled) return;
      setImpact(res.ok ? res.liveCarts : null);
      setImpactLoading(false);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [brandKey, open]);

  /* Derived validation ---------------------------------------------- */

  const trimmedCode = code.trim().toUpperCase();
  const codeError =
    trimmedCode === ""
      ? null
      : !/^[A-Z0-9]{2,6}$/.test(trimmedCode)
        ? "2–6 letters or digits"
        : trimmedCode === "GEN"
          ? "GEN is reserved for General"
          : existingCodes.includes(trimmedCode)
            ? "Already used by another group"
            : null;

  const parsedRows = rows.map(parseRow);
  const rowErrors: (string | null)[] = parsedRows.map((r) => r.error);
  const validTiers = parsedRows.flatMap((r) => (r.tier ? [r.tier] : []));
  // Cross-row rules: ascending floors (unique), strictly increasing %.
  let tiersError: string | null = null;
  if (validTiers.length === parsedRows.length) {
    const sorted = validTiers.slice().sort((a, b) => a.fromPaise - b.fromPaise);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].fromPaise === sorted[i - 1].fromPaise) {
        tiersError = "Two tiers start at the same amount";
        break;
      }
      if (sorted[i].percentBps <= sorted[i - 1].percentBps) {
        tiersError = "A higher tier must give a bigger discount than the one below it";
        break;
      }
    }
  }

  const tryPaise = parseRupees(tryAmount);
  const preview =
    tryPaise !== null && validTiers.length > 0 && !tiersError
      ? resolveTier(validTiers, tryPaise)
      : null;
  const previewDiscount =
    preview?.applied && tryPaise !== null
      ? percentOfPaise(tryPaise, preview.applied.percentBps)
      : 0;

  /* Handlers -------------------------------------------------------- */

  function handleNameChange(next: string) {
    setName(next);
    if (!codeTouched) setCode(suggestCode(next));
  }

  function useExample() {
    if (name.trim() === "") setName("Dealer brands");
    if (!codeTouched || code.trim() === "") setCode("DLR");
    setRows(EXAMPLE_TIERS.map((r) => ({ ...r, key: nextKey.current++ })));
  }

  function addRow() {
    setRows((rs) => [...rs, { key: nextKey.current++, from: "", percent: "" }]);
  }
  function updateRow(key: number, patch: Partial<TierRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeRow(key: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    if (name.trim().length < 2) return toast.error("Give the group a name.");
    if (trimmedCode === "" || codeError) return toast.error("Fix the code before saving.");
    if (brandIds.length === 0) return toast.error("Pick at least one brand.");
    if (rowErrors.some(Boolean) || tiersError) return toast.error("Fix the discount tiers.");
    const order = Number(sortOrder);
    if (!Number.isInteger(order) || order < 0 || order > 1000) {
      return toast.error("Sort order must be a whole number between 0 and 1000.");
    }

    const payload: BillingGroupInput & { id?: string } = {
      id: initial?.id,
      name: name.trim(),
      code: trimmedCode,
      color,
      active: initial?.active ?? true,
      sortOrder: order,
      matcher: { kind: "brands", brandIds },
      rules: [
        {
          kind: "tieredPercent",
          tiers: validTiers.slice().sort((a, b) => a.fromPaise - b.fromPaise),
        },
      ],
      separateBill,
      couponStacking,
      notes: notes.trim() === "" ? null : notes.trim(),
    };

    startTransition(async () => {
      try {
        const res = await saveBillingGroupAction(payload);
        if (res.ok) {
          toast.success(isEdit ? "Billing group updated" : "Billing group created");
          onSaved();
        } else {
          setServerError(res.error);
          toast.error(res.error);
        }
      } catch {
        const msg = "Could not save the billing group.";
        setServerError(msg);
        toast.error(msg);
      }
    });
  }

  /* Render ---------------------------------------------------------- */

  const body = (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="pr-12">
        <SheetTitle>{isEdit ? `Edit ${initial.name}` : "New billing group"}</SheetTitle>
        <SheetDescription>
          {isEdit
            ? "Changes apply to live carts immediately."
            : "Pick the brands, set the tiers, and preview the discount before saving."}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-4">
        {!isEdit ? (
          <Button type="button" variant="outline" size="sm" onClick={useExample}>
            <Sparkles aria-hidden />
            Use example: Dealer brands 4%/6%
          </Button>
        ) : null}

        {/* Basics */}
        <Section title="Basics">
          <Field label="Name" htmlFor="bg-name">
            <Input
              id="bg-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Dealer brands"
              maxLength={60}
              autoFocus={!isMobile}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Code" htmlFor="bg-code" hint="Printed on the bill number, e.g. MD-A1B2/DLR" error={codeError}>
              <Input
                id="bg-code"
                value={code}
                onChange={(e) => {
                  setCodeTouched(true);
                  setCode(e.target.value.toUpperCase());
                }}
                placeholder="DLR"
                maxLength={6}
                autoCapitalize="characters"
                className="font-mono"
                aria-invalid={codeError ? true : undefined}
              />
            </Field>
            <Field label="Sort order" htmlFor="bg-sort" hint="Lower sorts first; wins on brand overlap.">
              <Input
                id="bg-sort"
                type="number"
                inputMode="numeric"
                min={0}
                max={1000}
                step={1}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </Field>
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div role="radiogroup" aria-label="Group color" className="flex flex-wrap gap-2">
              {GROUP_COLORS.map((c) => (
                <Tooltip key={c} content={COLOR_LABEL[c]}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={color === c}
                    aria-label={COLOR_LABEL[c]}
                    onClick={() => setColor(c)}
                    className={cn(
                      "size-7 rounded-full border-2 transition-transform outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      DOT_CLASS[c],
                      color === c
                        ? "scale-110 border-foreground"
                        : "border-transparent hover:scale-105",
                    )}
                  />
                </Tooltip>
              ))}
            </div>
          </div>
        </Section>

        {/* Brands */}
        <Section
          title="Brands"
          description="Products from these brands land in this bucket."
        >
          <BrandPicker brands={brands} value={brandIds} onChange={setBrandIds} />
        </Section>

        {/* Tiers */}
        <Section
          title="Discount tiers"
          description="The highest floor the bucket subtotal reaches wins."
        >
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={row.key} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
                      From ₹
                    </span>
                    <Input
                      value={row.from}
                      inputMode="decimal"
                      onChange={(e) => updateRow(row.key, { from: e.target.value })}
                      placeholder="0"
                      className="pl-16"
                      aria-label={`Tier ${i + 1} from amount in rupees`}
                      aria-invalid={rowErrors[i] ? true : undefined}
                    />
                  </div>
                </div>
                <span aria-hidden className="pt-2 text-sm text-muted-foreground">→</span>
                <div className="w-24 shrink-0">
                  <div className="relative">
                    <Input
                      value={row.percent}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step="0.01"
                      onChange={(e) => updateRow(row.key, { percent: e.target.value })}
                      placeholder="4"
                      className="pr-7"
                      aria-label={`Tier ${i + 1} discount percent`}
                      aria-invalid={rowErrors[i] ? true : undefined}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">
                      %
                    </span>
                  </div>
                </div>
                <Tooltip content="Remove tier">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={rows.length === 1}
                    onClick={() => removeRow(row.key)}
                    aria-label={`Remove tier ${i + 1}`}
                  >
                    <X aria-hidden />
                  </Button>
                </Tooltip>
              </div>
            ))}
            {rowErrors.some(Boolean) ? (
              <p className="text-xs text-destructive">
                {rowErrors.find(Boolean)}
              </p>
            ) : tiersError ? (
              <p className="text-xs text-destructive">{tiersError}</p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={rows.length >= 10}
            >
              <Plus aria-hidden />
              Add tier
            </Button>
          </div>
        </Section>

        {/* Billing */}
        <Section title="Billing">
          <SwitchRow
            id="bg-separate"
            label="Bill separately"
            hint="Print this bucket on its own bill page with its own sub-number."
            checked={separateBill}
            onChange={setSeparateBill}
          />
          <SwitchRow
            id="bg-coupon"
            label="Coupons stack"
            hint="Allow a coupon on top of this group's discount."
            checked={couponStacking}
            onChange={setCouponStacking}
          />
          <Field label="Notes" htmlFor="bg-notes" hint="Printed under this bucket's bill (optional).">
            <textarea
              id="bg-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Terms, payment instructions…"
              className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </Field>
        </Section>

        {/* Live preview */}
        <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Live preview
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Label htmlFor="bg-try" className="shrink-0 text-sm">
              Try a bucket amount ₹
            </Label>
            <Input
              id="bg-try"
              value={tryAmount}
              inputMode="decimal"
              onChange={(e) => setTryAmount(e.target.value)}
              className="max-w-36"
            />
          </div>
          <p className="mt-2 text-sm">
            {tryPaise === null ? (
              <span className="text-muted-foreground">Enter an amount to preview.</span>
            ) : validTiers.length === 0 || tiersError ? (
              <span className="text-muted-foreground">Complete the tiers to preview.</span>
            ) : preview?.applied ? (
              <>
                <span className="font-medium text-foreground">
                  {formatPercentBps(preview.applied.percentBps)} tier fires
                </span>{" "}
                <span className="text-muted-foreground">→ discount</span>{" "}
                <span className="font-semibold">{formatPaise(previewDiscount)}</span>{" "}
                <span className="text-muted-foreground">
                  · pay {formatPaise(tryPaise - previewDiscount)}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">No tier fires at this amount.</span>
            )}
            {preview?.next ? (
              <span className="block text-xs text-muted-foreground">
                Add {formatPaise(preview.next.remainingPaise)} more to reach{" "}
                {formatPercentBps(preview.next.tier.percentBps)}.
              </span>
            ) : null}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {brandIds.length === 0
              ? "Pick brands to see how many live carts this touches."
              : impactLoading
                ? "Checking live carts…"
                : impact === null
                  ? "Could not load cart impact."
                  : `${impact} ${impact === 1 ? "customer" : "customers"} currently ${
                      impact === 1 ? "has" : "have"
                    } these brands in their cart.`}
          </p>
        </section>

        {serverError ? (
          <p role="alert" className="text-sm text-destructive">
            {serverError}
          </p>
        ) : null}
      </div>

      <SheetFooter className="border-t border-border sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Create group"}
        </Button>
      </SheetFooter>
    </form>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "gap-0 p-0",
          isMobile
            ? "h-[100dvh] rounded-none pb-[env(safe-area-inset-bottom)]"
            : "w-full sm:max-w-lg",
        )}
      >
        {open ? body : null}
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Brand multi-picker (client-side filter over the server list)        */
/* ------------------------------------------------------------------ */

function BrandPicker({
  brands,
  value,
  onChange,
}: {
  brands: BrandOption[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const chosen = new Set(value);
  const byId = new Map(brands.map((b) => [b.id, b]));

  const q = query.trim().toLowerCase();
  const results = (q === "" ? brands : brands.filter((b) => b.name.toLowerCase().includes(q))).slice(
    0,
    30,
  );

  function add(id: string) {
    if (chosen.has(id)) return;
    onChange([...value, id]);
    setQuery("");
    setOpen(false);
  }
  function remove(id: string) {
    onChange(value.filter((v) => v !== id));
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter") {
              e.preventDefault();
              const first = results.find((b) => !chosen.has(b.id));
              if (first) add(first.id);
            }
          }}
          placeholder="Search brands to add…"
          className="pl-8"
          aria-label="Search brands to add"
          aria-expanded={open}
          aria-controls="bg-brand-results"
        />
        {open ? (
          <ul
            id="bg-brand-results"
            role="listbox"
            aria-label="Matching brands"
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
          >
            {results.length === 0 ? (
              <li className="px-2.5 py-2 text-sm text-muted-foreground">
                {brands.length === 0 ? "No active brands yet." : `No brands match “${query}”.`}
              </li>
            ) : (
              results.map((b) => {
                const taken = chosen.has(b.id);
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={taken}
                      disabled={taken}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        add(b.id);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm",
                        taken ? "cursor-default text-muted-foreground" : "hover:bg-muted",
                      )}
                    >
                      <span className="truncate">{b.name}</span>
                      {taken ? <span className="ml-2 shrink-0 text-xs">Added</span> : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
      </div>

      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => {
            const label = byId.get(id)?.name ?? "Unknown brand";
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pr-1 pl-2.5 text-xs"
              >
                {label}
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={() => remove(id)}
                  className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X aria-hidden className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No brands yet — pick at least one.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Local layout helpers                                                */
/* ------------------------------------------------------------------ */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function SwitchRow({
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
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 p-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={(n) => onChange(n === true)} />
    </div>
  );
}
