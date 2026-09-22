import * as React from "react";

import { describeOrderChange, type OrderChange } from "@/lib/order-edits";

/** "What changed" as a compact list — used in the editor preview and history. */
export function OrderChangesList({
  changes,
  className,
}: {
  changes: readonly OrderChange[];
  className?: string;
}) {
  if (changes.length === 0) return null;
  return (
    <ul className={className}>
      {changes.map((change, i) => (
        <li
          key={`${change.kind}-${"key" in change ? change.key : "note"}-${i}`}
          className="flex items-start gap-2 text-sm text-foreground"
        >
          <span
            aria-hidden
            className={
              change.kind === "removed"
                ? "mt-1.5 size-1.5 shrink-0 rounded-full bg-destructive"
                : change.kind === "added"
                  ? "mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500"
                  : "mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
            }
          />
          <span className="[overflow-wrap:anywhere]">{describeOrderChange(change)}</span>
        </li>
      ))}
    </ul>
  );
}
