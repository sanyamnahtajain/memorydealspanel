"use client";

import * as React from "react";
import { GripVerticalIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import type { OptionType } from "./types";

/**
 * OptionTypesEditor — defines a variant product's option axes (Capacity, Color,
 * Storage, …). Each axis has a NAME (a {@link Combobox} with `allowCreate`, so
 * common axis names are suggested but anything can be typed) and a chip list of
 * VALUES (another `allowCreate` Combobox that commits a chip on select/Enter).
 *
 * Purely controlled: the parent {@link VariantsSection} owns the `OptionType[]`
 * and regenerates the matrix from it. Duplicate axis names and duplicate values
 * (case-insensitive) are rejected so the cartesian product stays clean.
 *
 * Suggestions are deliberately client-side/static here — there's no server
 * DISTINCT source for axis names yet. INTEGRATOR: when a `variantOptionNames` /
 * `variantOptionValues` suggestion action lands, swap the `onSearch` closures
 * below to call it (same signature as SpecEditor's spec key/value fetchers).
 */

/** Common axis names offered as a starting point (free entry still allowed). */
const COMMON_AXIS_NAMES = [
  "Capacity",
  "Color",
  "Storage",
  "Size",
  "Length",
  "Speed",
  "Interface",
  "Form Factor",
  "Bundle",
] as const;

interface OptionTypesEditorProps {
  value: OptionType[];
  onChange: (optionTypes: OptionType[]) => void;
  disabled?: boolean;
  /** Hard cap on axes — the matrix explodes multiplicatively past a few. */
  maxAxes?: number;
}

export function OptionTypesEditor({
  value,
  onChange,
  disabled,
  maxAxes = 3,
}: OptionTypesEditorProps) {
  const updateAxis = (index: number, patch: Partial<OptionType>) => {
    onChange(value.map((axis, i) => (i === index ? { ...axis, ...patch } : axis)));
  };

  const removeAxis = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const addAxis = () => {
    if (value.length >= maxAxes) return;
    onChange([...value, { name: "", values: [] }]);
  };

  const nameSuggest = React.useCallback(
    async (): Promise<string[]> => [...COMMON_AXIS_NAMES],
    [],
  );

  const atCapacity = value.length >= maxAxes;

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No option axes yet. Add one (like Capacity or Color) to start building
          variants.
        </p>
      ) : (
        <ul className="space-y-3">
          {value.map((axis, index) => {
            // Guard against duplicate axis names so the matrix keys stay unique.
            const duplicateName =
              axis.name.trim() !== "" &&
              value.some(
                (other, i) =>
                  i !== index &&
                  other.name.trim().toLowerCase() ===
                    axis.name.trim().toLowerCase(),
              );
            return (
              <li
                key={index}
                className="rounded-lg border border-border bg-background/60 p-3"
              >
                <div className="flex items-start gap-2">
                  <GripVerticalIcon
                    aria-hidden
                    className="mt-2 size-4 shrink-0 text-muted-foreground/60"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Combobox
                        aria-label={`Option ${index + 1} name`}
                        placeholder="Capacity"
                        value={axis.name}
                        disabled={disabled}
                        onValueChange={(name) => updateAxis(index, { name })}
                        onSearch={nameSuggest}
                        allowCreate
                        emptyMessage="New axis — press Enter to add it"
                        aria-invalid={duplicateName || undefined}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove option ${axis.name || index + 1}`}
                        disabled={disabled}
                        onClick={() => removeAxis(index)}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2Icon aria-hidden />
                      </Button>
                    </div>
                    {duplicateName ? (
                      <p className="text-xs text-destructive">
                        Another axis already uses this name.
                      </p>
                    ) : null}
                    <AxisValues
                      values={axis.values}
                      disabled={disabled}
                      onChange={(values) => updateAxis(index, { values })}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || atCapacity}
        onClick={addAxis}
      >
        <PlusIcon aria-hidden />
        {atCapacity ? `Max ${maxAxes} axes` : "Add option"}
      </Button>
    </div>
  );
}

/**
 * The chip list of values for a single axis. New values are entered via a
 * `allowCreate` Combobox and committed as chips; case-insensitive duplicates
 * are ignored. Kept internal to this file — it's meaningless without an axis.
 */
function AxisValues({
  values,
  onChange,
  disabled,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}) {
  // The Combobox is controlled by `draft`; on commit we push a chip and clear
  // it. Using an empty string round-trip via `key` forces the input to reset.
  const [draft, setDraft] = React.useState("");

  const commit = React.useCallback(
    (raw: string) => {
      const val = raw.trim();
      if (!val) return;
      if (values.some((v) => v.toLowerCase() === val.toLowerCase())) {
        setDraft("");
        return;
      }
      onChange([...values, val]);
      setDraft("");
    },
    [values, onChange],
  );

  const removeAt = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((val, index) => (
            <span
              key={`${val}-${index}`}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-secondary px-2 text-xs font-medium text-secondary-foreground"
            >
              {val}
              <button
                type="button"
                aria-label={`Remove ${val}`}
                disabled={disabled}
                onClick={() => removeAt(index)}
                className="-mr-0.5 inline-flex size-4 items-center justify-center rounded text-muted-foreground transition-fast hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <XIcon className="size-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className={cn(disabled && "pointer-events-none opacity-50")}>
        <Combobox
          aria-label="Add option value"
          placeholder={values.length ? "Add another value…" : "Add a value…"}
          value={draft}
          disabled={disabled}
          onValueChange={commit}
          allowCreate
          emptyMessage="Press Enter to add this value"
        />
      </div>
    </div>
  );
}
