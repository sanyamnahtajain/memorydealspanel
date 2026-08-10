"use client";

import * as React from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatPaise, parseRupees } from "@/lib/money";
import type { CouponDTO } from "@/server/services/coupons";
import {
  createCouponAction,
  updateCouponAction,
  deleteCouponAction,
} from "@/server/actions/coupons";
import { listProductsAction } from "@/server/actions/products";

/**
 * CouponsManager — the admin surface for coupon codes: list with live usage,
 * create/edit dialog (percent or flat value, validity window, redemption
 * caps), and OPTIONAL product scoping — a coupon like "AMBRANE10" limited to
 * six specific products discounts only those lines, however big the cart.
 */

interface ScopedProduct {
  id: string;
  name: string;
  sku: string;
}

interface FormState {
  code: string;
  kind: "PERCENT" | "FIXED";
  /** PERCENT: human percent text ("5", "12.5"). */
  percentInput: string;
  /** FIXED: rupee text ("200"). */
  amountInput: string;
  minOrderInput: string;
  startsAt: string; // yyyy-mm-dd or ""
  expiresAt: string;
  maxRedemptionsInput: string;
  perCustomerLimitInput: string;
  products: ScopedProduct[];
  active: boolean;
}

function blankForm(): FormState {
  return {
    code: "",
    kind: "PERCENT",
    percentInput: "",
    amountInput: "",
    minOrderInput: "",
    startsAt: "",
    expiresAt: "",
    maxRedemptionsInput: "",
    perCustomerLimitInput: "",
    products: [],
    active: true,
  };
}

