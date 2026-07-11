"use client";

/**
 * OrderStatusControl — a CUSTOM status picker (never a native <select>).
 *
 * Renders the current status as a chip-styled trigger; clicking opens a Dialog
 * (desktop) / bottom Sheet (mobile) of the ALLOWED forward transitions only
 * (from the shared transition table), each an accessible radio-like option.
 * Selecting one calls `setOrderStatusAction` and, on success, refreshes.
 *
 * The allowed set is enforced again server-side, so this control is a
 * convenience/UX layer — it can never widen what the server permits.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";
import { toast } from "sonner";
import type { OrderStatus } from "@prisma/client";

import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/common/StatusChip";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/components/common/use-is-mobile";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  ORDER_STATUS_HINT,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TRANSITIONS,
  orderStatusVariant,
} from "@/components/storefront/orders/order-status";
import { setOrderStatusAction } from "@/server/actions/admin-orders";

export function OrderStatusControl({
  orderId,
  status,
  className,
}: {
  orderId: string;
  status: OrderStatus;
  className?: string;
}) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const options = ORDER_STATUS_TRANSITIONS[status];

  const apply = React.useCallback(
    async (next: OrderStatus) => {
      setBusy(true);
      try {
        const res = await setOrderStatusAction({ id: orderId, status: next });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(`Marked ${ORDER_STATUS_LABEL[next].toLowerCase()}.`);
        setOpen(false);
        router.refresh();
      } catch {
        toast.error("Couldn't update the status. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orderId, router],
  );

  const trigger = (
    <button
      type="button"
      disabled={busy || options.length === 0}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
        className,
      )}
      aria-label={`Change status — currently ${ORDER_STATUS_LABEL[status]}`}
    >
      <StatusChip
        variant={orderStatusVariant(status)}
        label={ORDER_STATUS_LABEL[status]}
      />
      {busy ? (
        <Spinner size="sm" label="" />
      ) : options.length > 0 ? (
        <ChevronDownIcon className="size-3.5 text-muted-foreground" aria-hidden />
      ) : null}
    </button>
  );

  // Terminal states have no forward transitions — render a static chip.
  if (options.length === 0) {
    return (
      <StatusChip
        variant={orderStatusVariant(status)}
        label={ORDER_STATUS_LABEL[status]}
        className={className}
      />
    );
  }

  const optionList = (
    <div className="space-y-1.5 p-1" role="radiogroup" aria-label="New status">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          role="radio"
          aria-checked={false}
          disabled={busy}
          onClick={() => void apply(opt)}
          className="flex w-full items-start gap-3 rounded-lg border border-transparent p-2.5 text-left transition-colors hover:border-border hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
        >
          <StatusChip
            variant={orderStatusVariant(opt)}
            label={ORDER_STATUS_LABEL[opt]}
          />
          <span className="text-xs text-muted-foreground">
            {ORDER_STATUS_HINT[opt]}
          </span>
        </button>
      ))}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={trigger} />
        <SheetContent side="bottom" className="rounded-t-2xl pb-safe">
          <SheetHeader>
            <SheetTitle>Update status</SheetTitle>
          </SheetHeader>
          <div className="px-2 pb-2">{optionList}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Update status</DialogTitle>
        </DialogHeader>
        {optionList}
      </DialogContent>
    </Dialog>
  );
}
