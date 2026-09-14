"use client";

import * as React from "react";

/**
 * Follow `value`, but only after it has stopped changing for `delayMs`.
 *
 * WHY, GIVEN `useDeferredValue` EXISTS: they solve different halves of the
 * same problem. `useDeferredValue` keeps a keystroke from BLOCKING — the
 * expensive pass runs at low priority and can be interrupted. It does not
 * stop the pass from running for every intermediate query: type "ambrane"
 * and React still schedules work for "a", "am", "amb"… Debouncing collapses
 * that burst into one pass over the data. The grid uses both: this to decide
 * WHEN the work runs, `useDeferredValue` to keep the one run that does happen
 * from freezing the input.
 *
 * Deliberately has no "apply this one immediately" escape hatch — a hook that
 * sometimes lags and sometimes doesn't is a hook nobody can reason about.
 * A caller that needs a particular value applied at once (an emptied search
 * box, say) selects it itself, outside the debounce.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = React.useState(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
