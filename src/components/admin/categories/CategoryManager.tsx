"use client";

import * as React from "react";
import { FolderPlusIcon, PlusIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common";
import { springs } from "@/components/motion/tokens";
import {
  createCategoryAction,
  deleteCategoryAction,
  reorderCategoriesAction,
  setCategoryStatusAction,
  updateCategoryAction,
} from "@/server/actions/categories";
import {
  CategoryFormDialog,
  type CategoryFormValues,
} from "./CategoryFormDialog";
import { CategoryRow } from "./CategoryRow";

export interface CategoryChild {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  sortOrder: number;
  status: "ACTIVE" | "INACTIVE";
  parentId: string | null;
  productCount: number;
  /** GST default HSN/SAC for this category (null = none). */
  defaultHsnCode: string | null;
  /** GST default rate in basis points (null = none). */
  defaultGstRateBps: number | null;
  /** Whether products here require a per-model breakdown by default. */
  defaultAllocationOn: boolean;
  /** Category-level pack multiple for that breakdown (null = none). */
  defaultAllocationPack: number | null;
}

export interface CategoryNode extends Omit<CategoryChild, "parentId"> {
  parentId: null;
  /** Products in this category's own sub-categories, for the summary line. */
  childProductTotal: number;
  children: CategoryChild[];
}

interface CategoryManagerProps {
  initialCategories: CategoryNode[];
  /**
   * Whether the GST kill-switch is on. When false the category form hides its
   * HSN / GST-default fields entirely, so the surface behaves exactly as pre-GST.
   */
  gstEnabled?: boolean;
}

type DialogState =
  | { mode: "createRoot" }
  | { mode: "createChild"; parentId: string; parentName: string }
  | {
      mode: "edit";
      target: CategoryChild | CategoryNode;
    }
  | null;

/**
 * Client category manager: renders the parent > children tree with inline
 * rename, active/inactive toggle, up/down reordering (accessible; also
 * pointer-draggable) and add / add-sub / edit dialogs. All mutations are
 * optimistic with sonner toasts; on failure the previous state is restored.
 */
export function CategoryManager({
  initialCategories,
  gstEnabled = false,
}: CategoryManagerProps) {
  const [categories, setCategories] =
    React.useState<CategoryNode[]>(initialCategories);
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [pending, startTransition] = React.useTransition();
  const reduced = useReducedMotion();

  // Adopt fresh server data during render (revalidatePath re-renders us with
  // new props): the recommended alternative to a sync-in-effect. Optimistic
  // local edits are always followed by a server action that revalidates, so
  // the server copy is authoritative once it arrives.
  const [syncedFrom, setSyncedFrom] = React.useState(initialCategories);
  // While an arrangement is still being saved, a refresh from the server
  // carries the PREVIOUS order — adopting it would snap the list back. Wait
  // until the queue is empty; then the latest server copy is adopted.
  const [orderDirty, setOrderDirty] = React.useState(false);
  if (syncedFrom !== initialCategories && !orderDirty) {
    setSyncedFrom(initialCategories);
    setCategories(initialCategories);
  }

  /* ---------------------------------------------------------------- */
  /* Reorder                                                          */
  /* ---------------------------------------------------------------- */

  // Saving the order: moves are instant on screen, and the server is told the
  // FINAL arrangement of each sibling group — debounced, one request at a
  // time. (Saving from inside a state updater, as before, could fire twice,
  // and two quick taps could land out of order, leaving the database on the
  // older arrangement while the screen showed the newer one.)
  const router = useRouter();
  const pendingOrders = React.useRef(new Map<string, string[]>());
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = React.useRef(false);
  const [savingOrder, setSavingOrder] = React.useState(false);

  const flushOrders = React.useCallback(async () => {
    if (inFlight.current) return; // the running loop below will pick it up
    inFlight.current = true;
    setSavingOrder(true);
    // Drain the queue one request at a time; moves made while a request is
    // in flight are queued and sent by this same loop.
    while (pendingOrders.current.size > 0) {
      const [group, ids] = pendingOrders.current.entries().next().value as [string, string[]];
      pendingOrders.current.delete(group);
      let error: string | null = null;
      try {
        const result = await reorderCategoriesAction({ ids });
        if (!result.ok) error = result.error;
      } catch {
        error = "Couldn't save the new order. Check your connection — the list was reloaded.";
      }
      if (error) {
        pendingOrders.current.clear();
        toast.error(error);
        router.refresh(); // back to the order the server really has
        break;
      }
    }
    inFlight.current = false;
    setSavingOrder(false);
    setOrderDirty(false);
  }, [router]);

  const queueOrder = React.useCallback(
    (group: string, ids: string[]) => {
      pendingOrders.current.set(group, ids);
      setOrderDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flushOrders(), 450);
    },
    [flushOrders],
  );

  // Leaving the page with a move still queued: send it now.
  React.useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      for (const ids of pendingOrders.current.values()) void reorderCategoriesAction({ ids });
    },
    [],
  );

  const moveRoot = React.useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= categories.length) return;
      const next = [...categories];
      [next[index], next[target]] = [next[target], next[index]];
      setCategories(next);
      queueOrder("root", next.map((c) => c.id));
    },
    [categories, queueOrder],
  );

  const moveChild = React.useCallback(
    (parentId: string, index: number, direction: -1 | 1) => {
      const parent = categories.find((c) => c.id === parentId);
      if (!parent) return;
      const target = index + direction;
      if (target < 0 || target >= parent.children.length) return;
      const nextChildren = [...parent.children];
      [nextChildren[index], nextChildren[target]] = [nextChildren[target], nextChildren[index]];
      setCategories(categories.map((c) => (c.id === parentId ? { ...c, children: nextChildren } : c)));
      queueOrder(`children:${parentId}`, nextChildren.map((c) => c.id));
    },
    [categories, queueOrder],
  );

  /* ---------------------------------------------------------------- */
  /* Status toggle                                                    */
  /* ---------------------------------------------------------------- */

  const toggleStatus = React.useCallback(
    (id: string, nextStatus: "ACTIVE" | "INACTIVE") => {
      const previous = categories;
      setCategories((prev) =>
        prev.map((root) => {
          if (root.id === id) return { ...root, status: nextStatus };
          if (root.children.some((child) => child.id === id)) {
            return {
              ...root,
              children: root.children.map((child) =>
                child.id === id ? { ...child, status: nextStatus } : child,
              ),
            };
          }
          return root;
        }),
      );
      startTransition(async () => {
        const result = await setCategoryStatusAction({ id, status: nextStatus });
        if (!result.ok) {
          setCategories(previous);
          toast.error(result.error);
        } else {
          toast.success(
            nextStatus === "ACTIVE"
              ? "Category is now visible on the storefront."
              : "Category hidden from the storefront.",
          );
        }
      });
    },
    [categories],
  );

  /* ---------------------------------------------------------------- */
  /* Inline rename                                                    */
  /* ---------------------------------------------------------------- */

  const renameCategory = React.useCallback(
    async (id: string, name: string): Promise<boolean> => {
      const result = await updateCategoryAction({ id, patch: { name } });
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      const updated = result.data;
      setCategories((prev) =>
        prev.map((root) => {
          if (root.id === id) {
            return { ...root, name: updated.name, slug: updated.slug };
          }
          if (root.children.some((child) => child.id === id)) {
            return {
              ...root,
              children: root.children.map((child) =>
                child.id === id
                  ? { ...child, name: updated.name, slug: updated.slug }
                  : child,
              ),
            };
          }
          return root;
        }),
      );
      toast.success("Category renamed.");
      return true;
    },
    [],
  );

  /* ---------------------------------------------------------------- */
  /* Delete                                                           */
  /* ---------------------------------------------------------------- */

  const deleteCategory = React.useCallback(
    async (id: string): Promise<void> => {
      const result = await deleteCategoryAction({ id });
      if (!result.ok) {
        // Server refuses when products/sub-categories still reference it.
        toast.error(result.error);
        return;
      }
      setCategories((prev) =>
        prev
          .filter((root) => root.id !== id)
          .map((root) => ({
            ...root,
            children: root.children.filter((child) => child.id !== id),
          })),
      );
      toast.success("Category deleted.");
    },
    [],
  );

  /* ---------------------------------------------------------------- */
  /* Create / edit via dialog                                         */
  /* ---------------------------------------------------------------- */

  const handleDialogSubmit = React.useCallback(
    async (values: CategoryFormValues): Promise<string | null> => {
      if (!dialog) return "No form open.";

      // Percent → integer basis points; null clears the default. Only sent when
      // the GST kill-switch is on (fields are hidden otherwise).
      const defaultGstRateBps =
        values.defaultGstRatePercent == null
          ? null
          : Math.round(values.defaultGstRatePercent * 100);
      const taxFields = gstEnabled
        ? {
            defaultHsnCode: values.defaultHsnCode,
            defaultGstRateBps,
          }
        : {};
      // Allocation default is independent of the GST kill-switch.
      const defaultAllocation = values.allocationDefaultOn
        ? {
            kind: "DEVICE_MODEL" as const,
            required: true,
            modelIds: [],
            // The category-wide "packs of N per model" default; a product's
            // own packMultiple overrides it (effectivePerModelPack).
            ...(values.allocationPackMultiple != null
              ? { packMultiple: values.allocationPackMultiple }
              : {}),
          }
        : null;

      if (dialog.mode === "edit") {
        const result = await updateCategoryAction({
          id: dialog.target.id,
          patch: {
            name: values.name,
            image: values.image,
            status: values.status,
            defaultAllocation,
            ...taxFields,
          },
        });
        if (!result.ok) return result.error;
        toast.success("Category updated.");
      } else {
        const parentId =
          dialog.mode === "createChild" ? dialog.parentId : undefined;
        const result = await createCategoryAction({
          name: values.name,
          image: values.image ?? undefined,
          status: values.status,
          defaultAllocation,
          ...taxFields,
          ...(parentId ? { parentId } : {}),
        });
        if (!result.ok) return result.error;
        toast.success(
          parentId ? "Sub-category added." : "Category added.",
        );
      }
      // Server action revalidated the path — fresh props arrive via effect.
      return null;
    },
    [dialog, gstEnabled],
  );

  const isEmpty = categories.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {categories.length}{" "}
          {categories.length === 1 ? "category" : "categories"}
          {pending || savingOrder || orderDirty ? (
            <span className="ml-2 text-xs text-muted-foreground/70">
              Saving…
            </span>
          ) : null}
        </p>
        <Button onClick={() => setDialog({ mode: "createRoot" })}>
          <PlusIcon aria-hidden />
          Add category
        </Button>
      </div>

      {isEmpty ? (
        <EmptyState
          illustration="empty-box"
          title="No categories yet"
          description="Create your first category to start organizing the catalog."
          action={
            <Button onClick={() => setDialog({ mode: "createRoot" })}>
              <PlusIcon aria-hidden />
              Add category
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {categories.map((root, rootIndex) => (
              <motion.li
                key={root.id}
                layout={reduced ? false : true}
                transition={reduced ? { duration: 0 } : springs.gentle}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <CategoryRow
                  category={root}
                  isRoot
                  canMoveUp={rootIndex > 0}
                  canMoveDown={rootIndex < categories.length - 1}
                  onMove={(dir) => moveRoot(rootIndex, dir)}
                  onToggleStatus={toggleStatus}
                  onRename={renameCategory}
                  onEdit={() => setDialog({ mode: "edit", target: root })}
                  onDelete={() => deleteCategory(root.id)}
                  onAddChild={() =>
                    setDialog({
                      mode: "createChild",
                      parentId: root.id,
                      parentName: root.name,
                    })
                  }
                  summary={
                    <RootSummary
                      productCount={root.productCount}
                      childProductTotal={root.childProductTotal}
                      childCount={root.children.length}
                    />
                  }
                />

                {root.children.length > 0 ? (
                  <ul className="border-t border-border/70 bg-muted/20 pl-4">
                    {root.children.map((child, childIndex) => (
                      <li
                        key={child.id}
                        className="border-b border-border/40 last:border-b-0"
                      >
                        <CategoryRow
                          category={child}
                          canMoveUp={childIndex > 0}
                          canMoveDown={childIndex < root.children.length - 1}
                          onMove={(dir) => moveChild(root.id, childIndex, dir)}
                          onToggleStatus={toggleStatus}
                          onRename={renameCategory}
                          onEdit={() =>
                            setDialog({ mode: "edit", target: child })
                          }
                          onDelete={() => deleteCategory(child.id)}
                          summary={
                            <span className="text-xs text-muted-foreground">
                              {child.productCount}{" "}
                              {child.productCount === 1 ? "product" : "products"}
                            </span>
                          }
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="border-t border-border/70 bg-muted/20 px-4 py-2 pl-14">
                    <button
                      type="button"
                      onClick={() =>
                        setDialog({
                          mode: "createChild",
                          parentId: root.id,
                          parentName: root.name,
                        })
                      }
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
                    >
                      <FolderPlusIcon className="size-3.5" aria-hidden />
                      Add sub-category
                    </button>
                  </div>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <CategoryFormDialog
        open={dialog !== null}
        onOpenChange={(next) => {
          if (!next) setDialog(null);
        }}
        title={
          dialog?.mode === "edit"
            ? "Edit category"
            : dialog?.mode === "createChild"
              ? `Add sub-category to ${dialog.parentName}`
              : "Add category"
        }
        description={
          dialog?.mode === "createChild"
            ? "Sub-categories group products under a parent category."
            : dialog?.mode === "createRoot"
              ? "Categories organize your catalog on the storefront."
              : undefined
        }
        submitLabel={dialog?.mode === "edit" ? "Save changes" : "Create"}
        showTaxDefaults={gstEnabled}
        initial={
          dialog?.mode === "edit"
            ? {
                name: dialog.target.name,
                image: dialog.target.image,
                status: dialog.target.status,
                defaultHsnCode: dialog.target.defaultHsnCode,
                defaultGstRatePercent:
                  dialog.target.defaultGstRateBps == null
                    ? null
                    : dialog.target.defaultGstRateBps / 100,
                allocationDefaultOn: dialog.target.defaultAllocationOn,
                allocationPackMultiple: dialog.target.defaultAllocationPack,
              }
            : undefined
        }
        onSubmit={handleDialogSubmit}
      />
    </div>
  );
}

function RootSummary({
  productCount,
  childProductTotal,
  childCount,
}: {
  productCount: number;
  childProductTotal: number;
  childCount: number;
}) {
  const total = productCount + childProductTotal;
  return (
    <span className="text-xs text-muted-foreground">
      {total} {total === 1 ? "product" : "products"}
      {childCount > 0 ? (
        <span className="text-muted-foreground/70">
          {" · "}
          {childCount} {childCount === 1 ? "sub-category" : "sub-categories"}
        </span>
      ) : null}
    </span>
  );
}
