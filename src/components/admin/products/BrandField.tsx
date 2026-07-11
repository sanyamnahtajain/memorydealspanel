"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2Icon, PlusIcon } from "lucide-react";
import type { BrandOption } from "@/server/services/brands";
import { createBrandAction } from "@/server/actions/brands";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Sentinel option value for the inline "add a brand" row. It can never collide
 * with a real brand id (Mongo ObjectIds are 24 hex chars), so selecting it is
 * unambiguous — we intercept it in `onValueChange` and open the create dialog
 * instead of committing it as a brandId.
 */
const ADD_BRAND_VALUE = "__add_brand__";

export interface BrandFieldProps {
  /** Active brands loaded server-side (see integrator note in the product page). */
  brands: BrandOption[];
  /** Selected brand id, or null when the product has no brand yet. */
  value: string | null;
  /** Called with the chosen brand id, or null when cleared. */
  onChange: (brandId: string | null) => void;
  /** Disables the control (e.g. while the parent form is submitting). */
  disabled?: boolean;
  /** id for the trigger, wired to the field <Label>. */
  id?: string;
}

/**
 * Brand picker for the product editor. A custom Base UI Select fed from the
 * Brand master — NO free text, so brand names can never drift or gain typos.
 *
 * The Base UI Select renders the raw value in its trigger unless it is given an
 * `items` map of value→label; we always pass one so the brand NAME shows, never
 * its id. An inline "＋ Add brand" row lets an admin create a brand without
 * leaving the form: it opens a small dialog, calls `createBrandAction`, appends
 * the new brand to the local option list, and selects it.
 */
export function BrandField({
  brands,
  value,
  onChange,
  disabled,
  id,
}: BrandFieldProps) {
  // Brands created on-the-fly this session. Kept separate from the server-sent
  // `brands` prop and merged during render, so a fresh server list (after
  // revalidation) reconciles automatically without a state-syncing effect.
  const [added, setAdded] = React.useState<BrandOption[]>([]);
  const options = React.useMemo<BrandOption[]>(() => {
    const byId = new Map(brands.map((b) => [b.id, b]));
    for (const b of added) if (!byId.has(b.id)) byId.set(b.id, b);
    return Array.from(byId.values());
  }, [brands, added]);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [dialogError, setDialogError] = React.useState<string | null>(null);

  // value→label map for the Select trigger (name, never id) + a sentinel row.
  const items = React.useMemo(
    () => [
      ...options.map((b) => ({ value: b.id, label: b.name })),
      { value: ADD_BRAND_VALUE, label: "＋ Add brand" },
    ],
    [options],
  );

  const handleSelect = (next: string | null) => {
    if (next === ADD_BRAND_VALUE) {
      setDialogError(null);
      setNewName("");
      setDialogOpen(true);
      return;
    }
    onChange(next && next.length > 0 ? next : null);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (name.length < 2) {
      setDialogError("Brand name is too short.");
      return;
    }
    setCreating(true);
    setDialogError(null);
    try {
      const result = await createBrandAction({ name });
      if (!result.ok) {
        setDialogError(result.error);
        return;
      }
      const brand = result.data;
      setAdded((prev) =>
        prev.some((b) => b.id === brand.id)
          ? prev
          : [...prev, { id: brand.id, name: brand.name }],
      );
      onChange(brand.id);
      toast.success(`Brand “${brand.name}” added`);
      setDialogOpen(false);
    } catch {
      setDialogError("Something went wrong. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Select
        value={value ?? null}
        onValueChange={(next) => handleSelect((next as string | null) ?? null)}
        items={items}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Select a brand" />
        </SelectTrigger>
        <SelectContent>
          {options.length === 0 ? (
            <div className="px-1.5 py-2 text-xs text-muted-foreground">
              No brands yet — add one below.
            </div>
          ) : (
            options.map((brand) => (
              <SelectItem key={brand.id} value={brand.id}>
                {brand.name}
              </SelectItem>
            ))
          )}
          <SelectSeparator />
          <SelectItem value={ADD_BRAND_VALUE}>
            <PlusIcon aria-hidden className="text-muted-foreground" />
            Add brand
          </SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          onKeyDown={(e) => {
            if (e.key === "Enter" && !creating) {
              e.preventDefault();
              void handleCreate();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a brand</DialogTitle>
            <DialogDescription>
              Creates a brand in the master list and selects it for this product.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="new-brand-name">Name</Label>
            <Input
              id="new-brand-name"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Samsung"
              maxLength={80}
              disabled={creating}
              aria-invalid={dialogError != null}
            />
            {dialogError ? (
              <p role="alert" className="text-xs text-destructive">
                {dialogError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={creating}
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={creating} onClick={handleCreate}>
              {creating ? (
                <Loader2Icon className="animate-spin" aria-hidden />
              ) : null}
              Add brand
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
