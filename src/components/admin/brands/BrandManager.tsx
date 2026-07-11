"use client";

import * as React from "react";
import { PlusIcon, SearchIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/common";
import { springs } from "@/components/motion/tokens";
import {
  createBrandAction,
  deleteBrandAction,
  setBrandStatusAction,
  updateBrandAction,
} from "@/server/actions/brands";
import { BrandFormDialog, type BrandFormValues } from "./BrandFormDialog";
import { BrandRow } from "./BrandRow";

export interface BrandListItem {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  sortOrder: number;
  status: "ACTIVE" | "INACTIVE";
  productCount: number;
}

interface BrandManagerProps {
  initialBrands: BrandListItem[];
}

type DialogState =
  | { mode: "create" }
  | { mode: "edit"; target: BrandListItem }
  | null;

/**
 * Client brand manager: renders the flat brand list with inline rename,
 * active/inactive toggle, add/edit dialog and guarded delete. A search box
 * filters by name for large brand sets. All mutations are optimistic with
 * sonner toasts; on failure the previous state is restored and the server's
 * authoritative copy arrives via revalidatePath.
 */
export function BrandManager({ initialBrands }: BrandManagerProps) {
  const [brands, setBrands] = React.useState<BrandListItem[]>(initialBrands);
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [query, setQuery] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const reduced = useReducedMotion();

  // Adopt fresh server data during render (revalidatePath re-renders us with
  // new props): the recommended alternative to a sync-in-effect. Optimistic
  // local edits are always followed by a server action that revalidates, so
  // the server copy is authoritative once it arrives.
  const [syncedFrom, setSyncedFrom] = React.useState(initialBrands);
  if (syncedFrom !== initialBrands) {
    setSyncedFrom(initialBrands);
    setBrands(initialBrands);
  }

  /* ---------------------------------------------------------------- */
  /* Status toggle                                                    */
  /* ---------------------------------------------------------------- */

  const toggleStatus = React.useCallback(
    (id: string, nextStatus: "ACTIVE" | "INACTIVE") => {
      const previous = brands;
      setBrands((prev) =>
        prev.map((b) => (b.id === id ? { ...b, status: nextStatus } : b)),
      );
      startTransition(async () => {
        const result = await setBrandStatusAction({ id, status: nextStatus });
        if (!result.ok) {
          setBrands(previous);
          toast.error(result.error);
        } else {
          toast.success(
            nextStatus === "ACTIVE"
              ? "Brand is now available on the storefront."
              : "Brand hidden from the storefront.",
          );
        }
      });
    },
    [brands],
  );

  /* ---------------------------------------------------------------- */
  /* Inline rename                                                    */
  /* ---------------------------------------------------------------- */

  const renameBrand = React.useCallback(
    async (id: string, name: string): Promise<boolean> => {
      const result = await updateBrandAction({ id, patch: { name } });
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      const updated = result.data;
      setBrands((prev) =>
        prev.map((b) =>
          b.id === id ? { ...b, name: updated.name, slug: updated.slug } : b,
        ),
      );
      toast.success("Brand renamed.");
      return true;
    },
    [],
  );

  /* ---------------------------------------------------------------- */
  /* Delete                                                           */
  /* ---------------------------------------------------------------- */

  const deleteBrand = React.useCallback(
    async (id: string): Promise<void> => {
      const result = await deleteBrandAction({ id });
      if (!result.ok) {
        // Server refuses when products still reference this brand.
        toast.error(result.error);
        return;
      }
      setBrands((prev) => prev.filter((b) => b.id !== id));
      toast.success("Brand deleted.");
    },
    [],
  );

  /* ---------------------------------------------------------------- */
  /* Create / edit via dialog                                         */
  /* ---------------------------------------------------------------- */

  const handleDialogSubmit = React.useCallback(
    async (values: BrandFormValues): Promise<string | null> => {
      if (!dialog) return "No form open.";

      if (dialog.mode === "edit") {
        const result = await updateBrandAction({
          id: dialog.target.id,
          patch: {
            name: values.name,
            logo: values.logo,
            status: values.status,
          },
        });
        if (!result.ok) return result.error;
        toast.success("Brand updated.");
      } else {
        const result = await createBrandAction({
          name: values.name,
          logo: values.logo ?? undefined,
          status: values.status,
        });
        if (!result.ok) return result.error;
        toast.success("Brand added.");
      }
      // Server action revalidated the path — fresh props arrive on re-render.
      return null;
    },
    [dialog],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? brands.filter((b) => b.name.toLowerCase().includes(normalizedQuery))
    : brands;

  const isEmpty = brands.length === 0;
  const noMatches = !isEmpty && filtered.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {brands.length} {brands.length === 1 ? "brand" : "brands"}
            {pending ? (
              <span className="ml-2 text-xs text-muted-foreground/70">
                Saving…
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {brands.length > 0 ? (
            <div className="relative">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                placeholder="Search brands"
                aria-label="Search brands"
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 w-full pl-8 sm:w-56"
              />
            </div>
          ) : null}
          <Button onClick={() => setDialog({ mode: "create" })}>
            <PlusIcon aria-hidden />
            Add brand
          </Button>
        </div>
      </div>

      {isEmpty ? (
        <EmptyState
          illustration="empty-box"
          title="No brands yet"
          description="Create your first brand so products can reference it from a dropdown — no typos."
          action={
            <Button onClick={() => setDialog({ mode: "create" })}>
              <PlusIcon aria-hidden />
              Add brand
            </Button>
          }
        />
      ) : noMatches ? (
        <EmptyState
          illustration="no-results"
          title="No matching brands"
          description={`Nothing matches “${query.trim()}”. Try a different search.`}
          action={
            <Button variant="outline" onClick={() => setQuery("")}>
              Clear search
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {filtered.map((brand) => (
              <motion.li
                key={brand.id}
                layout={reduced ? false : true}
                transition={reduced ? { duration: 0 } : springs.gentle}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <BrandRow
                  brand={brand}
                  onToggleStatus={toggleStatus}
                  onRename={renameBrand}
                  onEdit={() => setDialog({ mode: "edit", target: brand })}
                  onDelete={() => deleteBrand(brand.id)}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <BrandFormDialog
        open={dialog !== null}
        onOpenChange={(next) => {
          if (!next) setDialog(null);
        }}
        title={dialog?.mode === "edit" ? "Edit brand" : "Add brand"}
        description={
          dialog?.mode === "create"
            ? "Brands are referenced by products from a dropdown, keeping names consistent."
            : undefined
        }
        submitLabel={dialog?.mode === "edit" ? "Save changes" : "Create"}
        initial={
          dialog?.mode === "edit"
            ? {
                name: dialog.target.name,
                logo: dialog.target.logo,
                status: dialog.target.status,
              }
            : undefined
        }
        onSubmit={handleDialogSubmit}
      />
    </div>
  );
}