function dateToInput(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

/** Offer label for the table, e.g. "5% off" / "₹200 off". */
function offerLabel(c: CouponDTO): string {
  return c.kind === "PERCENT"
    ? `${(c.valueBps ?? 0) / 100}% off`
    : `${formatPaise(c.amountPaise ?? 0)} off`;
}

export function CouponsManager({
  initialCoupons,
  initialScopedProducts,
}: {
  initialCoupons: CouponDTO[];
  /** id → {name, sku} for every product referenced by a coupon scope. */
  initialScopedProducts: Record<string, { name: string; sku: string }>;
}) {
  const [coupons, setCoupons] = React.useState(initialCoupons);
  const scopedNames = React.useRef(new Map(Object.entries(initialScopedProducts)));

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CouponDTO | null>(null);
  const [form, setForm] = React.useState<FormState>(blankForm());
  const [busy, setBusy] = React.useState(false);

  // Product scope search
  const [productQuery, setProductQuery] = React.useState("");
  const [productResults, setProductResults] = React.useState<ScopedProduct[]>([]);
  const [searching, setSearching] = React.useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Debounced product search against the admin list action. The clear for a
  // short/closed query ALSO goes through the timer so the effect never sets
  // state synchronously (react-hooks/set-state-in-effect).
  React.useEffect(() => {
    const q = productQuery.trim();
    if (!open || q.length < 2) {
      const clear = window.setTimeout(() => setProductResults([]), 0);
      return () => window.clearTimeout(clear);
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await listProductsAction({ search: q, take: 8 });
        if (res.ok) {
          setProductResults(
            res.products.map((p) => ({ id: p.id, name: p.name, sku: p.sku })),
          );
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [productQuery, open]);

  function openCreate() {
    setEditing(null);
    setForm(blankForm());
    setProductQuery("");
    setOpen(true);
  }

  function openEdit(coupon: CouponDTO) {
    setEditing(coupon);
    setForm({
      code: coupon.code,
      kind: coupon.kind,
      percentInput:
        coupon.kind === "PERCENT" && coupon.valueBps != null
          ? String(coupon.valueBps / 100)
          : "",
      amountInput:
        coupon.kind === "FIXED" && coupon.amountPaise != null
          ? String(Math.round(coupon.amountPaise / 100))
          : "",
      minOrderInput:
        coupon.minOrderPaise > 0 ? String(Math.round(coupon.minOrderPaise / 100)) : "",
      startsAt: dateToInput(coupon.startsAt),
      expiresAt: dateToInput(coupon.expiresAt),
      maxRedemptionsInput:
        coupon.maxRedemptions != null ? String(coupon.maxRedemptions) : "",
      perCustomerLimitInput:
        coupon.perCustomerLimit != null ? String(coupon.perCustomerLimit) : "",
      products: coupon.productIds.map((id) => ({
        id,
        name: scopedNames.current.get(id)?.name ?? "Product",
        sku: scopedNames.current.get(id)?.sku ?? id,
      })),
      active: coupon.active,
    });
    setProductQuery("");
    setOpen(true);
  }

  async function submit() {
    const percent = Number(form.percentInput);
    const valueBps =
      form.kind === "PERCENT" && form.percentInput.trim() !== "" && Number.isFinite(percent)
        ? Math.round(percent * 100)
        : undefined;
    const amountPaise =
      form.kind === "FIXED" ? (parseRupees(form.amountInput) ?? undefined) : undefined;
    const minOrderPaise =
      form.minOrderInput.trim() === "" ? 0 : (parseRupees(form.minOrderInput) ?? 0);
    const maxRedemptions =
      form.maxRedemptionsInput.trim() === ""
        ? null
        : Number(form.maxRedemptionsInput);
    const perCustomerLimit =
      form.perCustomerLimitInput.trim() === ""
        ? null
        : Number(form.perCustomerLimitInput);

    const shared = {
      kind: form.kind,
      valueBps,
      amountPaise,
      minOrderPaise,
      startsAt: form.startsAt ? new Date(`${form.startsAt}T00:00:00`) : null,
      expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`) : null,
      maxRedemptions,
      perCustomerLimit,
      productIds: form.products.map((p) => p.id),
      active: form.active,
    };

    setBusy(true);
    try {
      const result = editing
        ? await updateCouponAction(editing.id, shared)
        : await createCouponAction({ ...shared, code: form.code });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      for (const p of form.products) {
        scopedNames.current.set(p.id, { name: p.name, sku: p.sku });
      }
      setCoupons((prev) =>
        editing
          ? prev.map((c) => (c.id === editing.id ? result.coupon : c))
          : [result.coupon, ...prev],
      );
      toast.success(editing ? "Coupon updated." : `Coupon ${result.coupon.code} created.`);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(coupon: CouponDTO, active: boolean) {
    const result = await updateCouponAction(coupon.id, { active });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setCoupons((prev) => prev.map((c) => (c.id === coupon.id ? result.coupon : c)));
  }

  async function remove(coupon: CouponDTO) {
    if (!window.confirm(`Delete coupon ${coupon.code}? Customers can no longer use it.`)) {
      return;
    }
    const result = await deleteCouponAction(coupon.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setCoupons((prev) => prev.filter((c) => c.id !== coupon.id));
    toast.success("Coupon deleted.");
  }

  const chosenIds = new Set(form.products.map((p) => p.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {coupons.length} coupon{coupons.length === 1 ? "" : "s"}
        </p>
        <Button onClick={openCreate}>
          <Plus className="size-4" aria-hidden />
          New coupon
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Offer</th>
              <th className="px-3 py-2 font-medium">Min order</th>
              <th className="px-3 py-2 font-medium">Validity</th>
              <th className="px-3 py-2 font-medium">Used</th>
              <th className="px-3 py-2 font-medium">Scope</th>
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {coupons.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No coupons yet — create one to offer a discount at checkout.
                </td>
              </tr>
            ) : null}
            {coupons.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => openEdit(c)}
                    className="rounded border border-dashed border-foreground/30 px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide hover:border-foreground/60"
                  >
                    {c.code}
                  </button>
                </td>
                <td className="px-3 py-2">{offerLabel(c)}</td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">
                  {c.minOrderPaise > 0 ? formatPaise(c.minOrderPaise) : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {c.startsAt ? new Date(c.startsAt).toLocaleDateString("en-IN") : "Now"}
                  {" → "}
                  {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("en-IN") : "No expiry"}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {c.redemptionCount}
                  {c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ""}
                </td>
                <td className="px-3 py-2">
                  {c.productIds.length > 0 ? (
                    <Badge variant="secondary">{c.productIds.length} products</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Whole cart</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Switch
                    checked={c.active}
                    onCheckedChange={(v) => toggleActive(c, v)}
                    aria-label={`${c.code} active`}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(c)}
                      className="h-8"
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive"
                      aria-label={`Delete ${c.code}`}
                      onClick={() => remove(c)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.code}` : "New coupon"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "The code itself can't change — retire this coupon and mint a new code instead."
                : "Customers apply the code on their cart; the discount is validated and locked in server-side."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!editing ? (
              <div className="space-y-1.5">
                <Label htmlFor="coupon-code">Code</Label>
                <Input
                  id="coupon-code"
                  value={form.code}
                  onChange={(e) =>
                    set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))
                  }
                  placeholder="AMBRANE10"
                  autoCapitalize="characters"
                  className="font-mono uppercase"
                />
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="coupon-kind">Type</Label>
                <Select
                  value={form.kind}
                  onValueChange={(v) => set("kind", v as "PERCENT" | "FIXED")}
                >
                  <SelectTrigger id="coupon-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENT">Percent off</SelectItem>
                    <SelectItem value="FIXED">Flat ₹ off</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-value">
                  {form.kind === "PERCENT" ? "Percent (%)" : "Amount (₹)"}
                </Label>
                <Input
                  id="coupon-value"
                  inputMode="decimal"
                  value={form.kind === "PERCENT" ? form.percentInput : form.amountInput}
                  onChange={(e) =>
                    form.kind === "PERCENT"
                      ? set("percentInput", e.target.value.replace(/[^\d.]/g, ""))
                      : set("amountInput", e.target.value.replace(/[^\d.]/g, ""))
                  }
                  placeholder={form.kind === "PERCENT" ? "10" : "200"}
                  className="font-tabular"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="coupon-min">Min order (₹, optional)</Label>
                <Input
                  id="coupon-min"
                  inputMode="decimal"
                  value={form.minOrderInput}
                  onChange={(e) => set("minOrderInput", e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="—"
                  className="font-tabular"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-max">Total uses (optional)</Label>
                <Input
                  id="coupon-max"
                  inputMode="numeric"
                  value={form.maxRedemptionsInput}
                  onChange={(e) =>
                    set("maxRedemptionsInput", e.target.value.replace(/[^\d]/g, ""))
                  }
                  placeholder="Unlimited"
                  className="font-tabular"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="coupon-start">Starts (optional)</Label>
                <Input
                  id="coupon-start"
                  type="date"
                  value={form.startsAt}
                  onChange={(e) => set("startsAt", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-end">Expires (optional)</Label>
                <Input
                  id="coupon-end"
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => set("expiresAt", e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="coupon-per-customer">Uses per customer (optional)</Label>
              <Input
                id="coupon-per-customer"
                inputMode="numeric"
                value={form.perCustomerLimitInput}
                onChange={(e) =>
                  set("perCustomerLimitInput", e.target.value.replace(/[^\d]/g, ""))
                }
                placeholder="Unlimited"
                className="font-tabular w-40"
              />
            </div>

            {/* Product scoping */}
            <div className="space-y-1.5">
              <Label>Limit to products (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Leave empty to apply to the whole cart. With products selected,
                the discount computes only on those items.
              </p>
              {form.products.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {form.products.map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                    >
                      <span className="max-w-40 truncate">{p.name}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${p.name}`}
                        onClick={() =>
                          set("products", form.products.filter((x) => x.id !== p.id))
                        }
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="relative">
                <Search
                  aria-hidden
                  className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="Search products by name or SKU…"
                  className="pl-8"
                />
                {productResults.length > 0 ? (
                  <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
                    {productResults
                      .filter((p) => !chosenIds.has(p.id))
                      .map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => {
                              set("products", [...form.products, p]);
                              setProductQuery("");
                            }}
                            className={cn(
                              "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none",
                              "hover:bg-muted focus-visible:bg-muted",
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{p.sku}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                ) : null}
              </div>
              {searching ? (
                <p className="text-[0.7rem] text-muted-foreground">Searching…</p>
              ) : null}
            </div>

            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-input px-3 py-2.5">
              <span className="text-sm font-medium">Active</span>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => set("active", v)}
                aria-label="Coupon active"
              />
            </label>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy}>
                {busy ? "Saving…" : editing ? "Save changes" : "Create coupon"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
