"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseRupees, formatPaise } from "@/lib/money";
import {
  createProductSchema,
  type CreateProductInput,
} from "@/lib/schemas/product";
import type { ProductImageInput } from "@/lib/schemas/product";
import type { PricedProduct } from "@/server/dto/product";
import type { EntityStatus, StockStatus } from "@/lib/schemas/shared";
import type { TaxTreatment } from "@/lib/gst";
import type { EffectiveTax } from "@/lib/tax-inherit";
import {
  createProductAction,
  updateProductAction,
} from "@/server/actions/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FadeUp } from "@/components/motion/primitives";
import type { BrandOption } from "@/server/services/brands";
import { BrandField } from "./BrandField";
import {
  SpecEditor,
  newSpecRow,
  rowsToSpecs,
  specsToRows,
  type SpecRow,
} from "./SpecEditor";
import { TagEditor } from "./TagEditor";
import { ProductImagesField } from "./ProductImagesField";
import { VariantsSection } from "./variants";
import { variantsActions as wiredVariantsActions } from "./variants/actions";
import type {
  EditorVariant,
  OptionType,
  VariantsActions,
} from "./variants";

/** Minimal category shape the editor needs for its select. */
export interface EditorCategory {
  id: string;
  name: string;
  parentId: string | null;
}

/** The product data used to seed the form when editing. */
export type EditorProduct = Pick<
  PricedProduct,
  | "id"
  | "categoryId"
  | "name"
  | "sku"
  | "brand"
  | "brandRef"
  | "description"
  | "price"
  | "mrp"
  | "moq"
  | "stockStatus"
  | "status"
  | "tags"
  | "images"
  | "specs"
> & {
  /** Whether variants are enabled (Product.hasVariants). Defaults to false. */
  hasVariants?: boolean;
  /** The product's option axes (Product.optionTypes), when it has variants. */
  optionTypes?: OptionType[];
  /** The product's variant rows mapped for the editor. */
  variants?: EditorVariant[];
  /**
   * The product's OWN GST overrides (raw stored values). `null` on any field
   * means "inherit" (defer to the category / seller profile). Non-monetary.
   */
  hsnCode?: string | null;
  gstRateBps?: number | null;
  taxTreatment?: TaxTreatment | null;
};

/**
 * The tax the editor uses for its "inherit" helper text: what would apply if
 * the product overrode nothing (resolved from category defaults → seller
 * profile). Supplied by the server page; `null` when the GST kill-switch is
 * off, in which case the whole GST section is hidden.
 */
export type EditorTaxContext = {
  /** The category → profile fallback (product overrides removed). */
  inherited: EffectiveTax;
};

export interface ProductEditorFormProps {
  categories: EditorCategory[];
  /**
   * Active brands for the brand dropdown. INTEGRATOR: the server page must load
   * these via `listActiveBrands()` (from @/server/services/brands) and pass
   * them here — the editor does not fetch them itself.
   */
  brands: BrandOption[];
  /** Present when editing; omit for a create form. */
  product?: EditorProduct;
  /**
   * GST context for the tax section. When omitted (or `inherited` absent) the
   * GST kill-switch is off and the tax section is hidden entirely, so the editor
   * behaves exactly as pre-GST. INTEGRATOR: the server page resolves this via
   * `resolveEffectiveTax` over the chosen category defaults + seller profile.
   */
  tax?: EditorTaxContext;
  /**
   * Server mutations for variants, injected so the editor stays decoupled from
   * the server half. INTEGRATOR: wire `saveProductVariantsAction` here (see
   * components/admin/products/variants/actions.ts). Defaults to a no-op that
   * shows a "not connected" toast, so the UI never crashes if left unwired.
   */
  variantsActions?: VariantsActions;
}

const STOCK_OPTIONS: { value: StockStatus; label: string }[] = [
  { value: "IN_STOCK", label: "In stock" },
  { value: "LOW", label: "Low stock" },
  { value: "OUT_OF_STOCK", label: "Out of stock" },
];

interface FormState {
  categoryId: string;
  name: string;
  sku: string;
  brandId: string | null;
  description: string;
  /** Raw ₹ text inputs; converted to paise on submit. */
  priceInput: string;
  mrpInput: string;
  moq: string;
  stockStatus: StockStatus;
  status: EntityStatus;
  tags: string[];
  specRows: SpecRow[];
  images: ProductImageInput[];
  /** Raw HSN override text; empty = inherit. */
  hsnInput: string;
  /** Raw GST-rate override as a percent string; empty = inherit. */
  gstPercentInput: string;
  /** Treatment override; null = inherit the profile default. */
  taxTreatment: TaxTreatment | null;
}

