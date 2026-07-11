/**
 * Per-customer placement lock — serialises concurrent `placeOrder` calls for a
 * single customer so the idempotency / identical-cart dedup check becomes
 * race-safe.
 *
 * WHY THIS EXISTS (anti-cheat invariant #4 — "two-tab race -> idempotent single
 * order"): placement de-dupes a double-submit by reading for a recently-committed
 * identical order and, if none exists, creating one. That read-then-write has no
 * DB-level uniqueness guard (the Order schema is owned by another agent and
 * cannot be changed here), so two concurrent placements could both pass the
 * dedup read before either commits and each create an Order — a duplicate
 * purchase request. Worse, the ONLY natural collision point (clearing the cart)
 * would usually abort one transaction with a Mongo write-conflict, surfacing a
 * scary error on an order that actually succeeded.
 *
 * The fix: every placement for a given customer runs inside `withPlacementLock`,
 * a promise-chained mutex keyed on customerId. Concurrent calls queue behind one
 * another, so the second call runs its dedup check AFTER the first has committed
 * and cleared the cart — it then either dedups (identical cart, same window) or
 * sees an empty cart, and can never create a duplicate.
 *
 * This is process-local (like the in-memory idempotency ledger and rate-limit
 * fallback it complements). In a multi-instance deployment two instances could
 * still race; that residual window is additionally covered by the identical-cart
 * dedup read plus a bounded write-conflict retry in `placeOrder`. Within one
 * instance — the double-click / two-tab case the spec calls out — it is airtight.
 */

const globalForPlacementLock = globalThis as unknown as {
  __memorydealsPlacementLocks: Map<string, Promise<unknown>> | undefined;
};

function lockChains(): Map<string, Promise<unknown>> {
  return (globalForPlacementLock.__memorydealsPlacementLocks ??= new Map());
}

/**
 * Run `fn` while holding the placement lock for `customerId`. Calls for the same
 * customer are serialised (FIFO); calls for different customers run in parallel.
 * The lock is always released — even if `fn` throws — and its map entry is
 * cleaned up once the chain drains, so this cannot leak memory per customer.
 */
export async function withPlacementLock<T>(
  customerId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const chains = lockChains();
  const prior = chains.get(customerId) ?? Promise.resolve();

  // Chain our work after whatever is already queued for this customer. We
  // swallow the prior result/error so one placement's failure never rejects the
  // next in line — each `fn` observes only its own outcome.
  const run = prior.then(fn, fn);

  // Publish the tail of the chain so the NEXT caller queues behind us. We store
  // a settled-either-way promise so a rejection here doesn't poison the chain.
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(customerId, tail);

  // Once this tail drains AND no one queued behind us, drop the map entry to
  // avoid unbounded growth across many distinct customers.
  void tail.finally(() => {
    if (chains.get(customerId) === tail) {
      chains.delete(customerId);
    }
  });

  return run;
}
