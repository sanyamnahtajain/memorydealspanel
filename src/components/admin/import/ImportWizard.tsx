"use client";

/**
 * ImportWizard — the client orchestrator for the 4-step bulk import (F-A19).
 *
 *   1. Upload   — drag-drop / pick a .csv or .xlsx; download the template.
 *   2. Map      — auto-matched column mapping, editable (ColumnMapper).
 *   3. Preview  — DealSheet review grid with per-cell errors (ImportPreviewGrid).
 *   4. Commit   — run the import, show a created/updated/skipped report and a
 *                 downloadable error CSV.
 *
 * All parsing/validation is authoritative on the SERVER: the client uploads the
 * file (base64), receives parsed rows + a suggested mapping, and re-validates
 * against the LIVE catalog on every preview and at commit time. In-grid edits
 * mutate a local copy of the raw rows and trigger a fresh server preview.
 */

import * as React from "react";
import { toast } from "sonner";
import {
  UploadCloudIcon,
  FileSpreadsheetIcon,
  DownloadIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  Loader2Icon,
  CheckCircle2Icon,
  RotateCcwIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  uploadAndParse,
  previewImport,
  commitImportAction,
  downloadTemplate,
  type CommitSummary,
} from "@/server/actions/import";
import type {
  ColumnMapping,
  ImportField,
  PreviewRow,
} from "@/server/services/import";
import { ColumnMapper, type MapperField } from "./ColumnMapper";
import { ImportPreviewGrid } from "./ImportPreviewGrid";

/* -------------------------------------------------------------------------- */
/*  Wizard state                                                              */
/* -------------------------------------------------------------------------- */

type Step = 1 | 2 | 3 | 4;

interface UploadState {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
  mapping: ColumnMapping;
  fields: MapperField[];
  droppedBlank: number;
}

const STEP_LABELS: Record<Step, string> = {
  1: "Upload",
  2: "Map columns",
  3: "Preview",
  4: "Done",
};

const ACCEPT = ".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

/* -------------------------------------------------------------------------- */
/*  File helpers                                                              */
/* -------------------------------------------------------------------------- */

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read the file."));
        return;
      }
      // strip the "data:...;base64," prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".csv") || name.endsWith(".xlsx");
}

