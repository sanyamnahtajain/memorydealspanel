import * as React from "react";
import { cn } from "@/lib/utils";

export type StatusChipVariant =
  | "active"
  | "inactive"
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "blocked"
  | "inStock"
  | "low"
  | "outOfStock";

interface StatusStyle {
  label: string;
  chip: string;
  dot: string;
}

const STATUS_STYLES: Record<StatusChipVariant, StatusStyle> = {
  active: {
    label: "Active",
    chip: "border-success/25 bg-success/10 text-success",
    dot: "bg-success",
  },
  inactive: {
    label: "Inactive",
    chip: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  pending: {
    label: "Pending",
    chip: "border-warning/35 bg-warning/15 text-warning-foreground dark:text-warning",
    dot: "bg-warning",
  },
  approved: {
    label: "Approved",
    chip: "border-success/25 bg-success/10 text-success",
    dot: "bg-success",
  },
  rejected: {
    label: "Rejected",
    chip: "border-destructive/25 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
  expired: {
    label: "Expired",
    chip: "border-border bg-muted text-muted-foreground",
    dot: "bg-warning",
  },
  blocked: {
    label: "Blocked",
    chip: "border-transparent bg-destructive text-destructive-foreground",
    dot: "bg-destructive-foreground",
  },
  inStock: {
    label: "In stock",
    chip: "border-success/25 bg-success/10 text-success",
    dot: "bg-success",
  },
  low: {
    label: "Low stock",
    chip: "border-warning/35 bg-warning/15 text-warning-foreground dark:text-warning",
    dot: "bg-warning",
  },
  outOfStock: {
    label: "Out of stock",
    chip: "border-destructive/25 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
};

interface StatusChipProps {
  variant: StatusChipVariant;
  /** Overrides the default label for the variant. */
  label?: string;
  className?: string;
}

/**
 * Small status indicator: colored dot + label, semantic token colors only.
 * Covers entity lifecycle (customers, access grants) and stock states.
 * Server component.
 */
export function StatusChip({ variant, label, className }: StatusChipProps) {
  const style = STATUS_STYLES[variant];
  return (
    <span
      data-slot="status-chip"
      data-variant={variant}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        style.chip,
        className
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
      {label ?? style.label}
    </span>
  );
}
