"use client";

/**
 * OrderStatusControl — a CUSTOM status picker (never a native <select>).
 *
 * Renders the current status as a chip-styled trigger; clicking opens a Dialog
 * (desktop) / bottom Sheet (mobile) listing every OTHER status, each an
 * accessible radio-like option.
 *
 * TWO STEPS, ALWAYS. Picking a status does not apply it — it shows a
 * confirmation naming the exact move ("Dispatched → Placed"), because every
 * status change pushes a message to a real buyer's phone. Moves that
 * contradict what the buyer was last told (backwards, or re-opening a closed
 * order) say so in as many words. This confirmation IS the safety mechanism:
 * staff can now move an order to any state to fix a mistake, so the guard is
 * a deliberate second tap rather than a locked door.
 *
 * The transition set is enforced again server-side; this control is a
 * convenience/UX layer and can never widen what the server permits.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  ChevronDownIcon,
} from "lucide-react";
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
  statusChangeWarning,
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
  /** The status the operator picked, awaiting confirmation. */
  const [pending, setPending] = React.useState<OrderStatus | null>(null);

  const options = ORDER_STATUS_TRANSITIONS[status];

  // Reset the confirmation whenever the surface closes, so re-opening never
  // lands mid-flow on a stale choice.
  const onOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setPending(null);
  }, []);

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
        setPending(null);
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
          onClick={() => setPending(opt)}
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

  const warning = pending ? statusChangeWarning(status, pending) : null;

  const confirmPanel = pending ? (
    <div className="space-y-4 p-1">
      {/* The exact move, spelled out. "Are you sure?" on its own tells an
          operator nothing they can check. */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip
          variant={orderStatusVariant(status)}
          label={ORDER_STATUS_LABEL[status]}
        />
        <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden />
        <StatusChip
          variant={orderStatusVariant(pending)}
          label={ORDER_STATUS_LABEL[pending]}
        />
      </div>

      <p className="text-sm text-muted-foreground">
        {ORDER_STATUS_HINT[pending]}
      </p>

      {warning ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{warning}</span>
        </p>
      ) : null}

      {/* Said plainly every time: this is the consequence operators forget. */}
      <p className="text-xs text-muted-foreground">
        The customer is notified of this change.
      </p>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => setPending(null)}
          className="rounded-lg border border-border px-3 py-2 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        >
          Back
        </button>
        <button
          type="button"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void apply(pending)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        >
          {busy ? <Spinner size="sm" label="" /> : null}
          Mark {ORDER_STATUS_LABEL[pending].toLowerCase()}
        </button>
      </div>
    </div>
  ) : null;

  const title = pending ? "Confirm status change" : "Update status";
  const body = pending ? confirmPanel : optionList;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger render={trigger} />
        <SheetContent side="bottom" className="rounded-t-2xl pb-safe">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="px-2 pb-2">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
