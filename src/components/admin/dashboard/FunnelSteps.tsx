import * as React from "react";

import { fmtInt, pct } from "./insights-format";

export interface FunnelStep {
  label: string;
  value: number;
}

/**
 * A top-down funnel: each step's bar is proportional to the first, with the
 * step-to-step conversion written beside it. Sequential single hue — the
 * magnitude is the story, not the identity. Server component.
 */
export function FunnelSteps({ steps }: { steps: FunnelStep[] }) {
  const top = steps[0]?.value ?? 0;
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step, i) => {
        // Clamped: a later step can exceed the first (orders that skipped the
        // cart, views from before the window), and a bar must never leave
        // its card.
        const width = top > 0 ? Math.min(100, Math.max(4, Math.round((step.value / top) * 100))) : 0;
        const prev = i > 0 ? steps[i - 1]!.value : null;
        const opacity = 1 - i * 0.18;
        return (
          <li key={step.label} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate font-medium text-foreground">{step.label}</span>
              <span className="shrink-0 font-tabular text-muted-foreground">
                <span className="font-semibold text-foreground">{fmtInt(step.value)}</span>
                {prev !== null ? <span className="ml-2">{pct(step.value, prev)}% of previous</span> : null}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-sm bg-muted" aria-hidden>
              <div
                className="h-full rounded-sm bg-primary transition-[width] duration-500"
                style={{ width: `${width}%`, opacity }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
