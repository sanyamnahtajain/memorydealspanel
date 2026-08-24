import { Truck } from "lucide-react";

import type { DeliveryDisclosure } from "@/lib/delivery";
import { deliveryDisclosureCopy } from "@/lib/delivery";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The ONE delivery-charge notice used everywhere (cart, order confirmation,
 * order detail, admin order panel) — owner request: the minimum charge must be
 * impossible to miss, in simple English, with the weight/size/PIN-code caveat.
 * Server-safe (no hooks). Renders nothing when there is nothing to disclose.
 *
 * `charged` switches the wording: true when the amount is a real line in the
 * total (today's carts and new orders), false for an order placed while the
 * charge was only disclosed — those keep their original wording forever.
 */
export function DeliveryNotice({
  delivery,
  charged = false,
  className,
}: {
  delivery: DeliveryDisclosure | null | undefined;
  charged?: boolean;
  className?: string;
}) {
  if (!delivery) return null;
  const copy = deliveryDisclosureCopy(formatPaise(delivery.minChargePaise), {
    charged,
  });
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5",
        className,
      )}
    >
      <Truck
        className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300"
        aria-hidden
      />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-amber-800 dark:text-amber-200">{copy.title}</p>
        <p className="mt-0.5 text-xs text-amber-700/90 dark:text-amber-300/90">
          {copy.detail}
        </p>
        {delivery.note ? (
          <p className="mt-0.5 text-xs text-amber-700/90 dark:text-amber-300/90">
            {delivery.note}
          </p>
        ) : null}
      </div>
    </div>
  );
}