/** bps (1800) -> editable percent string ("18", "18.5"); "" when null. */
function bpsToPercentInput(bps: number | null | undefined): string {
  if (bps == null) return "";
  return String(bps / 100);
}

/** percent string -> integer bps, or null when blank/invalid. */
function percentInputToBps(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const pct = Number(trimmed);
  if (!Number.isFinite(pct) || pct < 0) return null;
  return Math.round(pct * 100);
}

/** paise -> editable rupee string ("49950" -> "499.50", "49900" -> "499"). */
function paiseToInput(paise: number | null | undefined): string {
  if (paise == null) return "";
  const rupees = Math.trunc(paise / 100);
  const fraction = paise % 100;
  return fraction === 0
    ? String(rupees)
    : `${rupees}.${String(fraction).padStart(2, "0")}`;
}

function buildInitialState(product?: EditorProduct): FormState {
  return {
    categoryId: product?.categoryId ?? "",
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    brandId: product?.brandRef?.id ?? null,
    description: product?.description ?? "",
    priceInput: paiseToInput(product?.price),
    mrpInput: paiseToInput(product?.mrp),
    moq: product?.moq != null ? String(product.moq) : "",
    stockStatus: product?.stockStatus ?? "IN_STOCK",
    status: product?.status ?? "ACTIVE",
    tags: product?.tags ?? [],
    specRows: product ? specsToRows(product.specs) : [newSpecRow()],
    images: (product?.images ?? []).map((image) => ({
      url: image.url,
      thumbUrl: image.thumbUrl ?? undefined,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
    })),
    hsnInput: product?.hsnCode ?? "",
    gstPercentInput: bpsToPercentInput(product?.gstRateBps),
    taxTreatment: product?.taxTreatment ?? null,
  };
}

const TREATMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "INHERIT", label: "Inherit (use category / profile default)" },
  { value: "TAX_EXCLUSIVE", label: "Tax exclusive (price is pre-GST)" },
  { value: "TAX_INCLUSIVE", label: "Tax inclusive (price already includes GST)" },
];

/** Renders an effective tax as a short "18% · HSN 8523 · inclusive" summary. */
function effectiveSummary(effective: EffectiveTax): string {
  const parts = [`${(effective.gstRateBps / 100).toString()}% GST`];
  if (effective.hsnCode) parts.push(`HSN ${effective.hsnCode}`);
  parts.push(
    effective.treatment === "TAX_INCLUSIVE" ? "inclusive" : "exclusive",
  );
  return parts.join(" · ");
}

/** Whole-number discount margin of price vs. mrp, or null when not derivable. */
function deriveMarginPct(price: number | null, mrp: number | null): number | null {
  if (price == null || mrp == null || mrp <= 0 || mrp <= price) return null;
  return Math.round(((mrp - price) / mrp) * 100);
}

/**
 * The product editor. Handles both create and edit. Prices are entered in ₹
 * but stored as integer paise; a live margin % is shown between price and mrp.
 * Validates with the shared zod schema before hitting the server action, and
 * surfaces server errors as toasts (never throws to the user).
 */