/** Triggers a browser download of base64 bytes with the given mime type. */
function downloadBase64(base64: string, filename: string, mime: string): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function ImportWizard() {
  const [step, setStep] = React.useState<Step>(1);
  const [upload, setUpload] = React.useState<UploadState | null>(null);
  const [preview, setPreview] = React.useState<PreviewRow[] | null>(null);
  const [summary, setSummary] = React.useState<CommitSummary | null>(null);

  const [busy, setBusy] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  /* ---------------------------- step 1: upload --------------------------- */

  const handleFile = React.useCallback(async (file: File) => {
    if (!isAcceptedFile(file)) {
      toast.error("Please upload a .csv or .xlsx file.");
      return;
    }
    setBusy(true);
    try {
      const base64 = await fileToBase64(file);
      const res = await uploadAndParse(base64);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setUpload({
        fileName: file.name,
        headers: res.headers,
        rows: res.rows,
        mapping: res.suggestedMapping,
        fields: res.fields,
        droppedBlank: res.droppedBlank,
      });
      setPreview(null);
      setSummary(null);
      setStep(2);
      if (res.droppedBlank > 0) {
        toast.info(`Ignored ${res.droppedBlank} blank row(s).`);
      }
    } catch (error) {
      console.error(error);
      toast.error("Could not read that file.");
    } finally {
      setBusy(false);
    }
  }, []);

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const onTemplate = React.useCallback(async () => {
    setBusy(true);
    try {
      const res = await downloadTemplate();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      downloadBase64(
        res.base64,
        res.filename,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  /* --------------------------- step 2 → 3: preview ----------------------- */

  const runPreview = React.useCallback(
    async (
      rows: Record<string, string>[],
      mapping: ColumnMapping,
      headers: string[],
    ) => {
      setBusy(true);
      try {
        const res = await previewImport({
          rows,
          mapping: mapping as Record<string, string>,
          // Headers let the server infer variant option axes (Capacity, Color…)
          // from any column not claimed by a canonical field.
          headers,
        });
        if (!res.ok) {
          toast.error(res.error);
          return false;
        }
        setPreview(res.rows);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const goToPreview = React.useCallback(async () => {
    if (!upload) return;
    const ok = await runPreview(upload.rows, upload.mapping, upload.headers);
    if (ok) setStep(3);
  }, [upload, runPreview]);

  /* ----------------------- step 3: in-grid edits ------------------------ */

  const onEditRow = React.useCallback(
    (rowNumber: number, patch: Partial<Record<ImportField, string>>) => {
      if (!upload) return;
      // rowNumber is 1-based (header + 1); source row index = rowNumber - 2.
      const index = rowNumber - 2;
      const sourceRow = upload.rows[index];
      if (!sourceRow) return;

      // Apply the patch back onto the underlying (mapped) source columns.
      const nextRows = upload.rows.slice();
      const patched = { ...sourceRow };
      for (const field of Object.keys(patch) as ImportField[]) {
        const header = upload.mapping[field];
        if (header) patched[header] = patch[field] ?? "";
      }
      nextRows[index] = patched;

      const nextUpload = { ...upload, rows: nextRows };
      setUpload(nextUpload);
      void runPreview(nextRows, nextUpload.mapping, nextUpload.headers);
    },
    [upload, runPreview],
  );

  /* ----------------------------- step 4: commit -------------------------- */

  const commit = React.useCallback(async () => {
    if (!upload) return;
    setBusy(true);
    try {
      const res = await commitImportAction({
        rows: upload.rows,
        mapping: upload.mapping as Record<string, string>,
        headers: upload.headers,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSummary(res);
      setStep(4);
      // Variant products count toward the "imported" total alongside singles.
      const variantProducts =
        res.variantProductsCreated + res.variantProductsUpdated;
      const done = res.created + res.updated + variantProducts;
      toast.success(
        `Imported ${done} product${done === 1 ? "" : "s"}` +
          (res.skipped.length ? `, ${res.skipped.length} skipped.` : "."),
      );
    } finally {
      setBusy(false);
    }
  }, [upload]);

  const reset = React.useCallback(() => {
    setUpload(null);
    setPreview(null);
    setSummary(null);
    setStep(1);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const onErrorCsv = React.useCallback(() => {
    if (!summary?.errorsCsvBase64) return;
    downloadBase64(
      summary.errorsCsvBase64,
      "import-errors.csv",
      "text/csv;charset=utf-8",
    );
  }, [summary]);

  const previewCounts = React.useMemo(() => {
    if (!preview) return { creates: 0, updates: 0, invalid: 0, variants: 0 };
    let creates = 0;
    let updates = 0;
    let invalid = 0;
    let variants = 0;
    for (const r of preview) {
      if (r.operation === "create") creates++;
      else if (r.operation === "update") updates++;
      else if (r.operation === "variant") variants++;
      else invalid++;
    }
    return { creates, updates, invalid, variants };
  }, [preview]);

  /** Rows that will actually be written (single-product + variant rows). */
  const committableCount =
    previewCounts.creates + previewCounts.updates + previewCounts.variants;

  const missingRequired = upload
    ? upload.fields.some((f) => f.required && !upload.mapping[f.key])
    : true;

  /* ------------------------------- render -------------------------------- */

  return (
    <div className="space-y-6">
      <Stepper current={step} />

      {/* Step 1 — upload */}
      {step === 1 && (
        <div className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border px-6 py-14 text-center transition-colors",
              "hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              dragOver && "border-primary bg-primary/5",
              busy && "pointer-events-none opacity-60",
            )}
          >
            {busy ? (
              <Loader2Icon className="size-8 animate-spin text-muted-foreground" aria-hidden />
            ) : (
              <UploadCloudIcon className="size-8 text-muted-foreground" aria-hidden />
            )}
            <div>
              <p className="text-sm font-medium text-foreground">
                Drag &amp; drop a spreadsheet, or click to browse
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Accepts .csv and .xlsx — the first row must be a header.
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </div>

          <div className="flex items-center justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onTemplate}
              disabled={busy}
            >
              <DownloadIcon aria-hidden />
              Download template
            </Button>
          </div>
        </div>
      )}

      {/* Step 2 — map columns */}
      {step === 2 && upload && (
        <div className="space-y-5">
          <FileBanner fileName={upload.fileName} rowCount={upload.rows.length} />
          <ColumnMapper
            headers={upload.headers}
            fields={upload.fields}
            mapping={upload.mapping}
            onChange={(mapping) => setUpload({ ...upload, mapping })}
          />
          <div className="flex items-center justify-between gap-3">
            <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
              <ArrowLeftIcon aria-hidden />
              Start over
            </Button>
            <Button
              type="button"
              onClick={goToPreview}
              disabled={busy || missingRequired}
            >
              {busy ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Preview
              <ArrowRightIcon aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3 — preview */}
      {step === 3 && upload && preview && (
        <div className="space-y-5">
          <FileBanner fileName={upload.fileName} rowCount={upload.rows.length} />
          <ImportPreviewGrid rows={preview} onEditRow={onEditRow} />
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep(2)}
              disabled={busy}
            >
              <ArrowLeftIcon aria-hidden />
              Back to mapping
            </Button>
            <Button
              type="button"
              onClick={commit}
              disabled={busy || committableCount === 0}
            >
              {busy ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Import {committableCount} row
              {committableCount === 1 ? "" : "s"}
            </Button>
          </div>
          {previewCounts.invalid > 0 && (
            <p className="text-xs text-muted-foreground">
              {previewCounts.invalid} row
              {previewCounts.invalid === 1 ? "" : "s"} with errors will be
              skipped. Fix them above to include them.
            </p>
          )}
        </div>
      )}

      {/* Step 4 — report */}
      {step === 4 && summary && (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-10 text-center">
            <CheckCircle2Icon
              className="size-10 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
            <div>
              <p className="text-lg font-semibold text-foreground">
                Import complete
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {summary.created} created · {summary.updated} updated ·{" "}
                {summary.skipped.length} skipped
              </p>
              {summary.variantProductsCreated +
                summary.variantProductsUpdated >
                0 && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {summary.variantProductsCreated +
                    summary.variantProductsUpdated}{" "}
                  variant product
                  {summary.variantProductsCreated +
                    summary.variantProductsUpdated ===
                  1
                    ? ""
                    : "s"}{" "}
                  · {summary.variantsWritten} variant
                  {summary.variantsWritten === 1 ? "" : "s"} written
                </p>
              )}
              {summary.newBrands.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  New brands: {summary.newBrands.join(", ")}
                </p>
              )}
            </div>
          </div>

          {summary.skipped.length > 0 && (
            <div className="space-y-3 rounded-xl border border-border">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <p className="text-sm font-medium text-foreground">
                  Skipped rows ({summary.skipped.length})
                </p>
                {summary.errorsCsvBase64 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onErrorCsv}
                  >
                    <DownloadIcon aria-hidden />
                    Download error report
                  </Button>
                )}
              </div>
              <ul className="max-h-64 divide-y divide-border overflow-auto">
                {summary.skipped.map((s) => (
                  <li
                    key={`${s.rowNumber}-${s.sku}`}
                    className="flex items-start gap-3 px-4 py-2 text-sm"
                  >
                    <span className="shrink-0 font-tabular text-xs text-muted-foreground">
                      Row {s.rowNumber}
                    </span>
                    <span className="shrink-0 font-tabular text-xs font-medium text-foreground">
                      {s.sku || "—"}
                    </span>
                    <span className="text-muted-foreground">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-center">
            <Button type="button" variant="outline" onClick={reset}>
              <RotateCcwIcon aria-hidden />
              Import another file
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                            */
/* -------------------------------------------------------------------------- */

function Stepper({ current }: { current: Step }) {
  const steps: Step[] = [1, 2, 3, 4];
  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, i) => {
        const state =
          s < current ? "done" : s === current ? "active" : "upcoming";
        return (
          <React.Fragment key={s}>
            <li className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors",
                  state === "done" && "bg-primary text-primary-foreground",
                  state === "active" &&
                    "bg-primary/15 text-primary ring-2 ring-primary/40",
                  state === "upcoming" &&
                    "bg-muted text-muted-foreground",
                )}
              >
                {state === "done" ? "✓" : s}
              </span>
              <span
                className={cn(
                  "text-sm",
                  state === "upcoming"
                    ? "text-muted-foreground"
                    : "font-medium text-foreground",
                )}
              >
                {STEP_LABELS[s]}
              </span>
            </li>
            {i < steps.length - 1 && (
              <li aria-hidden className="h-px w-6 bg-border sm:w-10" />
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

function FileBanner({
  fileName,
  rowCount,
}: {
  fileName: string;
  rowCount: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <FileSpreadsheetIcon
        className="size-5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {fileName}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {rowCount} row{rowCount === 1 ? "" : "s"}
        </p>
      </div>
    </div>
  );
}
