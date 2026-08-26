"use client";

import * as React from "react";
import { ClipboardPaste, Minus, Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  clampQuantity,
  minOrderableQty,
  stepQtyDown,
  stepQtyUp,
} from "@/lib/quantity";
import {
  perModelIssueText,
  perModelRules,
} from "@/lib/allocation";
import { normalizeModelText } from "@/lib/allocation-paste";
import {
  MAX_BREAKDOWN_ENTRIES,
  MAX_CUSTOM_MODEL_NAME,
  MAX_QTY_PER_LINE,
} from "@/lib/schemas/cart";
import { searchDeviceModelsAction } from "@/server/actions/device-models";
import { matchBreakdownPasteAction } from "@/server/actions/allocation-paste";

/**
 * ModelAllocationBuilder — the "10 × Realme 11, 10 × S23 Ultra…" editor,
 * built for BULK: a shopkeeper splitting 1000 pcs across 100 models must get
 * through it fast, on a phone.
 *
 *   - Search-first picker (the model master holds hundreds of rows); the SAME
 *     box filters the already-chosen rows as you type.
 *   - Paste mode: paste "S23 Ultra 20" lines and the rows fill themselves
 *     (server-side fuzzy match); a line matching no master model is kept AS
 *     TYPED — a custom line — and called out plainly in the report.
 *   - Free text: when the search matches nothing (or only partially), an
 *     "Add “<typed>”" row lets the buyer add their own wording as a custom
 *     line, visually tagged "custom".
 *   - Per-model steppers step by the PACK MULTIPLE, with tap-and-hold repeat,
 *     plus a "+pack" quick add on each row.
 *   - Per-model pack/minimum violations render inline under the row (red),
 *     mirroring exactly what the server will enforce.
 *   - A pinned "N models · M pcs" bar tracks the running total.
 *
 * Controlled: `value` + `onChange` — the parent (add-to-cart / cart edit)
 * owns submission. This component never talks to the cart itself.
 */

export interface AllocationRow {
  /** Master-list model id — NULL for a custom (typed) line. */
  modelId: string | null;
  /** True when the buyer typed this model because the master list lacks it. */
  custom?: boolean;
  name: string;
  qty: number;
}

/**
 * Stable identity of a row: the model id for master rows, the normalized
 * typed name for custom rows (which have no id). Used for React keys, the
 * qty updates, and dedupe.
 */
export function allocationRowKey(row: Pick<AllocationRow, "modelId" | "name">): string {
  return row.modelId ?? `custom:${normalizeModelText(row.name)}`;
}

export interface ModelAllocationBuilderProps {
  value: AllocationRow[];
  onChange: (rows: AllocationRow[]) => void;
  /** Scope searches to this product's allocation restriction. */
  productId: string;
  moq?: number | null;
  packMultiple?: number | null;
  /** Per-model minimum from the allocation config, when defined. */
  minPerModel?: number | null;
  disabled?: boolean;
  className?: string;
}

interface SearchResult {
  id: string;
  name: string;
  brandName: string | null;
}

interface PasteReport {
  filled: number;
  /** Typed names that matched no master model — kept as custom lines. */
  addedAsTyped: string[];
  unreadable: string[];
  overflow: number;
  capped: boolean;
}

/* ------------------------------------------------------------------ */
/* Tap-and-hold stepper button                                         */
/* ------------------------------------------------------------------ */

const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 110;

/**
 * A stepper button that fires once per tap and REPEATS while held. Pointer
 * events drive both (a following click with detail ≥ 1 is ignored so a tap
 * never double-fires); keyboard "clicks" arrive with detail 0 and fire once.
 */