export function ProductEditorForm({
  categories,
  brands,
  product,
  tax,
  variantsActions = wiredVariantsActions,
}: ProductEditorFormProps) {
  const router = useRouter();
  const isEdit = Boolean(product);
  const [state, setState] = React.useState<FormState>(() =>
    buildInitialState(product),
  );
  const [pending, setPending] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<string | null>(null);

  // Variant state is mirrored up from VariantsSection so this form can swap its
  // base-price field to a read-only "From ₹X" display when variants are on. The
  // section itself owns the axes/rows and persists them via its own action.
  const [variantState, setVariantState] = React.useState<{
    hasVariants: boolean;
    fromPrice: number | null;
  }>(() => ({
    hasVariants: product?.hasVariants ?? false,
    fromPrice: product?.price ?? null,
  }));
  const onVariantStateChange = React.useCallback(
    (next: { hasVariants: boolean; fromPrice: number | null }) => {
      setVariantState(next);
    },
    [],
  );
  const hasVariants = variantState.hasVariants;

  const set = React.useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const typedPricePaise = parseRupees(state.priceInput);
  const mrpPaise = state.mrpInput.trim() === "" ? null : parseRupees(state.mrpInput);
  const marginPct = deriveMarginPct(typedPricePaise, mrpPaise);

  // For a variant product the base Product.price is the denormalized "FROM"
  // (= min active variant price) so listing/sort stay correct; the field is
  // read-only and reflects the matrix. When no variant is priced yet we fall
  // back to the typed value so the required base price is never empty.
  const pricePaise = hasVariants
    ? (variantState.fromPrice ?? typedPricePaise)
    : typedPricePaise;

  // Live "what applies" preview: layer the product's own overrides over the
  // inherited (category → profile) fallback, per field, exactly like
  // resolveEffectiveTax. Only rendered when GST is on (`tax.inherited` present).
  const overrideBps = percentInputToBps(state.gstPercentInput);
  const overrideHsn = state.hsnInput.trim();
  const resolvedTax: EffectiveTax | null = tax
    ? {
        hsnCode: overrideHsn !== "" ? overrideHsn : tax.inherited.hsnCode,
        gstRateBps: overrideBps ?? tax.inherited.gstRateBps,
        treatment: state.taxTreatment ?? tax.inherited.treatment,
      }
    : null;

  // Categories sorted parents-first for a readable select; sub-categories
  // indented under context (single flat list keeps the Base UI select simple).
  const categoryOptions = React.useMemo(() => {
    const byParent = [...categories].sort((a, b) => a.name.localeCompare(b.name));
    return byParent.map((c) => ({
      value: c.id,
      label: c.parentId ? `— ${c.name}` : c.name,
    }));
  }, [categories]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFieldError(null);

    if (pricePaise == null) {
      setFieldError(
        hasVariants
          ? "Add a priced variant, or set a base price before saving."
          : "Enter a valid price.",
      );
      return;
    }
    if (state.mrpInput.trim() !== "" && mrpPaise == null) {
      setFieldError("MRP is not a valid amount.");
      return;
    }
    if (state.gstPercentInput.trim() !== "" && overrideBps == null) {
      setFieldError("GST rate override is not a valid percentage.");
      return;
    }

    const moqValue = state.moq.trim() === "" ? undefined : Number(state.moq);

    const raw: CreateProductInput = {
      categoryId: state.categoryId,
      name: state.name.trim(),
      sku: state.sku.trim(),
      // brandId is authoritative; the server mirrors the brand's name into the
      // legacy `brand` string. We never send free-text `brand` from this form.
      brandId: state.brandId ?? undefined,
      description:
        state.description.trim() === "" ? undefined : state.description.trim(),
      specs: rowsToSpecs(state.specRows),
      price: pricePaise,
      mrp: mrpPaise ?? undefined,
      moq: moqValue,
      stockStatus: state.stockStatus,
      status: state.status,
      tags: state.tags,
      images: state.images,
      // GST overrides — empty/inherit becomes null so the effective tax is
      // inherited. Only meaningful when GST is on; harmless (null) otherwise.
      hsnCode: overrideHsn !== "" ? overrideHsn : null,
      gstRateBps: overrideBps,
      taxTreatment: state.taxTreatment,
    };

    const parsed = createProductSchema.safeParse(raw);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }

    setPending(true);
    try {
      const result = isEdit
        ? await updateProductAction(product!.id, parsed.data)
        : await createProductAction(parsed.data);

      if (!result.ok) {
        toast.error(result.error);
        setFieldError(result.error);
        return;
      }

      toast.success(isEdit ? "Product updated" : "Product created");
      router.push("/admin/products");
      router.refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FadeUp>
        <Section title="Basics" description="Name, SKU and where it lives.">
          <Field label="Name" htmlFor="name" required>
            <Input
              id="name"
              value={state.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Samsung EVO+ 128GB microSD"
              maxLength={160}
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="SKU"
              htmlFor="sku"
              hint="Optional — auto-generated if left blank."
            >
              <Input
                id="sku"
                value={state.sku}
                onChange={(e) => set("sku", e.target.value)}
                placeholder="Auto-generated"
                maxLength={64}
                className="font-tabular"
              />
            </Field>
            <Field label="Brand" htmlFor="brand">
              <BrandField
                id="brand"
                brands={brands}
                value={state.brandId}
                onChange={(brandId) => set("brandId", brandId)}
                disabled={pending}
              />
            </Field>
          </div>

          <Field label="Category" htmlFor="category" required>
            <Select
              value={state.categoryId || null}
              onValueChange={(value) => set("categoryId", (value as string) ?? "")}
              items={categoryOptions}
            >
              <SelectTrigger id="category" className="w-full">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Description" htmlFor="description">
            <textarea
              id="description"
              value={state.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Short marketing description shown on the product page."
              maxLength={5000}
              rows={3}
              className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </Field>
        </Section>
      </FadeUp>

      <FadeUp delay={0.03}>
        <Section
          title="Photos"
          description="Up to 8 images. The first is the primary."
        >
          {product?.id ? (
            <ProductImagesField
              productId={product.id}
              images={state.images}
              onImagesChange={(images) => set("images", images)}
              disabled={pending}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                Save the product to add photos
              </p>
              <p className="mt-1 text-xs">
                Photos upload straight to storage, so the product needs to exist
                first. Create it now — you&rsquo;ll land on the editor where you
                can drop images or snap them with the camera.
              </p>
            </div>
          )}
        </Section>
      </FadeUp>

      <FadeUp delay={0.04}>
        <Section
          title="Pricing"
          description={
            hasVariants
              ? "Priced per variant below. The base price is the lowest variant price."
              : "Amounts in ₹ — stored as paise."
          }
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {hasVariants ? (
              <Field label="Price (from)" htmlFor="price">
                <FromPriceDisplay fromPrice={variantState.fromPrice} />
              </Field>
            ) : (
              <Field label="Price" htmlFor="price" required>
                <RupeeInput
                  id="price"
                  value={state.priceInput}
                  onChange={(value) => set("priceInput", value)}
                  required
                />
              </Field>
            )}
            {hasVariants ? null : (
              <Field
                label="MRP"
                htmlFor="mrp"
                hint={marginPct != null ? `${marginPct}% off` : undefined}
              >
                <RupeeInput
                  id="mrp"
                  value={state.mrpInput}
                  onChange={(value) => set("mrpInput", value)}
                />
              </Field>
            )}
            <Field label="Min. order qty" htmlFor="moq">
              <Input
                id="moq"
                inputMode="numeric"
                value={state.moq}
                onChange={(e) =>
                  set("moq", e.target.value.replace(/[^\d]/g, ""))
                }
                placeholder="1"
                className="font-tabular"
              />
            </Field>
          </div>

          {!hasVariants && pricePaise != null ? (
            <p className="text-xs text-muted-foreground">
              Stored as{" "}
              <span className="font-tabular text-foreground">
                {formatPaise(pricePaise)}
              </span>
              {mrpPaise != null ? (
                <>
                  {" "}
                  · MRP{" "}
                  <span className="font-tabular text-foreground">
                    {formatPaise(mrpPaise)}
                  </span>
                </>
              ) : null}
            </p>
          ) : null}
        </Section>
      </FadeUp>

      <FadeUp delay={0.05}>
        <Section title="Availability" description="Stock and publish state.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Stock status" htmlFor="stock">
              <Select
                value={state.stockStatus}
                onValueChange={(value) =>
                  set("stockStatus", value as StockStatus)
                }
                items={STOCK_OPTIONS}
              >
                <SelectTrigger id="stock" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STOCK_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Published" htmlFor="status">
              <label
                htmlFor="status"
                className="flex h-8 cursor-pointer items-center justify-between gap-3 rounded-lg border border-input px-3 dark:bg-input/30"
              >
                <span className="text-sm text-muted-foreground">
                  {state.status === "ACTIVE"
                    ? "Visible in catalog"
                    : "Hidden (draft)"}
                </span>
                <input
                  id="status"
                  type="checkbox"
                  checked={state.status === "ACTIVE"}
                  onChange={(e) =>
                    set("status", e.target.checked ? "ACTIVE" : "INACTIVE")
                  }
                  className="size-4 accent-[var(--primary)]"
                />
              </label>
            </Field>
          </div>
        </Section>
      </FadeUp>

      {tax ? (
        <FadeUp delay={0.07}>
          <Section
            title="GST / tax"
            description="Optional overrides. Leave blank to inherit from the category, then the seller profile."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="HSN / SAC code" htmlFor="hsn">
                <Input
                  id="hsn"
                  value={state.hsnInput}
                  onChange={(e) => set("hsnInput", e.target.value)}
                  placeholder={tax.inherited.hsnCode ?? "e.g. 8523"}
                  maxLength={16}
                  className="font-tabular"
                />
              </Field>
              <Field label="GST rate" htmlFor="gst-rate">
                <div className="relative">
                  <Input
                    id="gst-rate"
                    inputMode="decimal"
                    value={state.gstPercentInput}
                    onChange={(e) =>
                      set(
                        "gstPercentInput",
                        e.target.value.replace(/[^\d.]/g, ""),
                      )
                    }
                    placeholder={(tax.inherited.gstRateBps / 100).toString()}
                    className="pr-7 font-tabular"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground"
                  >
                    %
                  </span>
                </div>
              </Field>
              <Field label="Treatment" htmlFor="tax-treatment">
                <Select
                  value={state.taxTreatment ?? "INHERIT"}
                  onValueChange={(value) =>
                    set(
                      "taxTreatment",
                      value === "INHERIT"
                        ? null
                        : (value as TaxTreatment),
                    )
                  }
                  items={TREATMENT_OPTIONS}
                >
                  <SelectTrigger id="tax-treatment" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TREATMENT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {resolvedTax ? (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Applies:{" "}
                <span className="font-medium text-foreground">
                  {effectiveSummary(resolvedTax)}
                </span>
                {" · "}
                inherits{" "}
                <span className="font-tabular">
                  {effectiveSummary(tax.inherited)}
                </span>{" "}
                when left blank
              </p>
            ) : null}
          </Section>
        </FadeUp>
      ) : null}

      <FadeUp delay={0.06}>
        <Section
          title="Variants"
          description="Sell this product in multiple options, each with its own price and stock."
        >
          <VariantsSection
            productId={product?.id}
            initialHasVariants={product?.hasVariants ?? false}
            initialOptionTypes={product?.optionTypes ?? []}
            initialVariants={product?.variants ?? []}
            baseSku={state.sku}
            actions={variantsActions}
            onStateChange={onVariantStateChange}
            disabled={pending}
          />
        </Section>
      </FadeUp>

      <FadeUp delay={0.12}>
        <Section title="Tags" description="Searchable keywords (max 20).">
          <TagEditor
            value={state.tags}
            onChange={(tags) => set("tags", tags)}
            disabled={pending}
          />
        </Section>
      </FadeUp>

      <FadeUp delay={0.16}>
        <Section title="Specifications" description="Technical key-value details.">
          <SpecEditor
            rows={state.specRows}
            onChange={(rows) => set("specRows", rows)}
            disabled={pending}
          />
        </Section>
      </FadeUp>

      {fieldError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {fieldError}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-2 border-t border-border bg-background/80 px-1 py-3 backdrop-blur pb-safe">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => router.push("/admin/products")}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
          {isEdit ? "Save changes" : "Create product"}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Local presentational helpers                                        */
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
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 space-y-0.5">
        <h2 className="font-heading text-sm font-semibold text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>
          {label}
          {required ? (
            <span aria-hidden className="text-destructive">
              *
            </span>
          ) : null}
        </Label>
        {hint ? (
          <span className="text-xs font-medium text-success">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

const RupeeInput = React.forwardRef<
  HTMLInputElement,
  {
    id: string;
    value: string;
    onChange: (value: string) => void;
    required?: boolean;
  }
>(function RupeeInput({ id, value, onChange, required }, ref) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground"
      >
        ₹
      </span>
      <Input
        ref={ref}
        id={id}
        inputMode="decimal"
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        placeholder="0.00"
        className={cn("pl-6 font-tabular")}
      />
    </div>
  );
});

/**
 * Read-only base-price display for variant products. Shows the derived "FROM"
 * price (= lowest active variant price) instead of an editable field, since the
 * price then lives per-variant in the matrix below.
 */
function FromPriceDisplay({ fromPrice }: { fromPrice: number | null }) {
  return (
    <div
      aria-live="polite"
      className="flex h-8 items-center rounded-lg border border-dashed border-input bg-muted/30 px-2.5 font-tabular text-sm text-foreground"
    >
      {fromPrice != null ? (
        <>
          <span className="text-muted-foreground">From&nbsp;</span>
          {formatPaise(fromPrice)}
        </>
      ) : (
        <span className="text-muted-foreground">Set from variants</span>
      )}
    </div>
  );
}
