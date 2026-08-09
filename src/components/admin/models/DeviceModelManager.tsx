"use client";

import * as React from "react";
import { ClipboardPaste, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { DeviceModelRowData } from "@/server/services/device-models";
import {
  bulkCreateDeviceModelsAction,
  createDeviceModelAction,
  deleteDeviceModelAction,
  setDeviceModelStatusAction,
} from "@/server/actions/device-models";

/**
 * DeviceModelManager — the admin surface for the model master:
 * quick-create, bulk paste import, search filter, activate/deactivate,
 * delete (server-guarded when referenced). Optimistic where safe; every
 * mutation reconciles from the action's canonical row.
 */
export function DeviceModelManager({
  initialModels,
}: {
  initialModels: DeviceModelRowData[];
}) {
  const [models, setModels] = React.useState(initialModels);
  const [filter, setFilter] = React.useState("");

  // Quick create
  const [name, setName] = React.useState("");
  const [brand, setBrand] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  // Bulk paste
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkText, setBulkText] = React.useState("");
  const [bulkBusy, setBulkBusy] = React.useState(false);

  const visible = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.brandName ?? "").toLowerCase().includes(q),
    );
  }, [models, filter]);

  async function handleCreate() {
    if (creating || name.trim().length < 2) return;
    setCreating(true);
    try {
      const result = await createDeviceModelAction({
        name: name.trim(),
        ...(brand.trim() ? { brandName: brand.trim() } : {}),
      });
      if (result.ok) {
        setModels((prev) => [result.data, ...prev]);
        setName("");
        setBrand("");
        toast.success(`Added ${result.data.name}.`);
      } else {
        toast.error(result.error);
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleBulk() {
    if (bulkBusy || bulkText.trim() === "") return;
    setBulkBusy(true);
    try {
      const result = await bulkCreateDeviceModelsAction({ text: bulkText });
      if (result.ok) {
        const { created, skippedExisting, invalid } = result.data;
        toast.success(
          `${created} added · ${skippedExisting.length} already existed · ${invalid.length} invalid`,
        );
        setBulkOpen(false);
        setBulkText("");
        // The list changed server-side in bulk — easiest correct refresh.
        window.location.reload();
      } else {
        toast.error(result.error);
      }
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleStatus(model: DeviceModelRowData, active: boolean) {
    const status = active ? ("ACTIVE" as const) : ("INACTIVE" as const);
    setModels((prev) =>
      prev.map((m) => (m.id === model.id ? { ...m, status } : m)),
    );
    const result = await setDeviceModelStatusAction({ id: model.id, status });
    if (!result.ok) {
      setModels((prev) =>
        prev.map((m) => (m.id === model.id ? { ...m, status: model.status } : m)),
      );
      toast.error(result.error);
    }
  }

  async function handleDelete(model: DeviceModelRowData) {
    const result = await deleteDeviceModelAction({ id: model.id });
    if (result.ok) {
      setModels((prev) => prev.filter((m) => m.id !== model.id));
      toast.success(`Deleted ${model.name}.`);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-4">
      {/* ---- Quick create + bulk import ---- */}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <label htmlFor="model-name" className="text-xs font-medium">
            Model name
          </label>
          <Input
            id="model-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="e.g. Galaxy S23 Ultra"
          />
        </div>
        <div className="w-full space-y-1 sm:w-44">
          <label htmlFor="model-brand" className="text-xs font-medium">
            Brand (optional)
          </label>
          <Input
            id="model-brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="Samsung"
          />
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleCreate}
            disabled={creating || name.trim().length < 2}
            className="gap-1.5"
          >
            <Plus aria-hidden className="size-4" />
            Add
          </Button>
          <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
            <DialogTrigger
              render={<Button variant="outline" className="gap-1.5" />}
            >
              <ClipboardPaste aria-hidden className="size-4" />
              Bulk paste
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Bulk import models</DialogTitle>
                <DialogDescription>
                  One model per line. Optionally prefix a brand:
                  “Samsung | Galaxy S23 Ultra”. Duplicates are skipped, so
                  re-pasting is safe.
                </DialogDescription>
              </DialogHeader>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={12}
                placeholder={"Realme | Realme 11 Pro\nSamsung | Galaxy S23 Ultra\niPhone 15 Pro Max"}
                className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <Button
                onClick={handleBulk}
                disabled={bulkBusy || bulkText.trim() === ""}
                aria-busy={bulkBusy || undefined}
                className="w-full"
              >
                {bulkBusy ? "Importing…" : "Import"}
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ---- Search filter ---- */}
      <div className="relative max-w-sm">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Search ${models.length} models…`}
          className="pl-8"
          aria-label="Filter models"
        />
      </div>

      {/* ---- List ---- */}
      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {models.length === 0
            ? "No models yet — add one above or bulk-paste your list."
            : "No models match the search."}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {visible.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    m.status === "INACTIVE" && "text-muted-foreground line-through",
                  )}
                >
                  {m.name}
                </p>
                {m.brandName ? (
                  <p className="text-xs text-muted-foreground">{m.brandName}</p>
                ) : null}
              </div>
              {m.status === "INACTIVE" ? (
                <Badge variant="outline" className="shrink-0 text-xs">
                  Inactive
                </Badge>
              ) : null}
              <Switch
                checked={m.status === "ACTIVE"}
                onCheckedChange={(on) => handleStatus(m, on)}
                aria-label={`${m.name} active`}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${m.name}`}
                onClick={() => handleDelete(m)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