function StepButton({
  onStep,
  disabled = false,
  className,
  children,
  ...aria
}: {
  onStep: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  "aria-label": string;
}) {
  const onStepRef = React.useRef(onStep);
  React.useEffect(() => {
    onStepRef.current = onStep;
  });

  const delayRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = React.useCallback(() => {
    if (delayRef.current) clearTimeout(delayRef.current);
    if (repeatRef.current) clearInterval(repeatRef.current);
    delayRef.current = null;
    repeatRef.current = null;
  }, []);

  React.useEffect(() => stop, [stop]);

  function handlePointerDown() {
    if (disabled) return;
    onStepRef.current();
    stop();
    delayRef.current = setTimeout(() => {
      repeatRef.current = setInterval(() => {
        onStepRef.current();
      }, HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      // Keyboard activation arrives as a click with detail 0.
      onClick={(e) => {
        if (e.detail === 0 && !disabled) onStepRef.current();
      }}
      // No long-press context menu / text selection while holding.
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "inline-flex select-none touch-none items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40",
        className,
      )}
      {...aria}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* The builder                                                         */
/* ------------------------------------------------------------------ */

export function ModelAllocationBuilder({
  value,
  onChange,
  productId,
  moq,
  packMultiple,
  minPerModel,
  disabled = false,
  className,
}: ModelAllocationBuilderProps) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const seq = React.useRef(0);

  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [pasteBusy, setPasteBusy] = React.useState(false);
  const [pasteError, setPasteError] = React.useState<string | null>(null);
  const [pasteReport, setPasteReport] = React.useState<PasteReport | null>(null);

  // Debounced server search; a stale response never overwrites a newer one.
  React.useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const result = await searchDeviceModelsAction({
          query,
          productId,
          limit: 30,
        });
        if (seq.current === mine && result.ok) setResults(result.data);
      } finally {
        if (seq.current === mine) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, open, productId]);

  const rules = perModelRules(minPerModel, packMultiple);
  const chosen = new Set(value.map((r) => allocationRowKey(r)));
  // Normalized names of EVERY chosen row (master + custom) — the dedupe pool
  // for a typed custom name ("iphone 12" twice must not make two lines).
  const chosenNames = new Set(value.map((r) => normalizeModelText(r.name)));
  const total = value.reduce((acc, r) => acc + r.qty, 0);
  const floor = minOrderableQty(moq, packMultiple);
  const settled = clampQuantity(total, moq, packMultiple);
  const issueCount = value.reduce(
    (acc, r) => acc + (perModelIssueText(r.qty, rules) ? 1 : 0),
    0,
  );
  const totalOk = total > 0 && settled === total && issueCount === 0;

  // The search box doubles as a filter over the rows already chosen.
  const filterNorm = normalizeModelText(query);
  const visibleRows =
    filterNorm === ""
      ? value
      : value.filter((r) => normalizeModelText(r.name).includes(filterNorm));
  const hiddenCount = value.length - visibleRows.length;

  function addModel(model: SearchResult) {
    if (chosen.has(model.id) || value.length >= MAX_BREAKDOWN_ENTRIES) return;
    onChange([...value, { modelId: model.id, name: model.name, qty: rules.min }]);
    setQuery("");
    setOpen(false);
  }

  // ---- Custom (typed) models -------------------------------------------
  // The master list is never complete. When the search text matches nothing
  // (or the buyer simply prefers their own wording) they can add the text
  // AS TYPED; the line is stored with `custom: true` and its name, and is
  // visually tagged so admins know it is not from the master list. This is
  // deliberately ALSO allowed for products with a RESTRICTED modelIds list:
  // the restriction pins which master models may be picked, but free text
  // exists precisely because that list (like the master) is incomplete.
  const typedName = query.replace(/\s+/g, " ").trim().slice(0, MAX_CUSTOM_MODEL_NAME);
  const typedNorm = normalizeModelText(typedName);
  const typedTaken = typedNorm !== "" && chosenNames.has(typedNorm);
  // Hide the add row when a suggestion IS this exact name — pick the master
  // row instead, so a custom duplicate of a catalog model can't be created.
  const typedMatchesResult = results.some(
    (m) => normalizeModelText(m.name) === typedNorm,
  );
  const showAddTyped =
    typedNorm !== "" && !typedMatchesResult && value.length < MAX_BREAKDOWN_ENTRIES;

  function addTypedModel() {
    if (!showAddTyped || typedTaken) return;
    onChange([
      ...value,
      { modelId: null, custom: true, name: typedName, qty: rules.min },
    ]);
    setQuery("");
    setOpen(false);
  }

  function setQty(rowKey: string, qty: number) {
    if (qty <= 0) {
      onChange(value.filter((r) => allocationRowKey(r) !== rowKey));
      return;
    }
    onChange(
      value.map((r) => (allocationRowKey(r) === rowKey ? { ...r, qty } : r)),
    );
  }

  async function handlePasteFill() {
    const text = pasteText.trim();
    if (text === "" || pasteBusy) return;
    setPasteBusy(true);
    setPasteError(null);
    setPasteReport(null);
    try {
      const result = await matchBreakdownPasteAction({ productId, text });
      if (!result.ok) {
        setPasteError(result.message);
        return;
      }
      // Merge: pasted quantity REPLACES the row's quantity (predictable when
      // re-pasting a corrected list); new models append in pasted order.
      // Custom (typed) rows merge on their normalized name, master rows on id.
      const merged = [...value];
      const indexByKey = new Map(
        merged.map((r, i) => [allocationRowKey(r), i] as const),
      );
      let capped = false;
      for (const row of result.rows) {
        const key = allocationRowKey(row);
        const at = indexByKey.get(key);
        if (at !== undefined) {
          merged[at] = { ...merged[at], qty: row.qty };
        } else if (merged.length < MAX_BREAKDOWN_ENTRIES) {
          merged.push({
            modelId: row.modelId,
            ...(row.custom ? { custom: true } : {}),
            name: row.name,
            qty: row.qty,
          });
        } else {
          capped = true;
        }
      }
      onChange(merged);
      setPasteReport({
        filled: result.rows.length,
        addedAsTyped: result.addedAsTyped,
        unreadable: result.unreadable,
        overflow: result.overflow,
        capped,
      });
    } catch {
      setPasteError("Could not read your list. Please try again.");
    } finally {
      setPasteBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* ---- Search / filter + paste toggle ---- */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
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
            onBlur={() => {
              // Delay so a click on a result lands before the list closes.
              setTimeout(() => setOpen(false), 150);
            }}
            placeholder={
              value.length > 0
                ? "Search or find in your list…"
                : "Search phone model… e.g. Realme 11, S23 Ultra"
            }
            className="h-10 pl-8"
            aria-label="Search device models"
          />
          {searching ? (
            <Spinner className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2" />
          ) : null}

          {open && (query.trim() !== "" || results.length > 0) ? (
            <ul
              role="listbox"
              aria-label="Matching models"
              className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
            >
              {results.length === 0 && !searching && !showAddTyped ? (
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
                        // onMouseDown so it beats the input's blur-close.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addModel(m);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm",
                          taken
                            ? "cursor-default text-muted-foreground"
                            : "hover:bg-muted",
                        )}
                      >
                        <span className="truncate">{m.name}</span>
                        <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                          {taken ? "Added" : m.brandName ?? ""}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
              {/* Free-text escape hatch: the master list is never complete,
                  so whatever the buyer typed can always be added AS TYPED. */}
              {showAddTyped ? (
                <li key="add-typed">
                  <button
                    type="button"
                    role="option"
                    aria-selected={typedTaken}
                    disabled={typedTaken}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addTypedModel();
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm",
                      typedTaken
                        ? "cursor-default text-muted-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Plus aria-hidden className="size-3.5 shrink-0" />
                      <span className="truncate">
                        Add “{typedName}”
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {typedTaken ? "Added" : "as typed"}
                    </span>
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>

        <Button
          type="button"
          variant={pasteOpen ? "secondary" : "outline"}
          disabled={disabled}
          onClick={() => setPasteOpen((v) => !v)}
          aria-expanded={pasteOpen}
          className="h-10 shrink-0 gap-1.5 px-3"
        >
          <ClipboardPaste aria-hidden className="size-4" />
          Paste list
        </Button>
      </div>

      {/* ---- Paste mode ---- */}
      {pasteOpen ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
          <p className="text-xs text-muted-foreground">
            One model per line — name, then how many. Example: “S23 Ultra 20”.
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            disabled={disabled || pasteBusy}
            rows={5}
            placeholder={"S23 Ultra 20\niPhone 15 30\nRedmi Note 13 50"}
            aria-label="Paste your model list"
            className="w-full resize-y rounded-lg border border-input bg-background px-2.5 py-2 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
          />
          {pasteError ? (
            <p role="alert" className="text-xs text-destructive">
              {pasteError}
            </p>
          ) : null}
          {pasteReport ? (
            <div className="flex flex-col gap-1 text-xs" aria-live="polite">
              {pasteReport.filled > 0 ? (
                <p className="text-success">
                  Filled {pasteReport.filled}{" "}
                  {pasteReport.filled === 1 ? "model" : "models"}.
                </p>
              ) : null}
              {pasteReport.addedAsTyped.length > 0 ? (
                <p className="text-amber-700 dark:text-amber-300">
                  Not in our list — added as typed:{" "}
                  {pasteReport.addedAsTyped.join(", ")}
                </p>
              ) : null}
              {pasteReport.unreadable.length > 0 ? (
                <p className="text-amber-700 dark:text-amber-300">
                  No quantity found: {pasteReport.unreadable.join(", ")}
                </p>
              ) : null}
              {pasteReport.overflow > 0 ? (
                <p className="text-amber-700 dark:text-amber-300">
                  Only the first 500 lines were used.
                </p>
              ) : null}
              {pasteReport.capped ? (
                <p className="text-amber-700 dark:text-amber-300">
                  A list can hold at most {MAX_BREAKDOWN_ENTRIES} models.
                </p>
              ) : null}
            </div>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={disabled || pasteBusy || pasteText.trim() === ""}
            aria-busy={pasteBusy || undefined}
            onClick={handlePasteFill}
            className="gap-1.5"
          >
            {pasteBusy ? <Spinner className="size-3.5" /> : null}
            {pasteBusy ? "Filling…" : "Fill models"}
          </Button>
        </div>
      ) : null}

      {/* ---- Chosen models ---- */}
      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          Search and add the models you need, or paste your list.
        </p>
      ) : (
        <>
          {hiddenCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              Showing {visibleRows.length} of {value.length} models — clear the
              search to see all.
            </p>
          ) : null}
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-auto">
            {visibleRows.map((row) => {
              const key = allocationRowKey(row);
              const issue = perModelIssueText(row.qty, rules);
              const errorId = issue
                ? `alloc-issue-${key.replace(/[^\p{L}\p{N}_-]+/gu, "-")}`
                : undefined;
              return (
                <li
                  key={key}
                  className={cn(
                    "rounded-lg border bg-background px-2.5 py-1.5",
                    issue ? "border-destructive/60" : "border-border",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="min-w-0 truncate text-sm">{row.name}</span>
                      {row.custom ? (
                        // Marks a typed (not-in-master-list) model for both
                        // the buyer and the admin reviewing the order.
                        <span className="shrink-0 rounded border border-border bg-muted px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          custom
                        </span>
                      ) : null}
                    </span>
                    <div className="inline-flex items-center rounded-md border border-border">
                      <StepButton
                        aria-label={`Fewer ${row.name}`}
                        disabled={disabled}
                        onStep={() =>
                          setQty(key, stepQtyDown(row.qty, rules.pack))
                        }
                        className="size-8"
                      >
                        <Minus aria-hidden className="size-3.5" />
                      </StepButton>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        aria-label={`Quantity for ${row.name}`}
                        aria-invalid={issue ? true : undefined}
                        aria-describedby={errorId}
                        value={row.qty}
                        disabled={disabled}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/[^\d]/g, "");
                          if (digits === "") return setQty(key, 1);
                          setQty(
                            key,
                            Math.min(MAX_QTY_PER_LINE, Number(digits)),
                          );
                        }}
                        className={cn(
                          "h-8 w-12 border-x border-border bg-transparent text-center text-sm tabular-nums outline-none focus-visible:bg-muted/40",
                          issue && "text-destructive",
                        )}
                      />
                      <StepButton
                        aria-label={`More ${row.name}`}
                        disabled={disabled}
                        onStep={() =>
                          setQty(key, stepQtyUp(row.qty, rules.pack))
                        }
                        className="size-8"
                      >
                        <Plus aria-hidden className="size-3.5" />
                      </StepButton>
                    </div>
                    {rules.pack > 1 ? (
                      <button
                        type="button"
                        aria-label={`Add one pack of ${rules.pack} ${row.name}`}
                        disabled={disabled}
                        onClick={() =>
                          setQty(key, stepQtyUp(row.qty, rules.pack))
                        }
                        className="inline-flex h-8 shrink-0 select-none items-center rounded-md border border-border px-1.5 text-xs font-medium tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      >
                        +{rules.pack}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Remove ${row.name}`}
                      disabled={disabled}
                      onClick={() => setQty(key, 0)}
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  </div>
                  {issue ? (
                    <p id={errorId} className="mt-1 text-xs text-destructive">
                      {issue}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ---- Pinned running total vs the MOQ / pack rules ---- */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm",
          totalOk
            ? "bg-success/10 text-success"
            : issueCount > 0
              ? "bg-destructive/10 text-destructive"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        )}
        aria-live="polite"
      >
        <span className="font-medium tabular-nums">
          {value.length} {value.length === 1 ? "model" : "models"} · {total} pcs
        </span>
        <span className="text-right text-xs">
          {issueCount > 0
            ? `Fix ${issueCount} ${issueCount === 1 ? "model" : "models"} marked in red`
            : total === 0
              ? `Minimum ${floor}`
              : totalOk
                ? "Ready to add"
                : total < floor
                  ? `Add ${floor - total} more (minimum ${floor})`
                  : `Round up to ${settled}${
                      rules.pack > 1 ? ` (packs of ${rules.pack})` : ""
                    }`}
        </span>
      </div>
    </div>
  );
}
