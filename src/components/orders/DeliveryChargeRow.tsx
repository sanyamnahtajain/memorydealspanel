import { formatPaise } from "@/lib/money";
import { DELIVERY_MINIMUM_CAVEAT } from "@/lib/delivery";
import { cn } from "@/lib/utils";

/**
 * The ONE "Delivery (minimum)" money row, shared by every totals block: the
 * cart summary, the order confirmation, the customer's order detail, the admin
 * order panel and the GST breakup.
 *
 * Owner rule: the minimum delivery charge is REAL money in the total — but it
 * is a MINIMUM, so the weight/size/PIN-code caveat travels with it and is never
 * separated from the amount. Simple English, phone-first (the caveat wraps
 * under the label and the amount stays pinned right).
 *
 * Renders NOTHING at 0 paise, which is what keeps a delivery-off cart and every
 * historical order looking exactly as they always did.
 *
 * Server-safe (no hooks). `inDefinitionList` keeps the markup valid in both
 * homes: `<dt>/<dd>` inside the cart's `<dl>`, plain `<span>`s elsewhere.
 */
export function DeliveryChargeRow({
  chargePaise,
  inDefinitionList = false,
  showCaveat = true,
  className,
}: {
  chargePaise: number;
  inDefinitionList?: boolean;
  /** Hide the caveat where a full DeliveryNotice already sits right beside it. */
  showCaveat?: boolean;
  className?: string;
}) {
  if (!Number.isFinite(chargePaise) || chargePaise <= 0) return null;
  const Label = inDefinitionList ? "dt" : "span";
  const Value = inDefinitionList ? "dd" : "span";
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <Label className="min-w-0 text-sm font-medium text-muted-foreground">
        Delivery (minimum)
        {showCaveat ? (
          <span className="mt-0.5 block text-[0.7rem] leading-relaxed font-normal text-muted-foreground/80">
            {DELIVERY_MINIMUM_CAVEAT}
          </span>
        ) : null}
      </Label>
      <Value className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
        +{formatPaise(chargePaise)}
      </Value>
    </div>
  );
}
