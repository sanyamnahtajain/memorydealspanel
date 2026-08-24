"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Undo2 } from "lucide-react";

import type { OrderAccessExtension } from "@/server/services/admin-orders";
import { retractAccessExtensionAction } from "@/server/actions/admin-orders";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/common";

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Anti-abuse notice (owner request): this order granted "+N days" of price
 * access. Payment isn't taken at placement, so a junk order can farm access —
 * the admin sees the grant here and can take the days back (typically after
 * cancelling the order). One-way: a removed extension stays removed.
 */
export function AccessExtensionNotice({
  orderId,
  extension,
}: {
  orderId: string;
  extension: OrderAccessExtension;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  if (extension.retracted) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          The {extension.days}-day access extension from this order was
          removed.
        </p>
      </div>
    );
  }

  function retract() {
    startTransition(async () => {
      const res = await retractAccessExtensionAction({ id: orderId });
      setConfirming(false);
      if (!res.ok) {
        toast.error("Couldn't remove the extra days", { description: res.error });
        return;
      }
      toast.success(`Removed the ${extension.days} extra days.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
      <AlertTriangle
        className="size-4 shrink-0 text-amber-700 dark:text-amber-300"
        aria-hidden
      />
      <p className="min-w-0 flex-1 text-sm text-amber-800 dark:text-amber-200">
        Placing this order extended the customer&apos;s access by{" "}
        <span className="font-semibold">{extension.days} days</span> (till{" "}
        {dateFmt.format(new Date(extension.expiresAt))}). If you cancel this
        order, consider removing those days.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 border-amber-500/40 text-amber-800 hover:bg-amber-500/15 dark:text-amber-200"
        disabled={pending}
        onClick={() => setConfirming(true)}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Undo2 className="size-3.5" aria-hidden />
        )}
        Remove the {extension.days} days
      </Button>

      <ConfirmSheet
        open={confirming}
        onOpenChange={setConfirming}
        title={`Take back ${extension.days} days of access?`}
        description="The customer's access period goes back to what it was before this order. If that lands in the past, their access ends right away."
        confirmLabel={pending ? "Removing…" : `Remove ${extension.days} days`}
        onConfirm={retract}
        destructive
      />
    </div>
  );
}
