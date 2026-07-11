import type { OrderStatus } from "@prisma/client";
import { CheckIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ORDER_STATUS_HINT,
  ORDER_STATUS_LABEL,
  ORDER_TIMELINE,
} from "./order-status";

/**
 * Vertical status timeline for an order. Renders the forward lifecycle
 * (Placed → Confirmed → Processing → Fulfilled) with completed / current /
 * upcoming states, or a dedicated cancelled treatment. Server component.
 */
export function OrderStatusTimeline({ status }: { status: OrderStatus }) {
  if (status === "CANCELLED") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-full bg-destructive/15 text-destructive"
        >
          <XIcon className="size-3.5" />
        </span>
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">
            {ORDER_STATUS_LABEL.CANCELLED}
          </p>
          <p className="text-xs text-muted-foreground">
            {ORDER_STATUS_HINT.CANCELLED}
          </p>
        </div>
      </div>
    );
  }

  const currentIndex = ORDER_TIMELINE.indexOf(status);

  return (
    <ol className="space-y-0">
      {ORDER_TIMELINE.map((step, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex;
        const isLast = i === ORDER_TIMELINE.length - 1;
        return (
          <li key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-xs transition-colors",
                  done && "border-success bg-success text-success-foreground",
                  current && "border-primary bg-primary text-primary-foreground",
                  !done &&
                    !current &&
                    "border-border bg-muted text-muted-foreground",
                )}
              >
                {done ? (
                  <CheckIcon className="size-3.5" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>
              {!isLast ? (
                <span
                  aria-hidden
                  className={cn(
                    "my-1 w-px flex-1",
                    i < currentIndex ? "bg-success" : "bg-border",
                  )}
                />
              ) : null}
            </div>
            <div className={cn("pb-5", isLast && "pb-0")}>
              <p
                className={cn(
                  "text-sm font-medium",
                  current ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {ORDER_STATUS_LABEL[step]}
              </p>
              {current ? (
                <p className="text-xs text-muted-foreground">
                  {ORDER_STATUS_HINT[step]}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
