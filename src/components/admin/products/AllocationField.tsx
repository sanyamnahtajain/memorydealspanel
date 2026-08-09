"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { searchDeviceModelsAction } from "@/server/actions/device-models";

/**
 * AllocationField — the product editor's "Model allocation" controls:
 * the require-a-breakdown toggle plus an OPTIONAL model allow-list.
 *
 * The allow-list is search-first (the master holds hundreds of rows) and
 * renders the picked models as removable chips. Leaving it EMPTY means every
 * ACTIVE model is allowed — the right default for products like tempered
 * glass that fit any phone; restrict only when a product genuinely covers a
 * subset (e.g. a camera-lens film cut for a few flagships).
 */

export interface AllocationModelRef {
  id: string;
  name: string;
}

export function AllocationField({
  enabled,
  onEnabledChange,
  models,
  onModelsChange,
  disabled = false,
}: {
  enabled: boolean;
  onEnabledChange: (on: boolean) => void;
  models: AllocationModelRef[];
  onModelsChange: (models: AllocationModelRef[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<AllocationModelRef[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const seq = React.useRef(0);

  // Debounced admin search (unscoped — the editor picks from the full master).
  React.useEffect(() => {
    if (!open || !enabled) return;
    const mine = ++seq.current;
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const result = await searchDeviceModelsAction({ query, limit: 20 });
        if (seq.current === mine && result.ok) {
          setResults(
            result.data.map((m) => ({ id: m.id, name: m.name })),
          );
        }
      } finally {
        if (seq.current === mine) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, open, enabled]);

  const chosen = new Set(models.map((m) => m.id));

  function addModel(model: AllocationModelRef) {
    if (chosen.has(model.id)) return;
    onModelsChange([...models, model]);
    setQuery("");
    setOpen(false);
  }

  function removeModel(id: string) {
    onModelsChange(models.filter((m) => m.id !== id));
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
        <span className="text-sm">
          <span className="font-medium text-foreground">
            Require a per-model breakdown
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Buyers pick models from the master list (Admin → Models) and set a
            quantity for each; the cart line total follows the split.
          </span>
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={onEnabledChange}
          disabled={disabled}
          aria-label="Require a per-model breakdown"
        />
      </label>

      {enabled ? (
        <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
          <p className="text-xs font-medium text-foreground">
            Limit to specific models{" "}
            <span className="font-normal text-muted-foreground">
              (optional — empty allows every active model)
            </span>
          </p>

          <div className="relative max-w-sm">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              disabled={disabled}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder="Search models to allow…"
              className="pl-8"
              aria-label="Search device models to allow"
            />
            {searching ? (
              <Spinner className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2" />
            ) : null}

            {open && (query.trim() !== "" || results.length > 0) ? (
              <ul
                role="listbox"
                aria-label="Matching models"
                className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
              >
                {results.length === 0 && !searching ? (
                  <li className="px-2.5 py-2 text-sm text-muted-foreground">
                    No models match “{query}”.
                  </li>
                ) : (
                  results.map((m) => {
                    const taken = chosen.has(m.id);
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={taken}
                          disabled={taken}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            addModel(m);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm",
                            taken
                              ? "cursor-default text-muted-foreground"
                              : "hover:bg-muted",
                          )}
                        >
                          <span className="truncate">{m.name}</span>
                          {taken ? (
                            <span className="ml-2 shrink-0 text-xs">Added</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            ) : null}
          </div>

          {models.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {models.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs"
                >
                  {m.name}
                  <button
                    type="button"
                    aria-label={`Remove ${m.name}`}
                    disabled={disabled}
                    onClick={() => removeModel(m.id)}
                    className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              All active models are allowed.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
